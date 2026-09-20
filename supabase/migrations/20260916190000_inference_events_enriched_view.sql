-- Enriched inference events view
-- Purpose: prefer people.industry over inference_events.industry for analytics,
-- without mutating the base event rows. Security invoker so RLS applies.
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
  e.job_title,
  e.seniority,
  e.department,
  e.company_name,
  /* Prefer people.industry when present; otherwise keep event value; allow NULL for '(unknown)' handling in UI */
  COALESCE(NULLIF(p.industry, ''), NULLIF(e.industry, '')) AS industry,
  e.city,
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
-- - This view intentionally only overrides `industry` to reduce ambiguity.
-- - Additional firmographics can be layered in the future if needed.

