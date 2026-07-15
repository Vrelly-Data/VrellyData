-- Unify pipeline_stage + disposition_tag into ONE 7-stage deal taxonomy.
--
-- Final 7 stages (funnel order):
--   replied, in_progress, sent_proposal, call_scheduled, no_show,
--   closed_won, closed_lost
-- Tags == stages: disposition_tag now mirrors pipeline_stage (both hold one of
-- the 7), EXCEPT disposition_tag='opted_out' which is preserved as a COMPLIANCE
-- SUPPRESSION FLAG (blocks drafting/sending/resurfacing) — never a deal stage.
--
-- The agent_leads_pipeline_stage_check constraint was untracked/manual; this
-- rebuilds it to exactly the 7. Data is migrated FIRST so no row violates the
-- new CHECK. Wrapped in a transaction. (Prod/dev were remapped by hand in
-- Studio during the taxonomy iterations; this file is the faithful, runnable
-- record for a fresh environment.)
--
-- Run on DEV first (check the Studio project name!), verify, then prod. After:
--   NOTIFY pgrst, 'reload schema';

BEGIN;

-- 1a. Remap legacy pipeline_stage values → the 7.
UPDATE public.agent_leads SET pipeline_stage = 'replied'      WHERE pipeline_stage IN ('contacted', 'replied');
UPDATE public.agent_leads SET pipeline_stage = 'in_progress'  WHERE pipeline_stage = 'engaged';
UPDATE public.agent_leads SET pipeline_stage = 'call_scheduled' WHERE pipeline_stage = 'meeting_booked';
UPDATE public.agent_leads SET pipeline_stage = 'closed_won'   WHERE pipeline_stage = 'closed';
UPDATE public.agent_leads SET pipeline_stage = 'closed_lost'
  WHERE pipeline_stage IN ('dead', 'bad_lead', 'ooo', 'not_interested', 'not_relevant', 'opted_out');

-- 1b. Remap legacy disposition_tag values → the 7 (tags == stages), but KEEP
--     'opted_out' as the compliance suppression flag.
UPDATE public.agent_leads SET disposition_tag = 'call_scheduled' WHERE disposition_tag = 'meeting_booked';
UPDATE public.agent_leads SET disposition_tag = 'closed_won'   WHERE disposition_tag = 'closed';
UPDATE public.agent_leads SET disposition_tag = 'closed_lost'
  WHERE disposition_tag IN ('dead', 'bad_lead', 'ooo', 'not_interested', 'not_relevant');
-- (disposition_tag = 'opted_out' left as-is on purpose.)

-- 2. Rebuild the CHECK to exactly the 7, and fix the column default
--    ('contacted' is no longer valid).
ALTER TABLE public.agent_leads DROP CONSTRAINT IF EXISTS agent_leads_pipeline_stage_check;
ALTER TABLE public.agent_leads ADD CONSTRAINT agent_leads_pipeline_stage_check
  CHECK (pipeline_stage IN (
    'replied','in_progress','sent_proposal','call_scheduled',
    'no_show','closed_won','closed_lost'
  ));
ALTER TABLE public.agent_leads ALTER COLUMN pipeline_stage SET DEFAULT 'replied';

COMMIT;
