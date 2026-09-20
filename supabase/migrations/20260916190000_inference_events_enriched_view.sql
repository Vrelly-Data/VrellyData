-- Enriched inference events view
-- Purpose: prefer firmographics from public.people over inference_events where
-- the event fields are blank/null/whitespace — without mutating base rows.
-- Security invoker so RLS applies.
-- Safe to re-run.

DROP VIEW IF EXISTS public.inference_events_enriched;
CREATE VIEW public.inference_events_enriched
WITH (security_invoker = true)
AS
SELECT
  e.id,
  e.team_id,
  e.organization_id,
  e.agent_config_id,
  e.person_key,
  e.email,
  e.linkedin_url,
  e.full_name,
  /* Prefer people.job_title when present; otherwise keep event value */
  COALESCE(NULLIF(p.job_title, ''), NULLIF(e.job_title, '')) AS job_title,
  e.seniority,
  e.department,
  e.company_name,
  /* Prefer people.industry when present; otherwise keep event value; allow NULL for '(unknown)' handling in UI */
  COALESCE(NULLIF(p.industry, ''), NULLIF(e.industry, '')) AS industry,
  /* Prefer people.city when present; otherwise keep event value */
  COALESCE(NULLIF(p.city, ''), NULLIF(e.city, '')) AS city,
  e.state,
  e.country,
  e.company_size,
  e.channel,
  e.campaign_external_id,
  e.campaign_name,
  e.sequence_step_type,
  e.copy_fingerprint,
  e.subject,
  e.event_type,
  e.intent,
  e.is_objection,
  e.pipeline_stage,
  e.disposition_tag,
  e.occurred_at,
  e.source,
  e.source_row_id,
  e.metadata,
  e.created_at
FROM public.inference_events e
LEFT JOIN public.people p
  ON p.team_id = e.team_id
 AND p.person_key = e.person_key;

-- Notes:
-- - This view now overrides job_title, industry, and city using people when
--   available. Other fields (e.g. company_name) remain pass-through.
-- - The UI should treat NULL/empty as "Unknown" if it chooses to display it.

