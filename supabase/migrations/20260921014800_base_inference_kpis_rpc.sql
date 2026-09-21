-- Admin Inference Base KPIs RPC
-- Purpose: server-side aggregates to avoid heavy client-side paging
-- Inputs:
--   p_team_ids  TEXT[] NULL  → optional filter by team_id
--   p_date_from TIMESTAMPTZ  → optional lower bound on occurred_at (events-based metrics only)
--   p_date_to   TIMESTAMPTZ  → optional upper bound on occurred_at (events-based metrics only)
--
-- Returns a single row with fields:
--   total_contacts_deduped
--   total_contacts_linkedin_deduped
--   total_contacts_email_deduped
--   contacts_rows_reply
--   contacts_rows_smartlead
--   contacts_people
--   replied_people
--   replied_people_email
--   replied_people_linkedin
--   interested_people_email
--   interested_people_linkedin
--   interested_people
--
-- Notes:
-- - Dedup key for contacts: prefer normalized email; else normalized linkedin_url; else row id
-- - Channel/source are derived from public.synced_campaigns (channel, source columns)
-- - SECURITY INVOKER so RLS applies per-table for the caller
-- - STABLE: deterministic for given inputs within a transaction

CREATE OR REPLACE FUNCTION public.get_base_inference_kpis(
  p_team_ids  TEXT[] DEFAULT NULL,
  p_date_from TIMESTAMPTZ DEFAULT NULL,
  p_date_to   TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  total_contacts_deduped BIGINT,
  total_contacts_linkedin_deduped BIGINT,
  total_contacts_email_deduped BIGINT,
  contacts_rows_reply BIGINT,
  contacts_rows_smartlead BIGINT,
  contacts_people BIGINT,
  replied_people BIGINT,
  replied_people_email BIGINT,
  replied_people_linkedin BIGINT,
  interested_people_email BIGINT,
  interested_people_linkedin BIGINT,
  interested_people BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
WITH params AS (
  SELECT
    p_team_ids    AS team_ids,
    p_date_from   AS date_from,
    p_date_to     AS date_to
),
contacts AS (
  SELECT
    c.id,
    /* normalize email: trim + lower, empty → NULL */
    NULLIF(LOWER(TRIM(c.email)), '') AS norm_email,
    /* normalize linkedin: lower, strip protocol, strip query, trim trailing slashes, empty → NULL */
    NULLIF(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          LOWER(SPLIT_PART(COALESCE(c.linkedin_url, ''), '?', 1)),
          '^https?://', ''
        ),
        '/+$', ''
      ),
      ''
    ) AS norm_linkedin,
    c.campaign_id,
    c.team_id
  FROM public.synced_contacts c
  WHERE
    p_team_ids IS NULL
    OR c.team_id = ANY (p_team_ids)
),
contacts_with_sc AS (
  SELECT ct.*, sc.channel, sc.source
  FROM contacts ct
  LEFT JOIN public.synced_campaigns sc
    ON sc.id = ct.campaign_id
),
dedup_keys_all AS (
  SELECT COALESCE('e:' || norm_email, 'l:' || norm_linkedin, 'i:' || id) AS k
  FROM contacts
),
dedup_keys_email AS (
  SELECT COALESCE('e:' || norm_email, 'l:' || norm_linkedin, 'i:' || id) AS k
  FROM contacts_with_sc
  WHERE LOWER(COALESCE(channel, '')) = 'email'
),
dedup_keys_linkedin AS (
  SELECT COALESCE('e:' || norm_email, 'l:' || norm_linkedin, 'i:' || id) AS k
  FROM contacts_with_sc
  WHERE LOWER(COALESCE(channel, '')) = 'linkedin'
),
filtered_events AS (
  SELECT e.person_key, e.event_type, e.channel, e.intent
  FROM public.inference_events_enriched e
  WHERE
    (p_team_ids IS NULL OR e.team_id = ANY (p_team_ids))
    AND (p_date_from IS NULL OR e.occurred_at >= p_date_from)
    AND (p_date_to   IS NULL OR e.occurred_at <= p_date_to)
)
SELECT
  /* contacts dedup */
  (SELECT COUNT(DISTINCT k) FROM dedup_keys_all)       AS total_contacts_deduped,
  (SELECT COUNT(DISTINCT k) FROM dedup_keys_linkedin)  AS total_contacts_linkedin_deduped,
  (SELECT COUNT(DISTINCT k) FROM dedup_keys_email)     AS total_contacts_email_deduped,
  /* contact rows by source */
  (SELECT COUNT(*) FROM contacts_with_sc WHERE LOWER(COALESCE(source, '')) = 'reply_io')  AS contacts_rows_reply,
  (SELECT COUNT(*) FROM contacts_with_sc WHERE LOWER(COALESCE(source, '')) = 'smartlead') AS contacts_rows_smartlead,
  /* events-based distinct people metrics */
  (SELECT COUNT(DISTINCT person_key) FROM filtered_events)                                                     AS contacts_people,
  (SELECT COUNT(DISTINCT person_key) FROM filtered_events WHERE event_type = 'replied')                        AS replied_people,
  (SELECT COUNT(DISTINCT person_key) FROM filtered_events WHERE event_type = 'replied' AND channel = 'email')  AS replied_people_email,
  (SELECT COUNT(DISTINCT person_key) FROM filtered_events WHERE event_type = 'replied' AND channel = 'linkedin') AS replied_people_linkedin,
  (SELECT COUNT(DISTINCT person_key) FROM filtered_events WHERE event_type = 'classified' AND intent = 'interested' AND channel = 'email')    AS interested_people_email,
  (SELECT COUNT(DISTINCT person_key) FROM filtered_events WHERE event_type = 'classified' AND intent = 'interested' AND channel = 'linkedin') AS interested_people_linkedin,
  (SELECT COUNT(DISTINCT person_key) FROM filtered_events WHERE event_type = 'classified' AND intent = 'interested')                           AS interested_people
$$;

COMMENT ON FUNCTION public.get_base_inference_kpis(TEXT[], TIMESTAMPTZ, TIMESTAMPTZ)
  IS 'Admin Inference Base KPIs aggregates with optional team/date filters. SECURITY INVOKER so RLS applies.';

