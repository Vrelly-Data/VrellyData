-- Inference Moat v1 — firmographic enrich for backfill
-- ADDITIVE ONLY: inserts into public.inference_events; does not modify existing rows.
-- Safe to re-run: ON CONFLICT DO NOTHING against (source, source_row_id, event_type).
-- Purpose: when agent_leads is missing person/cos. attributes, coalesce from synced_contacts
-- by matching on team AND (lower(email) and/or linkedin_url).

-- 1) agent_leads → 'replied' with firmographics from synced_contacts as fallback
INSERT INTO public.inference_events (
  team_id, agent_config_id,
  person_key, email, linkedin_url,
  full_name, job_title, company_name,
  industry, city, state, country, company_size,
  channel, campaign_external_id, campaign_name,
  event_type, intent, is_objection, pipeline_stage, disposition_tag,
  occurred_at, source, source_row_id, metadata
)
SELECT
  public.get_user_team_id(al.user_id)                                                     AS team_id,
  al.agent_config_id,
  COALESCE(NULLIF(lower(al.email), ''), NULLIF(al.linkedin_url, ''), al.external_id)      AS person_key,
  NULLIF(lower(al.email), '')                                                             AS email,
  NULLIF(al.linkedin_url, '')                                                             AS linkedin_url,
  COALESCE(NULLIF(al.full_name, ''), NULLIF(trim(concat_ws(' ', sc.first_name, sc.last_name)), '')) AS full_name,
  COALESCE(NULLIF(al.job_title, ''), NULLIF(sc.job_title, ''))                            AS job_title,
  al.company                                                                              AS company_name,
  NULLIF(sc.industry, '')                                                                 AS industry,
  NULLIF(sc.city, '')                                                                     AS city,
  NULLIF(sc.state, '')                                                                    AS state,
  NULLIF(sc.country, '')                                                                  AS country,
  NULLIF(sc.company_size, '')                                                             AS company_size,
  al.channel,
  al.campaign_external_id,
  al.last_campaign_name                                                                   AS campaign_name,
  'replied'                                                                               AS event_type,
  NULLIF(al.intent, '')                                                                   AS intent,
  NULL::boolean                                                                           AS is_objection,
  al.pipeline_stage,
  al.disposition_tag,
  al.last_reply_at                                                                        AS occurred_at,
  'agent_leads'                                                                           AS source,
  al.id::text                                                                             AS source_row_id,
  jsonb_build_object('backfill', true, 'firmographics_from_synced_contacts', true)
FROM public.agent_leads al
LEFT JOIN public.synced_contacts sc
  ON sc.team_id = public.get_user_team_id(al.user_id)
  AND (
    (NULLIF(lower(al.email), '') IS NOT NULL AND lower(sc.email) = lower(al.email))
    OR (NULLIF(al.linkedin_url, '') IS NOT NULL AND sc.linkedin_url = al.linkedin_url)
  )
WHERE al.last_reply_at IS NOT NULL
  AND COALESCE(NULLIF(lower(al.email), ''), NULLIF(al.linkedin_url, ''), al.external_id) IS NOT NULL
ON CONFLICT (source, source_row_id, event_type) DO NOTHING;

-- 2) agent_leads → 'classified' with same coalesce logic
INSERT INTO public.inference_events (
  team_id, agent_config_id,
  person_key, email, linkedin_url,
  full_name, job_title, company_name,
  industry, city, state, country, company_size,
  channel, campaign_external_id, campaign_name,
  event_type, intent, is_objection, pipeline_stage, disposition_tag,
  occurred_at, source, source_row_id, metadata
)
SELECT
  public.get_user_team_id(al.user_id)                                                     AS team_id,
  al.agent_config_id,
  COALESCE(NULLIF(lower(al.email), ''), NULLIF(al.linkedin_url, ''), al.external_id)      AS person_key,
  NULLIF(lower(al.email), '')                                                             AS email,
  NULLIF(al.linkedin_url, '')                                                             AS linkedin_url,
  COALESCE(NULLIF(al.full_name, ''), NULLIF(trim(concat_ws(' ', sc.first_name, sc.last_name)), '')) AS full_name,
  COALESCE(NULLIF(al.job_title, ''), NULLIF(sc.job_title, ''))                            AS job_title,
  al.company                                                                              AS company_name,
  NULLIF(sc.industry, '')                                                                 AS industry,
  NULLIF(sc.city, '')                                                                     AS city,
  NULLIF(sc.state, '')                                                                    AS state,
  NULLIF(sc.country, '')                                                                  AS country,
  NULLIF(sc.company_size, '')                                                             AS company_size,
  al.channel,
  al.campaign_external_id,
  al.last_campaign_name                                                                   AS campaign_name,
  'classified'                                                                            AS event_type,
  NULLIF(al.intent, '')                                                                   AS intent,
  NULL::boolean                                                                           AS is_objection,
  al.pipeline_stage,
  al.disposition_tag,
  al.last_reply_at                                                                        AS occurred_at,
  'agent_leads'                                                                           AS source,
  al.id::text                                                                             AS source_row_id,
  jsonb_build_object('backfill', true, 'firmographics_from_synced_contacts', true, 'prospect_read', al.prospect_read)
