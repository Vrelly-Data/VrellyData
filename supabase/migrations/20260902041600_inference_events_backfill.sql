-- Inference Moat v1 — idempotent backfill into public.inference_events
-- ADDITIVE ONLY: inserts into the new table; does not modify existing rows.
-- Safe to re-run: ON CONFLICT DO NOTHING against (source, source_row_id, event_type).

-- 1) From agent_leads → 'replied'
INSERT INTO public.inference_events (
  team_id, agent_config_id,
  person_key, email, linkedin_url,
  full_name, job_title, company_name,
  channel, campaign_external_id, campaign_name,
  event_type, intent, is_objection, pipeline_stage, disposition_tag,
  occurred_at, source, source_row_id, metadata
)
SELECT
  public.get_user_team_id(al.user_id)                           AS team_id,
  al.agent_config_id,
  COALESCE(NULLIF(lower(al.email), ''), NULLIF(al.linkedin_url, ''), al.external_id) AS person_key,
  NULLIF(lower(al.email), '')                                   AS email,
  NULLIF(al.linkedin_url, '')                                   AS linkedin_url,
  COALESCE(NULLIF(al.full_name, ''), NULLIF(sc_e.first_name, '') || ' ' || NULLIF(sc_e.last_name, '')) AS full_name,
  COALESCE(NULLIF(al.job_title, ''), NULLIF(sc_e.job_title, ''), NULLIF(sc_l.job_title, '')) AS job_title,
  COALESCE(NULLIF(al.company, ''), NULLIF(sc_e.company, ''), NULLIF(sc_l.company, ''))       AS company_name,
  -- below firmographics are only from synced_contacts when present
  COALESCE(NULLIF(sc_e.industry, ''), NULLIF(sc_l.industry, ''))                               AS industry,
  COALESCE(NULLIF(sc_e.city, ''), NULLIF(sc_l.city, ''))                                       AS city,
  COALESCE(NULLIF(sc_e.state, ''), NULLIF(sc_l.state, ''))                                     AS state,
  COALESCE(NULLIF(sc_e.country, ''), NULLIF(sc_l.country, ''))                                 AS country,
  COALESCE(NULLIF(sc_e.company_size, ''), NULLIF(sc_l.company_size, ''))                       AS company_size,
  al.channel,
  al.campaign_external_id,
  al.last_campaign_name                                         AS campaign_name,
  'replied'                                                     AS event_type,
  NULLIF(al.intent, '')                                         AS intent,
  NULL::boolean                                                 AS is_objection,
  al.pipeline_stage,
  al.disposition_tag,
  al.last_reply_at                                              AS occurred_at,
  'agent_leads'                                                 AS source,
  al.id::text                                                   AS source_row_id,
  jsonb_build_object('backfill', true)
FROM public.agent_leads al
LEFT JOIN public.synced_contacts sc_e
  ON sc_e.team_id = public.get_user_team_id(al.user_id)
 AND sc_e.email IS NOT NULL
 AND lower(sc_e.email) = lower(al.email)
LEFT JOIN public.synced_contacts sc_l
  ON sc_l.team_id = public.get_user_team_id(al.user_id)
 AND sc_l.linkedin_url IS NOT NULL
 AND sc_l.linkedin_url = al.linkedin_url
WHERE al.last_reply_at IS NOT NULL
  AND COALESCE(NULLIF(lower(al.email), ''), NULLIF(al.linkedin_url, ''), al.external_id) IS NOT NULL
ON CONFLICT (source, source_row_id, event_type) DO NOTHING;

