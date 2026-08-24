-- Fix: total_pushed drifted upward on every failed push.
--
-- 20260816120000 added an AFTER INSERT trigger that increments
-- agent_audiences.total_pushed, and no counterpart for DELETE. That was fine
-- while nothing deleted ledger rows — but add-contacts-to-sequence (Stage 3)
-- uses claim-before-push: it INSERTS the ledger row before calling the
-- platform, and DELETES it if that call fails, so a retry stays possible.
--
-- The consequence: every failed push permanently inflated total_pushed while
-- leaving no ledger row behind. max_total is enforced against that counter, so
-- an audience capped at 100 would silently stop short — and the discrepancy
-- would be invisible, because the ledger (the thing you'd check) looks correct.
-- Reproduced on dev before the fix: claim -> 1, delete -> still 1, ledger 0.
--
-- The invariant this restores: total_pushed == the number of ledger rows.
--
-- NAMING — read this before editing. The version applied by hand to dev and
-- prod on 2026-08-16 named these `..._unbump_total`, and this file has been
-- reconciled to match what is actually deployed. It previously used
-- `..._drop_total`, which would have been a genuine hazard: the DROP TRIGGER
-- guard only covers the name it creates, so re-running the old file against a
-- database that already had `unbump` would have installed a SECOND AFTER DELETE
-- trigger and decremented total_pushed twice per failed push. The stray
-- `drop_total` names are dropped defensively below so this file is safe to run
-- against a database in either state.
--
-- GREATEST floors at 0. A cascade delete of an audience fires this per child
-- row and the parent UPDATE simply matches nothing, which is harmless.

CREATE OR REPLACE FUNCTION public.agent_audience_pushes_unbump_total()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.agent_audiences
     SET total_pushed = GREATEST(total_pushed - 1, 0)
   WHERE id = OLD.audience_id;
  RETURN OLD;
END;
$$;

-- Defensive: remove the earlier name if this file was ever applied in its
-- original form, so the table can never carry two AFTER DELETE triggers.
DROP TRIGGER IF EXISTS trg_agent_audience_pushes_drop_total ON public.agent_audience_pushes;
DROP FUNCTION IF EXISTS public.agent_audience_pushes_drop_total();

DROP TRIGGER IF EXISTS trg_agent_audience_pushes_unbump_total ON public.agent_audience_pushes;
CREATE TRIGGER trg_agent_audience_pushes_unbump_total
  AFTER DELETE ON public.agent_audience_pushes
  FOR EACH ROW EXECUTE FUNCTION public.agent_audience_pushes_unbump_total();

-- Repair any drift already present. Dev and prod both held zero ledger rows
-- when this was applied, so it was a no-op there; it exists so the migration is
-- correct if applied later against real data.
UPDATE public.agent_audiences a
   SET total_pushed = c.n
  FROM (
    SELECT id AS aid,
           (SELECT count(*) FROM public.agent_audience_pushes p WHERE p.audience_id = id) AS n
      FROM public.agent_audiences
  ) c
 WHERE a.id = c.aid
   AND a.total_pushed IS DISTINCT FROM c.n;
