-- Adjust get_base_inference_kpis to accept UUID[] for p_team_ids and add GRANTs
-- Ensures team_id (uuid) comparisons work without type cast errors.

-- Drop old signature (TEXT[]) if present
DROP FUNCTION IF EXISTS public.get_base_inference_kpis(TEXT[], TIMESTAMPTZ, TIMESTAMPTZ);

-- Create with UUID[] signature
CREATE OR REPLACE FUNCTION public.get_base_inference_kpis(
  p_team_ids  UUID[] DEFAULT NULL,
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
WITH contacts AS (
  SELECT
    c.id,
    NULLIF(LOWER(TRIM(c.email)), '') AS norm_email,
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
  (SELECT COUNT(DISTINCT k) FROM dedup_keys_all)       AS total_contacts_deduped,
  (SELECT COUNT(DISTINCT k) FROM dedup_keys_linkedin)  AS total_contacts_linkedin_deduped,
  (SELECT COUNT(DISTINCT k) FROM dedup_keys_email)     AS total_contacts_email_deduped,
  (SELECT COUNT(*) FROM contacts_with_sc WHERE LOWER(COALESCE(source, '')) = 'reply_io')  AS contacts_rows_reply,
  (SELECT COUNT(*) FROM contacts_with_sc WHERE LOWER(COALESCE(source, '')) = 'smartlead') AS contacts_rows_smartlead,
  (SELECT COUNT(DISTINCT person_key) FROM filtered_events)                                                     AS contacts_people,
  (SELECT COUNT(DISTINCT person_key) FROM filtered_events WHERE event_type = 'replied')                        AS replied_people,
  (SELECT COUNT(DISTINCT person_key) FROM filtered_events WHERE event_type = 'replied' AND channel = 'email')  AS replied_people_email,
  (SELECT COUNT(DISTINCT person_key) FROM filtered_events WHERE event_type = 'replied' AND channel = 'linkedin') AS replied_people_linkedin,
  (SELECT COUNT(DISTINCT person_key) FROM filtered_events WHERE event_type = 'classified' AND intent = 'interested' AND channel = 'email')    AS interested_people_email,
  (SELECT COUNT(DISTINCT person_key) FROM filtered_events WHERE event_type = 'classified' AND intent = 'interested' AND channel = 'linkedin') AS interested_people_linkedin,
  (SELECT COUNT(DISTINCT person_key) FROM filtered_events WHERE event_type = 'classified' AND intent = 'interested')                           AS interested_people
$$;

COMMENT ON FUNCTION public.get_base_inference_kpis(UUID[], TIMESTAMPTZ, TIMESTAMPTZ)
  IS 'Admin Inference Base KPIs aggregates with optional team/date filters. SECURITY INVOKER so RLS applies.';

-- Allow frontend/service roles to call
GRANT EXECUTE ON FUNCTION public.get_base_inference_kpis(UUID[], TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_base_inference_kpis(UUID[], TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

