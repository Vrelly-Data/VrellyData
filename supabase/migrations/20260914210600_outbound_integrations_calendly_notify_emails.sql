-- Add Calendly notify emails configuration on outbound_integrations
-- - Column: calendly_notify_emails text[] not null default '{}'
-- Safe to run in prod and dev. Idempotent alters.
-- After applying, notify PostgREST to reload schema.

alter table if exists public.outbound_integrations
  add column if not exists calendly_notify_emails text[] not null default '{}';

-- Optional: comment for clarity in Studio
comment on column public.outbound_integrations.calendly_notify_emails is
  'Comma-separated notification recipient emails for Calendly bookings on this integration (stored as text[]). Empty = no notifications.';

-- RLS is unchanged; existing policies apply.

-- Refresh PostgREST schema cache
notify pgrst, 'reload schema';

