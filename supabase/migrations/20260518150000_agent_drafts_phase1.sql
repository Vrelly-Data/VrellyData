-- Phase 1 — AI draft-quality groundwork.
--
-- This migration is idempotent (safe to re-run) and intended for Studio
-- apply per the project's migration-backlog convention. It does three
-- additive things and one non-thing:
--
--   PART A. Extend agent_configs with five nullable TEXT columns that
--           carry sales context the classify-reply prompt needs:
--           calendar_link, pricing_summary, case_studies,
--           disqualification_criteria, objection_handling_notes.
--           Then seed the current operator's row with starter values
--           so Phase 2 has something to render against immediately.
--           The seed UPDATE uses COALESCE so re-applies never clobber
--           values the operator has filled in via Settings.
--
--   PART B. Widen agent_activity.activity_type's CHECK constraint to
--           allow two new types: 'draft_edited' and 'learning_added'.
--           Per the AgentActivity audit, corrections + captured learnings
--           live as agent_activity rows (with a JSONB metadata blob),
--           not as a separate draft_corrections table.
--
--   PART C. Create draft_audit — an append-only telemetry table for
--           every classify-reply generation. Mirrors the
--           credit_transactions pattern: SELECT + INSERT policies only,
--           no UPDATE/DELETE — rows are immutable.
--
--   PART D. (Not creating draft_corrections.) Comment-only to document
--           the decision.
--
-- Apply via Studio. Do not run via `npx supabase db push` given the
-- existing migration backlog.

-- =============================================================================
-- PART A — agent_configs: add sales-context columns + seed operator row
-- =============================================================================

ALTER TABLE public.agent_configs
  ADD COLUMN IF NOT EXISTS calendar_link              TEXT,
  ADD COLUMN IF NOT EXISTS pricing_summary            TEXT,
  ADD COLUMN IF NOT EXISTS case_studies               TEXT,
  ADD COLUMN IF NOT EXISTS disqualification_criteria  TEXT,
  ADD COLUMN IF NOT EXISTS objection_handling_notes   TEXT;

-- Seed the operator's row. COALESCE preserves any value the operator has
-- already entered via Settings, so re-running this migration is a no-op
-- for fields that have been populated. Real values for calendar_link and
-- case_studies; placeholder strings for the other three until the
-- operator edits them in Settings UI.
UPDATE public.agent_configs
SET
  calendar_link = COALESCE(
    calendar_link,
    'https://calendly.com/myall-vrelly/30min'
  ),
  pricing_summary = COALESCE(
    pricing_summary,
    '<TODO - Myall will provide later>'
  ),
  case_studies = COALESCE(
    case_studies,
    $cs$Case studies the agent can reference:
- Private Equity firm: 100+ meetings per month from outbound
- Medical Device Regulatory company: $100K+ in contracts in under 1 month
- Independent Consultant: 10 meetings in week 1$cs$
  ),
  disqualification_criteria = COALESCE(
    disqualification_criteria,
    '<TODO - Myall will provide later>'
  ),
  objection_handling_notes = COALESCE(
    objection_handling_notes,
    '<TODO - Myall will provide later>'
  )
WHERE user_id = '5edc98cc-7762-43e8-ab8d-ae8d69a08db8';

-- =============================================================================
-- PART B — agent_activity.activity_type: widen CHECK to add new types
-- =============================================================================
-- Original constraint was defined inline in 20260403120000_agent_phase2.sql,
-- which means Postgres auto-named it `agent_activity_activity_type_check`.
-- Drop-then-add is idempotent and preserves the constraint name.

ALTER TABLE public.agent_activity
  DROP CONSTRAINT IF EXISTS agent_activity_activity_type_check;

ALTER TABLE public.agent_activity
  ADD CONSTRAINT agent_activity_activity_type_check
  CHECK (activity_type IN (
    'contact_added',
    'reply_received',
    'draft_created',
    'message_approved',
    'message_sent',
    'lead_stage_changed',
    'campaign_routed',
    'agent_run_completed',
    'agent_paused',
    'agent_resumed',
    -- Phase 1 additions:
    'draft_edited',
    'learning_added'
  ));

-- =============================================================================
-- PART C — draft_audit table (append-only telemetry per generation)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.draft_audit (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- No cascade on lead_id: telemetry survives a lead deletion, matching the
  -- agent_activity precedent so the analytics surface doesn't collapse on
  -- purges.
  lead_id             UUID REFERENCES agent_leads(id),
  lead_name           TEXT,
  lead_company        TEXT,
  channel             TEXT,
  model               TEXT,
  prompt_version      TEXT,
  temperature         NUMERIC,
  -- Fingerprint of the system prompt at generation time so prompt drift
  -- is auditable without storing the full ~2KB string per row.
  system_prompt_hash  TEXT,
  input_tokens        INTEGER,
  output_tokens       INTEGER,
  generation_ms       INTEGER,
  intent_classified   TEXT,
  intent_confidence   NUMERIC,
  draft_response      TEXT,
  metadata            JSONB DEFAULT '{}',
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_draft_audit_user
  ON public.draft_audit(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_draft_audit_lead
  ON public.draft_audit(lead_id);

ALTER TABLE public.draft_audit ENABLE ROW LEVEL SECURITY;

-- SELECT + INSERT only, no UPDATE / DELETE. Mirrors credit_transactions.
-- Idempotent CREATE POLICY via the DO $$ ... EXCEPTION WHEN duplicate_object
-- pattern used elsewhere in this codebase (see 20260412_create_agent_leads).
DO $pol$ BEGIN
  CREATE POLICY "Users can view their own draft audit"
    ON public.draft_audit FOR SELECT
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $pol$;

DO $pol$ BEGIN
  CREATE POLICY "Users can insert their own draft audit"
    ON public.draft_audit FOR INSERT
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $pol$;

-- =============================================================================
-- PART D — No draft_corrections table (intentionally)
-- =============================================================================
-- Per the architecture decision: draft corrections and captured learnings
-- live in agent_activity using the new activity_types added in PART B.
--
--   'draft_edited'   → metadata: { original_draft, final_sent,
--                                  was_edited, edit_distance, ... }
--   'learning_added' → metadata: { learning_text, intent_scope,
--                                  channel_scope, lead_context, ... }
--
-- No DDL needed here. This comment block intentionally documents the
-- absence so a future maintainer doesn't infer an oversight.
