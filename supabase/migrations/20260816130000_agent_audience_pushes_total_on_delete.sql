-- Fix: total_pushed drifted upward on every failed push.
--
-- 20260816120000 added an AFTER INSERT trigger that increments
-- agent_audiences.total_pushed, and no counterpart for DELETE. That was fine
-- while nothing deleted ledger rows — but add-contacts-to-sequence (Stage 3)
-- uses claim-before-push: it INSERTS the ledger row before calling the
-- platform, and DELETES it if that call fails, so a retry is legitimately
-- possible.
--
-- The consequence: every failed push permanently inflated total_pushed while
-- leaving no ledger row behind. max_total is enforced against that counter, so
-- an audience capped at 100 would silently stop short — and the discrepancy
-- would be invisible, because the ledger (the thing you'd check) looks correct.
--
-- The invariant this restores: total_pushed == the number of ledger rows for
-- that audience.
--
-- GREATEST(0, ...) guards the floor. A cascade delete of an audience fires this
-- for each child row, and the parent UPDATE simply matches nothing because the
-- parent is already gone — harmless, and the reason this is not an error path.

CREATE OR REPLACE FUNCTION public.agent_audience_pushes_drop_total()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.agent_audiences
     SET total_pushed = GREATEST(0, total_pushed - 1)
   WHERE id = OLD.audience_id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_agent_audience_pushes_drop_total ON public.agent_audience_pushes;
CREATE TRIGGER trg_agent_audience_pushes_drop_total
  AFTER DELETE ON public.agent_audience_pushes
  FOR EACH ROW EXECUTE FUNCTION public.agent_audience_pushes_drop_total();

-- Repair any drift already present. Both dev and prod currently hold zero
-- ledger rows, so this is a no-op today and exists so the migration is correct
-- if applied later against real data.
UPDATE public.agent_audiences a
   SET total_pushed = COALESCE(c.n, 0)
  FROM (
    SELECT id AS aid,
           (SELECT count(*) FROM public.agent_audience_pushes p WHERE p.audience_id = id) AS n
      FROM public.agent_audiences
  ) c
 WHERE a.id = c.aid
   AND a.total_pushed IS DISTINCT FROM COALESCE(c.n, 0);