FROM public.agent_leads al
LEFT JOIN public.synced_contacts sc
  ON sc.team_id = public.get_user_team_id(al.user_id)
  AND (
    (NULLIF(lower(al.email), '') IS NOT NULL AND lower(sc.email) = lower(al.email))
    OR (NULLIF(al.linkedin_url, '') IS NOT NULL AND sc.linkedin_url = al.linkedin_url)
  )
WHERE al.last_reply_at IS NOT NULL
  AND NULLIF(al.intent, '') IS NOT NULL
  AND COALESCE(NULLIF(lower(al.email), ''), NULLIF(al.linkedin_url, ''), al.external_id) IS NOT NULL
ON CONFLICT (source, source_row_id, event_type) DO NOTHING;

-- 3) draft_audit → 'classified' with join through lead + roster
INSERT INTO public.inference_events (
  team_id, agent_config_id,
  person_key, email, linkedin_url,
  full_name, job_title, company_name,
  industry, city, state, country, company_size,
  channel, campaign_external_id, campaign_name,
  event_type, intent, is_objection, pipeline_stage, disposition_tag,
  occurred_at, source, source_row_id, metadata
)
SELECT
  public.get_user_team_id(da.user_id)                                                     AS team_id,
  NULL::uuid                                                                              AS agent_config_id,
  COALESCE(NULLIF(lower(al.email), ''), NULLIF(al.linkedin_url, ''), al.external_id)      AS person_key,
  NULLIF(lower(al.email), '')                                                             AS email,
  NULLIF(al.linkedin_url, '')                                                             AS linkedin_url,
  COALESCE(NULLIF(al.full_name, ''), NULLIF(trim(concat_ws(' ', sc.first_name, sc.last_name)), '')) AS full_name,
  COALESCE(NULLIF(al.job_title, ''), NULLIF(sc.job_title, ''))                            AS job_title,
  al.company                                                                              AS company_name,
  NULLIF(sc.industry, '')                                                                 AS industry,
  NULLIF(sc.city, '')                                                                     AS city,
  NULLIF(sc.state, '')                                                                    AS state,
  NULLIF(sc.country, '')                                                                  AS country,
  NULLIF(sc.company_size, '')                                                             AS company_size,
  da.channel,
  al.campaign_external_id,
  al.last_campaign_name                                                                   AS campaign_name,
  'classified'                                                                            AS event_type,
  NULLIF(da.intent_classified, '')                                                        AS intent,
  CASE WHEN (da.metadata ? 'is_objection') THEN (da.metadata->>'is_objection')::boolean ELSE NULL END AS is_objection,
  al.pipeline_stage,
  al.disposition_tag,
  da.created_at                                                                           AS occurred_at,
  'draft_audit'                                                                           AS source,
  da.id::text                                                                             AS source_row_id,
  jsonb_build_object(
    'backfill', true,
    'firmographics_from_synced_contacts', true,
    'intent_confidence', da.intent_confidence,
    'prompt_version', da.prompt_version
  ) || COALESCE(da.metadata, '{}'::jsonb)
FROM public.draft_audit da
LEFT JOIN public.agent_leads al ON al.id = da.lead_id
LEFT JOIN public.synced_contacts sc
  ON sc.team_id = public.get_user_team_id(da.user_id)
  AND (
    (NULLIF(lower(al.email), '') IS NOT NULL AND lower(sc.email) = lower(al.email))
    OR (NULLIF(al.linkedin_url, '') IS NOT NULL AND sc.linkedin_url = al.linkedin_url)
  )
WHERE da.created_at IS NOT NULL
  AND COALESCE(NULLIF(lower(al.email), ''), NULLIF(al.linkedin_url, ''), al.external_id) IS NOT NULL
ON CONFLICT (source, source_row_id, event_type) DO NOTHING;

