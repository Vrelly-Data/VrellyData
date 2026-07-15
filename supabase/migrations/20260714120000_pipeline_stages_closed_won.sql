-- Pipeline stage taxonomy update.
--
-- Rename closed → closed_won and add closed_lost / no_show / sent_proposal.
-- The agent_leads_pipeline_stage_check constraint was widened manually (its
-- 10 values are NOT in any migration); confirmed identical on dev + prod:
--   in_progress, bad_lead, ooo, not_interested, meeting_booked, closed, dead,
--   contacted, replied, engaged
-- New value set (13): the above minus 'closed', plus closed_won/closed_lost/
-- no_show/sent_proposal.
--
-- 'closed' lives on BOTH pipeline_stage AND disposition_tag (an operator tag),
-- so both are migrated. Data is migrated FIRST so no existing row violates the
-- new CHECK. Wrapped in a transaction — a bad row rolls the whole thing back.
--
-- Run on DEV first (check the Studio project name!), verify, then prod. After:
--   NOTIFY pgrst, 'reload schema';

BEGIN;

-- 1. Data first: closed → closed_won on both columns (prod: 6 rows each).
UPDATE public.agent_leads SET pipeline_stage = 'closed_won' WHERE pipeline_stage = 'closed';
UPDATE public.agent_leads SET disposition_tag = 'closed_won' WHERE disposition_tag = 'closed';

-- 2. Rebuild the CHECK: drop the (untracked) constraint by its real name, add
--    the 13-value superset. disposition_tag has no constraint — nothing to add.
ALTER TABLE public.agent_leads DROP CONSTRAINT IF EXISTS agent_leads_pipeline_stage_check;
ALTER TABLE public.agent_leads ADD CONSTRAINT agent_leads_pipeline_stage_check
  CHECK (pipeline_stage IN (
    'contacted','replied','engaged','in_progress','sent_proposal',
    'meeting_booked','no_show','closed_won','closed_lost',
    'bad_lead','ooo','not_interested','dead'
  ));

COMMIT;
