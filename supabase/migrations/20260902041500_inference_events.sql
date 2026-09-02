-- Inference Moat v1 — additive event store
-- One row = one observed, teachable outcome.
-- Strictly additive: does not modify existing tables or RLS.
-- Safe to re-apply: IF NOT EXISTS guards + duplicate_object traps.
-- 
-- Columns follow the spec: typed, jsonb only for extras.
-- RLS: service role can write; team members can read own team; platform/super admins can read all.

CREATE TABLE IF NOT EXISTS public.inference_events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Identity / tenancy
  team_id              uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  organization_id      uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  agent_config_id      uuid REFERENCES public.agent_configs(id) ON DELETE SET NULL,
  person_key           text NOT NULL,  -- normalized email (preferred) or linkedin url or stable external id
  email                text,
  linkedin_url         text,
  -- Firmographics snapshot (at time of event)
  full_name            text,
  job_title            text,
  seniority            text,
  department           text,
  company_name         text,
  industry             text,
  city                 text,
  state                text,
  country              text,
  company_size         text,
  -- What we sent
  channel              text NOT NULL CHECK (channel IN ('email','linkedin','other')),
  campaign_external_id text,
  campaign_name        text,
  sequence_step_type   text,  -- e.g. email, linkedin_connect, linkedin_message, linkedin_view_profile, linkedin_inmail, call, manual_task, unknown
  copy_fingerprint     text,  -- hash of outbound subject+body or message text (when available)
  subject              text,
  -- What happened
  event_type           text NOT NULL CHECK (event_type IN ('sent','opened','replied','bounced','opted_out','meeting_booked','closed_won','closed_lost','classified')),
  intent               text,  -- interested, not_interested, referral, out_of_office, bounce, needs_more_info, unknown
  is_objection         boolean,
  pipeline_stage       text,
  disposition_tag      text,
  occurred_at          timestamptz NOT NULL,
  -- Provenance
  source               text NOT NULL,  -- agent_leads, draft_audit, synced_contacts, classify_reply, reply_webhook, heyreach_webhook, smartlead_webhook, poll_reply_inbox, ...
  source_row_id        text,
  metadata             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- Indexes for common questions
CREATE INDEX IF NOT EXISTS idx_inference_intent_job_title ON public.inference_events (intent, job_title);
CREATE INDEX IF NOT EXISTS idx_inference_intent_industry  ON public.inference_events (intent, industry);
CREATE INDEX IF NOT EXISTS idx_inference_intent_city      ON public.inference_events (intent, city);
CREATE INDEX IF NOT EXISTS idx_inference_channel_step_intent ON public.inference_events (channel, sequence_step_type, intent);
CREATE INDEX IF NOT EXISTS idx_inference_team_time ON public.inference_events (team_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_inference_person_key ON public.inference_events (person_key);

-- Unique-ish dedupe when a stable source row id exists
CREATE UNIQUE INDEX IF NOT EXISTS idx_inference_source_row_event_unique
  ON public.inference_events (source, source_row_id, event_type)
  WHERE source_row_id IS NOT NULL;

-- RLS: cross-client store — deny by default
ALTER TABLE public.inference_events ENABLE ROW LEVEL SECURITY;

-- Service role can do anything
DO $pol$ BEGIN
  CREATE POLICY "Service role full access"
    ON public.inference_events
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $pol$;

-- Platform/super admins can read all rows
DO $pol$ BEGIN
  CREATE POLICY "Platform admins can read all inference events"
    ON public.inference_events
    FOR SELECT
    USING (EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND (p.is_platform_admin = true OR p.is_super_admin = true)
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $pol$;

-- Team members can read their own team's rows
DO $pol$ BEGIN
  CREATE POLICY "Users can read their team inference events"
    ON public.inference_events
    FOR SELECT
    USING (team_id = public.get_user_team_id(auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $pol$;

-- No generic INSERT/UPDATE/DELETE for clients (service role only via policy above)

-- Sanity-check views (security invoker so RLS applies)
DROP VIEW IF EXISTS public.inference_title_intent;
CREATE VIEW public.inference_title_intent
WITH (security_invoker = true)
AS
SELECT
  COALESCE(NULLIF(trim(job_title), ''), '(unknown)') AS job_title,
  COALESCE(NULLIF(trim(intent), ''), 'unknown')      AS intent,
  COUNT(*)::bigint                                   AS n
FROM public.inference_events
GROUP BY 1,2
ORDER BY n DESC;

DROP VIEW IF EXISTS public.inference_channel_step_intent;
CREATE VIEW public.inference_channel_step_intent
WITH (security_invoker = true)
AS
SELECT
  channel,
  COALESCE(NULLIF(trim(sequence_step_type), ''), '(unknown)') AS sequence_step_type,
  COALESCE(NULLIF(trim(intent), ''), 'unknown')               AS intent,
  COUNT(*)::bigint                                            AS n
FROM public.inference_events
GROUP BY 1,2,3
ORDER BY n DESC;

-- Notes:
-- - This migration is additive and does not alter existing tables or policies.
-- - Clients must NEVER see other clients' rows; RLS enforces that.
-- - Service role inserts/updates come from edge functions (fire-and-forget).
-- - Views are for ad-hoc sanity only; no UI changes in this PR.

