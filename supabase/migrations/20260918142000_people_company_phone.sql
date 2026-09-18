-- Firmographics: add company_phone (and person phone) to people.
-- Mirror company_phone onto inference_events to keep denormalized snapshots consistent.
-- Safe to re-run: IF NOT EXISTS guards.
-- After running in each environment: NOTIFY pgrst, 'reload schema';

ALTER TABLE public.people
  ADD COLUMN IF NOT EXISTS company_phone text,
  ADD COLUMN IF NOT EXISTS phone text;

ALTER TABLE public.inference_events
  ADD COLUMN IF NOT EXISTS company_phone text;

