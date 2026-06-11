-- Phase 1 — Data Analysis (internal admin section).
--
-- Adds two tables backing the "Data Analysis" tab in /playground (admin-only).
-- The generate-client-analysis edge function reads/writes these.
--
-- Forward-compat for Phase 2 (public client-facing link, NOT built yet):
--   * client_analysis.slug         — UNIQUE, set at create time; unused in
--                                    Phase 1, will become the public route.
--   * client_analysis.password_hash — left NULL; Phase 2 will hash a
--                                    per-client password for the gated read.
--
-- Migration backlog reminder: Phase 1 PR also includes a dev db push (manual)
-- and will need a manual prod db push at promotion time (pipeline is
-- functions-only).
--
--   PART A. client_analysis (one row per client, owned by an admin user).
--   PART B. client_checklist_items (separate rows so regeneration does NOT
--           wipe checked-off progress — the critical persistence test).
--
-- All policies idempotent via the established DO $pol$ ... EXCEPTION WHEN
-- duplicate_object pattern. update_updated_at_column() trigger function is
-- assumed to exist (used by multiple existing tables: agent_leads, etc.).

-- =============================================================================
-- PART A — client_analysis
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.client_analysis (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id                 UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name            TEXT NOT NULL,
  -- slug + password_hash carry Phase 2 forward; unused in Phase 1.
  slug                    TEXT NOT NULL UNIQUE,
  password_hash           TEXT,
  -- External IDs (platform-native, not Vrelly UUIDs). HeyReach accountIds are
  -- ints in their API; Smartlead campaign_ids are stringified ints. Defaults
  -- to empty arrays so a client can be created Smartlead-only or HeyReach-only.
  heyreach_account_ids    INTEGER[] NOT NULL DEFAULT '{}',
  smartlead_campaign_ids  TEXT[]    NOT NULL DEFAULT '{}',
  -- Optional internal links to synced_campaigns rows. Not actively consumed
  -- by generate-client-analysis (which fetches stats directly from upstream
  -- APIs using the external IDs above), but persisted per spec so a future
  -- "show me the rows I selected" UI can use them without a re-pick.
  synced_campaign_ids     UUID[]    NOT NULL DEFAULT '{}',
  -- Generated state.
  analysis_text           TEXT,
  stats_snapshot          JSONB,
  last_generated_at       TIMESTAMPTZ,
  last_range              TEXT CHECK (last_range IS NULL OR last_range IN ('7d', '30d', 'mtd')),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_analysis_user
  ON public.client_analysis(user_id, created_at DESC);

ALTER TABLE public.client_analysis ENABLE ROW LEVEL SECURITY;

DO $pol$ BEGIN
  CREATE POLICY "Owners can select their client_analysis"
    ON public.client_analysis FOR SELECT
    USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $pol$;

DO $pol$ BEGIN
  CREATE POLICY "Owners can insert their client_analysis"
    ON public.client_analysis FOR INSERT
    WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $pol$;

DO $pol$ BEGIN
  CREATE POLICY "Owners can update their client_analysis"
    ON public.client_analysis FOR UPDATE
    USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $pol$;

DO $pol$ BEGIN
  CREATE POLICY "Owners can delete their client_analysis"
    ON public.client_analysis FOR DELETE
    USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $pol$;

DROP TRIGGER IF EXISTS update_client_analysis_updated_at ON public.client_analysis;
CREATE TRIGGER update_client_analysis_updated_at
  BEFORE UPDATE ON public.client_analysis
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================================
-- PART B — client_checklist_items
-- =============================================================================
-- CRITICAL DESIGN NOTE: items are SEPARATE rows (not a JSONB array on the
-- parent) so that regenerating analysis can additively merge new priorities
-- WITHOUT clobbering done/done_at on rows the admin has already checked off.
-- See generate-client-analysis edge function for the dedupe logic.

CREATE TABLE IF NOT EXISTS public.client_checklist_items (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_analysis_id  UUID NOT NULL REFERENCES public.client_analysis(id) ON DELETE CASCADE,
  text                TEXT NOT NULL,
  done                BOOLEAN NOT NULL DEFAULT false,
  done_at             TIMESTAMPTZ,
  source              TEXT NOT NULL DEFAULT 'generated'
                        CHECK (source IN ('generated', 'manual')),
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_checklist_items_parent
  ON public.client_checklist_items(client_analysis_id, sort_order);

ALTER TABLE public.client_checklist_items ENABLE ROW LEVEL SECURITY;

-- All four policies pivot on parent ownership. An EXISTS subquery is the
-- conventional shape for "child row visible iff parent visible to me" in this
-- codebase (matches agent_drafts and a few others).

DO $pol$ BEGIN
  CREATE POLICY "Owners (via parent) can select checklist items"
    ON public.client_checklist_items FOR SELECT
    USING (EXISTS (
      SELECT 1 FROM public.client_analysis ca
      WHERE ca.id = client_analysis_id AND ca.user_id = auth.uid()
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $pol$;

DO $pol$ BEGIN
  CREATE POLICY "Owners (via parent) can insert checklist items"
    ON public.client_checklist_items FOR INSERT
    WITH CHECK (EXISTS (
      SELECT 1 FROM public.client_analysis ca
      WHERE ca.id = client_analysis_id AND ca.user_id = auth.uid()
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $pol$;

DO $pol$ BEGIN
  CREATE POLICY "Owners (via parent) can update checklist items"
    ON public.client_checklist_items FOR UPDATE
    USING (EXISTS (
      SELECT 1 FROM public.client_analysis ca
      WHERE ca.id = client_analysis_id AND ca.user_id = auth.uid()
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $pol$;

DO $pol$ BEGIN
  CREATE POLICY "Owners (via parent) can delete checklist items"
    ON public.client_checklist_items FOR DELETE
    USING (EXISTS (
      SELECT 1 FROM public.client_analysis ca
      WHERE ca.id = client_analysis_id AND ca.user_id = auth.uid()
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $pol$;

DROP TRIGGER IF EXISTS update_client_checklist_items_updated_at ON public.client_checklist_items;
CREATE TRIGGER update_client_checklist_items_updated_at
  BEFORE UPDATE ON public.client_checklist_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
