-- organizations.billing_date — the date the client is billed on.
--
-- Purely additive, same pattern as 20260807120000: nullable DATE with no
-- default, so every existing row stays valid and this cannot fail on current
-- data or rewrite the table.
--
-- DATE, not TIMESTAMPTZ: this is a calendar date a human sets ("billed on the
-- 3rd"), not an instant. A timestamptz would drag timezone conversion into a
-- field where it can only cause off-by-one-day surprises.
--
-- Safe to re-run. Run in dev, verify, then prod. NOTIFY refreshes PostgREST's
-- schema cache so the column is selectable.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS billing_date DATE;

COMMENT ON COLUMN public.organizations.billing_date IS
  'Calendar date the client is billed on. Nullable — unset means unknown, not '
  'today. Display/record only; nothing schedules off this column.';

NOTIFY pgrst, 'reload schema';
