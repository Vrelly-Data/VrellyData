-- Fast server-side aggregates for Admin → Inference → Base KPIs
-- Returns a single JSON object with all KPI numbers so the client
-- does not need to page large tables in the browser.
-- Idempotent: CREATE OR REPLACE FUNCTION

CREATE OR REPLACE FUNCTION public.admin_inference_base_kpis(p_team_ids uuid[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
WITH
  -- Scope rows to the selected teams (NULL → all visible via RLS)
  scope_campaigns AS (
    SELECT c.*
    FROM public.synced_campaigns c
    WHERE p_team_ids IS NULL OR c.team_id = ANY(p_team_ids)
  ),
  scope_contacts AS (
    SELECT sc.*
    FROM public.synced_contacts sc
    WHERE p_team_ids IS NULL OR sc.team_id = ANY(p_team_ids)
  ),
  scope_events AS (
    SELECT e.*
    FROM public.inference_events_enriched e
    WHERE p_team_ids IS NULL OR e.team_id = ANY(p_team_ids)
  ),

  -- Normalization helpers (match client logic):
  -- - emails lower-cased
  -- - linkedin URLs lower-cased, strip scheme + query params, trim trailing slash
  contacts_all AS (
    SELECT
      COALESCE(
        NULLIF(lower(sc.email), ''),
        NULLIF(rtrim(regexp_replace(lower(split_part(sc.linkedin_url, '?', 1)), '^https?://', '', 'i'), '/'),
               ''),
        sc.id::text
      ) AS dedupe_key
    FROM scope_contacts sc
  ),
  contacts_joined AS (
    SELECT sc.*, c.channel, c.source
    FROM scope_contacts sc
    JOIN scope_campaigns c ON c.id = sc.campaign_id
  ),
  contacts_email AS (
    SELECT
      COALESCE(
        NULLIF(lower(sc.email), ''),
        NULLIF(rtrim(regexp_replace(lower(split_part(sc.linkedin_url, '?', 1)), '^https?://', '', 'i'), '/'),
               ''),
        sc.id::text
      ) AS dedupe_key
    FROM contacts_joined sc
    WHERE lower(COALESCE(sc.channel, '')) = 'email'
  ),
  contacts_linkedin AS (
    SELECT
      COALESCE(
        NULLIF(lower(sc.email), ''),
        NULLIF(rtrim(regexp_replace(lower(split_part(sc.linkedin_url, '?', 1)), '^https?://', '', 'i'), '/'),
               ''),
        sc.id::text
      ) AS dedupe_key
    FROM contacts_joined sc
    WHERE lower(COALESCE(sc.channel, '')) = 'linkedin'
  ),

  rows_by_source AS (
    SELECT
      SUM(CASE WHEN lower(COALESCE(source, '')) = 'reply_io' THEN 1 ELSE 0 END)::bigint  AS reply_rows,
      SUM(CASE WHEN lower(COALESCE(source, '')) = 'smartlead' THEN 1 ELSE 0 END)::bigint AS smartlead_rows
    FROM contacts_joined
  ),

  campaign_sums AS (
    SELECT
      COALESCE(SUM(CASE WHEN lower(COALESCE(c.channel, '')) = 'email'
                        THEN (c.stats->>'sent')::bigint ELSE 0 END), 0)                                                AS email_sends,
      COALESCE(SUM(CASE WHEN lower(COALESCE(c.source, '')) = 'smartlead'
                           AND lower(COALESCE(c.channel, '')) = 'email'
                        THEN (c.stats->>'sent')::bigint ELSE 0 END), 0)                                                AS email_sends_smartlead,
      COALESCE(SUM(CASE WHEN lower(COALESCE(c.source, '')) = 'reply_io'
                           AND lower(COALESCE(c.channel, '')) = 'email'
                        THEN (c.stats->>'sent')::bigint ELSE 0 END), 0)                                                AS email_sends_reply,
      COALESCE(SUM(CASE WHEN lower(COALESCE(c.source, '')) = 'smartlead'
                        THEN (c.stats->>'replies')::bigint ELSE 0 END), 0)                                             AS email_replies_smartlead_campaign,
      COALESCE(SUM(CASE WHEN lower(COALESCE(c.source, '')) = 'reply_io'
                           AND lower(COALESCE(c.channel, '')) = 'email'
                        THEN (c.stats->>'replies')::bigint ELSE 0 END), 0)                                             AS email_replies_reply_campaign,
      COALESCE(SUM(CASE WHEN lower(COALESCE(c.source, '')) = 'smartlead'
                        THEN (c.stats->>'peopleCount')::bigint ELSE 0 END), 0)                                         AS smartlead_seats,
      COALESCE(SUM(CASE WHEN lower(COALESCE(c.source, '')) = 'reply_io'
                        THEN (c.stats->>'linkedinMessagesSent')::bigint ELSE 0 END), 0)                                AS linkedin_messages_sent_campaign,
      COALESCE(SUM(COALESCE((c.stats->>'linkedinConnectionsSent')::bigint,
                            (c.stats->>'connectionsSent')::bigint)), 0)                                                AS linkedin_connections_sent,
      COALESCE(SUM(COALESCE((c.stats->>'linkedinConnectionsAccepted')::bigint,
                            (c.stats->>'connectionsAccepted')::bigint)), 0)                                            AS linkedin_connections_accepted,
      COALESCE(SUM(CASE WHEN lower(COALESCE(c.source, '')) = 'reply_io'
                           AND lower(COALESCE(c.channel, '')) <> 'email'
                        THEN (c.stats->>'sent')::bigint ELSE 0 END), 0)                                                AS email_sends_reply_null_channel
    FROM scope_campaigns c
  ),

  event_counts AS (
    SELECT
      COUNT(*) FILTER (WHERE e.channel = 'linkedin' AND e.event_type = 'sent')::bigint                                     AS linkedin_messages_sent,
      COUNT(DISTINCT e.person_key)::bigint                                                                                 AS contacts_people,
      COUNT(DISTINCT e.person_key) FILTER (WHERE e.event_type = 'replied')::bigint                                         AS replied_people,
      COUNT(DISTINCT e.person_key) FILTER (WHERE e.event_type = 'replied' AND e.channel = 'email')::bigint                 AS replied_people_email,
      COUNT(DISTINCT e.person_key) FILTER (WHERE e.event_type = 'replied' AND e.channel = 'linkedin')::bigint              AS replied_people_linkedin,
      COUNT(DISTINCT e.person_key) FILTER (WHERE e.event_type = 'classified' AND e.intent = 'interested' AND e.channel = 'email')::bigint     AS interested_people_email,
      COUNT(DISTINCT e.person_key) FILTER (WHERE e.event_type = 'classified' AND e.intent = 'interested' AND e.channel = 'linkedin')::bigint  AS interested_people_linkedin,
      COUNT(DISTINCT e.person_key) FILTER (WHERE e.event_type = 'classified' AND e.intent = 'interested')::bigint          AS interested_people
    FROM scope_events e
  )
SELECT jsonb_build_object(
  'totalContactsDeduped',           (SELECT COUNT(DISTINCT dedupe_key) FROM contacts_all),
  'totalContactsLinkedinDeduped',   (SELECT COUNT(DISTINCT dedupe_key) FROM contacts_linkedin),
  'totalContactsEmailDeduped',      (SELECT COUNT(DISTINCT dedupe_key) FROM contacts_email),
  'contactsRowsReply',              (SELECT reply_rows FROM rows_by_source),
  'contactsRowsSmartlead',          (SELECT smartlead_rows FROM rows_by_source),
  'emailSends',                     (SELECT email_sends FROM campaign_sums),
  'emailSendsSmartlead',            (SELECT email_sends_smartlead FROM campaign_sums),
  'emailSendsReply',                (SELECT email_sends_reply FROM campaign_sums),
  'emailRepliesSmartleadCampaign',  (SELECT email_replies_smartlead_campaign FROM campaign_sums),
  'emailRepliesReplyCampaign',      (SELECT email_replies_reply_campaign FROM campaign_sums),
  'smartleadSeats',                 (SELECT smartlead_seats FROM campaign_sums),
  'linkedinMessagesSent',           (SELECT linkedin_messages_sent FROM event_counts),
  'linkedinMessagesSentCampaign',   (SELECT linkedin_messages_sent_campaign FROM campaign_sums),
  'linkedinConnectionsSent',        (SELECT linkedin_connections_sent FROM campaign_sums),
  'linkedinConnectionsAccepted',    (SELECT linkedin_connections_accepted FROM campaign_sums),
  'contactsPeople',                 (SELECT contacts_people FROM event_counts),
  'repliedPeople',                  (SELECT replied_people FROM event_counts),
  'repliedPeopleEmail',             (SELECT replied_people_email FROM event_counts),
  'repliedPeopleLinkedin',          (SELECT replied_people_linkedin FROM event_counts),
  'interestedPeopleEmail',          (SELECT interested_people_email FROM event_counts),
  'interestedPeopleLinkedin',       (SELECT interested_people_linkedin FROM event_counts),
  'interestedPeople',               (SELECT interested_people FROM event_counts),
  'emailSendsReplyNullChannel',     (SELECT email_sends_reply_null_channel FROM campaign_sums)
);
$$;

COMMENT ON FUNCTION public.admin_inference_base_kpis(uuid[])
  IS 'Aggregate Admin Inference Base KPIs in one SQL call. Optional team filter via p_team_ids.';

