-- Stage 1 of 5 — Capture Scope. SCHEMA ONLY: changes no runtime behaviour.
-- Nothing reads capture_enabled yet; enforcement lands in Stages 4-5.
--
-- WHY A NEW COLUMN RATHER THAN REUSING is_linked
--   is_linked is Data Analysis / reporting scope. It has never gated capture:
--   reply-webhook, poll-reply-inbox, sync-reply-contacts, smartlead-webhook,
--   heyreach-webhook and poll-heyreach-inbox contain zero references to it.
--   Conflating the two is what made "Manage Campaigns" look like a capture
--   switch when it never was. These stay separate, permanently.
--
-- REPLY.IO DOES NOT PARTICIPATE
--   Reply.io's capture path is deliberately unmanaged and untouched by this
--   feature. This migration writes ZERO reply_io rows — they keep the column
--   default. Because no Reply.io code reads the column, that is functionally
--   identical to setting them true, with no writes at all.
--   CONSEQUENCE: any future query over capture_enabled MUST be scoped by
--   source. A bare "WHERE capture_enabled" excludes Reply.io.
--
-- DEFAULT false, EXISTING ROWS true
--   New campaigns must not start capturing unasked — the SourceCo failure this
--   feature exists to prevent (45 out-of-scope campaigns, including a separate
--   business's, swept in automatically). But shipping false for rows that
--   exist today would silently stop capture for every current Smartlead and
--   HeyReach client, so those are backfilled to true. Status quo preserved;
--   curation happens in the Stage 3 UI.

-- The column add and BOTH data steps are guarded to first application only.
-- Re-running this file must be a true no-op: without the guard the backfill
-- would flip every Smartlead/HeyReach row back to true and the seed would
-- re-apply the 45, silently wiping whatever the client had curated in the
-- Capture Scope UI. Idempotent-in-final-state is not sufficient for a
-- migration that stays in the repo and may be replayed.
DO $migration$
DECLARE
  col_existed boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'synced_campaigns'
       AND column_name  = 'capture_enabled'
  ) INTO col_existed;

  IF col_existed THEN
    RAISE NOTICE 'capture_enabled already present - skipping add and backfill (no-op)';
    RETURN;
  END IF;

  ALTER TABLE public.synced_campaigns
    ADD COLUMN capture_enabled boolean NOT NULL DEFAULT false;

  -- Existing Smartlead + HeyReach campaigns keep capturing. reply_io untouched.
  UPDATE public.synced_campaigns
     SET capture_enabled = true
   WHERE source IN ('smartlead', 'heyreach');

  -- SourceCo: the 45 campaigns deregistered 2026-08-21 as out of scope (4
  -- belonging to a separate business trading as captarget, 41 non-GP-branded).
  -- Seeded false so the Stage 3 UI opens already reflecting that decision.
  --
  -- Scoped to SourceCo's TEAM, not just source+id. Smartlead campaign ids are
  -- unique within a Smartlead account but NOT across accounts, so a bare
  -- "source='smartlead' AND external_campaign_id IN (...)" would disable a
  -- different client's campaign that reused one of these numeric ids. Harmless
  -- today (SourceCo is the only Smartlead integration in prod) and a live bug
  -- the moment a second one is added.
  UPDATE public.synced_campaigns
     SET capture_enabled = false
   WHERE source  = 'smartlead'
     AND team_id = '72e9eafb-8065-4079-8dc3-1349432c9305'
     AND external_campaign_id IN (
      '1535900',
      '1665577',
      '1748114',
      '1748148',
      '1751989',
      '1838652',
      '3092016',
      '3110604',
      '3190656',
      '3243886',
      '3243888',
      '3260773',
      '3291189',
      '3291459',
      '3291462',
      '3291466',
      '3304970',
      '3347159',
      '3347187',
      '3352657',
      '3367270',
      '3417837',
      '3417887',
      '3423786',
      '3454196',
      '3477068',
      '3498082',
      '3499716',
      '3505982',
      '3511464',
      '3639643',
      '3702770',
      '3705997',
      '3708390',
      '3712510',
      '3736496',
      '3761529',
      '3763842',
      '3769352',
      '3769378',
      '3777903',
      '3778029',
      '3793211',
      '3797689',
      '3813648'
     );
END
$migration$;

-- Outside the guard so it is always current, even on replay.
COMMENT ON COLUMN public.synced_campaigns.capture_enabled IS
  'Whether Vrelly ingests replies for this campaign (when false, no lead row is created at all). NOT is_linked, which is Data Analysis reporting scope and unrelated. Reply.io ignores this column entirely - always scope queries on it by source.';

CREATE INDEX IF NOT EXISTS idx_synced_campaigns_capture_enabled
  ON public.synced_campaigns (integration_id, capture_enabled)
  WHERE capture_enabled;
