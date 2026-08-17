-- Decouple WHERE from WHO.
--
-- An audience is a saved Apollo search — it describes WHO to target. It should
-- not also assert a single permanent destination. The same audience should be
-- able to feed Reply.io this month and Smartlead next, or split a batch across
-- both, without being duplicated.
--
-- WHAT MOVES:
--   agent_audiences        platform + synced_campaign_id  -> DROPPED
--                          default_platform + default_synced_campaign_id -> ADDED (nullable)
--   agent_audience_runs    platform + synced_campaign_id  -> ADDED (a run targets ONE destination)
--   agent_audience_pushes  platform                       -> ADDED (synced_campaign_id already existed)
--
-- A RUN TARGETS EXACTLY ONE DESTINATION. Splitting a batch across two platforms
-- is two runs. That keeps per-run counters honest (credits_spent, pushed,
-- failed all mean one thing) and avoids a mixed-destination run whose partial
-- failure is ambiguous.
--
-- WHY DEFAULTS STILL EXIST ON THE AUDIENCE. Manual pushes choose a destination
-- per push. Scheduled runs cannot — nobody is there to choose — so an automated
-- audience must have one locked in. Hence the guard below now requires a
-- DEFAULT destination to arm, while manual pushes ignore the default entirely.
-- An audience with no default is perfectly valid; it simply cannot be armed.
--
-- DEDUP IS UNAFFECTED, deliberately. The unique indexes are
-- (user_id, apollo_person_id) and (user_id, email_key) — neither mentions
-- platform or campaign, so a person pushed to Reply.io can never later be
-- pushed to Smartlead by any audience. That is the intended product rule: once
-- a prospect is used for a client, they are used, regardless of channel.
-- Nothing here changes it, and it is stated so a future reader does not assume
-- the omission was an oversight.
--
-- SAFE TO RUN AS A PURE SCHEMA MOVE: both agent_audiences and
-- agent_audience_runs/pushes hold ZERO rows on dev and prod at the time of
-- writing, so the dropped columns carry no data and the new NOT NULLs need no
-- backfill. The guard below re-checks that assumption and refuses rather than
-- silently discarding anything.

-- ---------------------------------------------------------------------------
-- 0. Refuse to run destructively if real data appeared since this was written.
-- ---------------------------------------------------------------------------
DO $guard$
DECLARE
  n_aud int;
BEGIN
  SELECT count(*) INTO n_aud FROM public.agent_audiences;
  IF n_aud > 0 THEN
    RAISE EXCEPTION
      'agent_audiences holds % row(s). This migration DROPS platform/synced_campaign_id and would discard their destinations. Backfill default_platform/default_synced_campaign_id first, then re-run with this guard removed.',
      n_aud;
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 1. Runs carry the destination they targeted.
-- ---------------------------------------------------------------------------
ALTER TABLE public.agent_audience_runs
  ADD COLUMN IF NOT EXISTS platform TEXT,
  -- Nullable, and ON DELETE SET NULL: a campaign deleted later must not block
  -- cleanup or destroy the run history that references it.
  ADD COLUMN IF NOT EXISTS synced_campaign_id UUID
    REFERENCES public.synced_campaigns(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_audience_runs_platform_check'
  ) THEN
    ALTER TABLE public.agent_audience_runs
      ADD CONSTRAINT agent_audience_runs_platform_check
      CHECK (platform IS NULL OR platform IN ('smartlead', 'reply.io'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Pushes record which platform received them (campaign was already there).
-- ---------------------------------------------------------------------------
ALTER TABLE public.agent_audience_pushes
  ADD COLUMN IF NOT EXISTS platform TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_audience_pushes_platform_check'
  ) THEN
    ALTER TABLE public.agent_audience_pushes
      ADD CONSTRAINT agent_audience_pushes_platform_check
      CHECK (platform IS NULL OR platform IN ('smartlead', 'reply.io'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. The audience keeps only a DEFAULT destination, for automation.
-- ---------------------------------------------------------------------------
ALTER TABLE public.agent_audiences
  ADD COLUMN IF NOT EXISTS default_platform TEXT,
  ADD COLUMN IF NOT EXISTS default_synced_campaign_id UUID
    REFERENCES public.synced_campaigns(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_audiences_default_platform_check'
  ) THEN
    ALTER TABLE public.agent_audiences
      ADD CONSTRAINT agent_audiences_default_platform_check
      CHECK (default_platform IS NULL OR default_platform IN ('smartlead', 'reply.io'));
  END IF;
END $$;

-- The old columns. Dropping platform also drops its NOT NULL and CHECK.
ALTER TABLE public.agent_audiences
  DROP COLUMN IF EXISTS platform,
  DROP COLUMN IF EXISTS synced_campaign_id;

-- ---------------------------------------------------------------------------
-- 4. Activation guard, rewritten against the DEFAULT destination.
-- ---------------------------------------------------------------------------
-- Unchanged in spirit: arming requires a run that actually succeeded, and a
-- destination the schedule can use. Only the column names move.
--
-- The ordering lesson from 20260816120000 still applies: the successful-run
-- test comes FIRST so it stays reachable (and therefore testable) even when no
-- default destination is set, and the silent auto-deactivate is confined to an
-- already-active row whose campaign link vanished — it must not raise, or
-- ON DELETE SET NULL could never clean up a campaign.
CREATE OR REPLACE FUNCTION public.agent_audiences_guard_activation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_active AND (TG_OP = 'INSERT' OR NOT COALESCE(OLD.is_active, false)) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.agent_audience_runs r
      WHERE r.audience_id = NEW.id AND r.status = 'success'
    ) THEN
      RAISE EXCEPTION
        'agent_audiences: cannot activate "%" until a run has completed with status=success (run it manually first)',
        NEW.name
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.default_synced_campaign_id IS NULL OR NEW.default_platform IS NULL THEN
      RAISE EXCEPTION
        'agent_audiences: cannot activate "%" without a default destination — a scheduled run has nobody to ask which campaign to use',
        NEW.name
        USING ERRCODE = 'check_violation';
    END IF;

  ELSIF NEW.is_active AND NEW.default_synced_campaign_id IS NULL THEN
    NEW.is_active := false;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. The cron's due-scan index referenced nothing that moved, but recreate it
--    so its definition is unambiguous alongside the new columns.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS public.idx_agent_audiences_due;
CREATE INDEX IF NOT EXISTS idx_agent_audiences_due
  ON public.agent_audiences(cadence, last_run_at)
  WHERE is_active AND cadence <> 'manual';

CREATE INDEX IF NOT EXISTS idx_agent_audience_runs_campaign
  ON public.agent_audience_runs(synced_campaign_id)
  WHERE synced_campaign_id IS NOT NULL;