-- 2) From agent_leads → 'classified' (intent present). occurred_at = last_reply_at (best available).
INSERT INTO public.inference_events (
  team_id, agent_config_id,
  person_key, email, linkedin_url,
  full_name, job_title, company_name,
  channel, campaign_external_id, campaign_name,
  event_type, intent, is_objection, pipeline_stage, disposition_tag,
  occurred_at, source, source_row_id, metadata
)
SELECT
  public.get_user_team_id(al.user_id)                           AS team_id,
  al.agent_config_id,
  COALESCE(NULLIF(lower(al.email), ''), NULLIF(al.linkedin_url, ''), al.external_id) AS person_key,
  NULLIF(lower(al.email), '')                                   AS email,
  NULLIF(al.linkedin_url, '')                                   AS linkedin_url,
  COALESCE(NULLIF(al.full_name, ''), NULLIF(sc_e.first_name, '') || ' ' || NULLIF(sc_e.last_name, '')) AS full_name,
  COALESCE(NULLIF(al.job_title, ''), NULLIF(sc_e.job_title, ''), NULLIF(sc_l.job_title, ''))           AS job_title,
  COALESCE(NULLIF(al.company, ''), NULLIF(sc_e.company, ''), NULLIF(sc_l.company, ''))                 AS company_name,
  COALESCE(NULLIF(sc_e.industry, ''), NULLIF(sc_l.industry, ''))                                       AS industry,
  COALESCE(NULLIF(sc_e.city, ''), NULLIF(sc_l.city, ''))                                               AS city,
  COALESCE(NULLIF(sc_e.state, ''), NULLIF(sc_l.state, ''))                                             AS state,
  COALESCE(NULLIF(sc_e.country, ''), NULLIF(sc_l.country, ''))                                         AS country,
  COALESCE(NULLIF(sc_e.company_size, ''), NULLIF(sc_l.company_size, ''))                               AS company_size,
  al.channel,
  al.campaign_external_id,
  al.last_campaign_name                                         AS campaign_name,
  'classified'                                                  AS event_type,
  NULLIF(al.intent, '')                                         AS intent,
  NULL::boolean                                                 AS is_objection,
  al.pipeline_stage,
  al.disposition_tag,
  al.last_reply_at                                              AS occurred_at,
  'agent_leads'                                                 AS source,
  al.id::text                                                   AS source_row_id,
  jsonb_build_object('backfill', true, 'prospect_read', al.prospect_read)
FROM public.agent_leads al
LEFT JOIN public.synced_contacts sc_e
  ON sc_e.team_id = public.get_user_team_id(al.user_id)
 AND sc_e.email IS NOT NULL
 AND lower(sc_e.email) = lower(al.email)
LEFT JOIN public.synced_contacts sc_l
  ON sc_l.team_id = public.get_user_team_id(al.user_id)
 AND sc_l.linkedin_url IS NOT NULL
 AND sc_l.linkedin_url = al.linkedin_url
WHERE al.last_reply_at IS NOT NULL
  AND NULLIF(al.intent, '') IS NOT NULL
  AND COALESCE(NULLIF(lower(al.email), ''), NULLIF(al.linkedin_url, ''), al.external_id) IS NOT NULL
ON CONFLICT (source, source_row_id, event_type) DO NOTHING;

-- 3) From draft_audit → 'classified' (richer intent labels). occurred_at = created_at.
INSERT INTO public.inference_events (
  team_id, agent_config_id,
  person_key, email, linkedin_url,
  full_name, job_title, company_name,
  channel, campaign_external_id, campaign_name,
  event_type, intent, is_objection, pipeline_stage, disposition_tag,
  occurred_at, source, source_row_id, metadata
)
SELECT
  public.get_user_team_id(da.user_id)                           AS team_id,
  NULL::uuid                                                    AS agent_config_id,
  COALESCE(NULLIF(lower(al.email), ''), NULLIF(al.linkedin_url, ''), al.external_id) AS person_key,
  NULLIF(lower(al.email), '')                                   AS email,
  NULLIF(al.linkedin_url, '')                                   AS linkedin_url,
  al.full_name,
  al.job_title,
  al.company                                                    AS company_name,
  da.channel,
  al.campaign_external_id,
  al.last_campaign_name                                         AS campaign_name,
  'classified'                                                  AS event_type,
  NULLIF(da.intent_classified, '')                              AS intent,
  CASE
    WHEN (da.metadata ? 'is_objection') THEN (da.metadata->>'is_objection')::boolean
    ELSE NULL
  END                                                           AS is_objection,
  al.pipeline_stage,
  al.disposition_tag,
  da.created_at                                                 AS occurred_at,
  'draft_audit'                                                 AS source,
  da.id::text                                                   AS source_row_id,
  jsonb_build_object(
    'backfill', true,
    'intent_confidence', da.intent_confidence,
    'prompt_version', da.prompt_version
  ) || COALESCE(da.metadata, '{}'::jsonb)
FROM public.draft_audit da
LEFT JOIN public.agent_leads al ON al.id = da.lead_id
WHERE da.created_at IS NOT NULL
  AND COALESCE(NULLIF(lower(al.email), ''), NULLIF(al.linkedin_url, ''), al.external_id) IS NOT NULL
ON CONFLICT (source, source_row_id, event_type) DO NOTHING;

