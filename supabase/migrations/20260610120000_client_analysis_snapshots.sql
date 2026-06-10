-- Data Analysis Phase 2 — analyses become a TIMESTAMPED HISTORY.
--
-- Each Generate now INSERTs a new row in client_analysis_snapshots instead
-- of overwriting client_analysis. The selected snapshot drives the UI's
-- stats grid + AI summary; priorities (client_checklist_items) remain one
-- running list per client and are NOT snapshotted (see existing
-- 20260609120000_data_analysis_phase1.sql for that table's design note).
--
-- IMPORTANT — do NOT migrate existing client_analysis rows into snapshots.
-- client_analysis is left in place (it still holds per-client metadata:
-- display_name, slug, picker selections); the legacy analysis_text /
-- stats_snapshot / last_generated_at / last_range columns become inert for
-- the snapshot-based UI. They may be dropped in a later cleanup migration.
--
-- RLS mirrors client_analysis: owner can CRUD their own rows
-- (user_id = auth.uid()). Idempotent CREATE POLICY via the established
-- DO $pol$ ... EXCEPTION WHEN duplicate_object pattern.
--
-- range CHECK includes 'last_week' (the new weekly-cadence default range
-- added to resolveRange() in the same PR). The legacy client_analysis
-- table's last_range CHECK is NOT touched per the spec; the edge function
-- avoids writing 'last_week' to that legacy column by no longer updating
-- client_analysis on full Generate.

-- =============================================================================
-- client_analysis_snapshots
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.client_analysis_snapshots (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id       UUID NOT NULL
                    REFERENCES public.client_analysis(id) ON DELETE CASCADE,
  -- Mirrors client_analysis.user_id so RLS can be enforced directly on this
  -- table without a join, and so a future "deleted client rescue" tool can
  -- find orphan snapshots by user. Required (NOT NULL) because every Generate
  -- runs as an authenticated admin and the edge function knows user.id.
  user_id         UUID NOT NULL
                    REFERENCES auth.users(id) ON DELETE CASCADE,
  analysis_text   TEXT,
  stats_snapshot  JSONB,
  range           TEXT NOT NULL
                    CHECK (range IN ('7d', '30d', 'mtd', 'last_week')),
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_analysis_snapshots_client_created
  ON public.client_analysis_snapshots(client_id, created_at DESC);

ALTER TABLE public.client_analysis_snapshots ENABLE ROW LEVEL SECURITY;

DO $pol$ BEGIN
  CREATE POLICY "Owners can select their snapshots"
    ON public.client_analysis_snapshots FOR SELECT
    USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $pol$;

DO $pol$ BEGIN
  CREATE POLICY "Owners can insert their snapshots"
    ON public.client_analysis_snapshots FOR INSERT
    WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $pol$;

DO $pol$ BEGIN
  CREATE POLICY "Owners can update their snapshots"
    ON public.client_analysis_snapshots FOR UPDATE
    USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $pol$;

DO $pol$ BEGIN
  CREATE POLICY "Owners can delete their snapshots"
    ON public.client_analysis_snapshots FOR DELETE
    USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $pol$;
