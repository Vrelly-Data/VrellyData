-- Agent Audiences: allow monthly cadence (additive).
--
-- Adds 'monthly' to the cadence CHECK constraint on public.agent_audiences.
-- Non-destructive and backwards-compatible: existing rows remain valid.
-- No data backfill is required.
--
-- Idempotent: drops the old unnamed/default constraint if present, then
-- recreates it explicitly named with the widened set.
DO $$
BEGIN
  -- Drop the prior CHECK if it exists (created without an explicit name in the initial migration)
  IF EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'agent_audiences_cadence_check'
       AND conrelid = 'public.agent_audiences'::regclass
       AND contype = 'c'
  ) THEN
    ALTER TABLE public.agent_audiences
      DROP CONSTRAINT agent_audiences_cadence_check;
  END IF;

  -- Recreate with 'monthly' allowed
  ALTER TABLE public.agent_audiences
    ADD CONSTRAINT agent_audiences_cadence_check
    CHECK (cadence IN ('manual', 'daily', 'weekly', 'monthly'));
END $$;

