-- Add notified_at column to calendly_events for idempotent booking notifications
-- Safe, additive. Idempotent alters.
-- After applying, notify PostgREST to reload schema.

alter table if exists public.calendly_events
  add column if not exists notified_at timestamptz null;

comment on column public.calendly_events.notified_at is
  'Timestamp when a creation notification email was sent for this invitee/event. Used for idempotency across webhook and poller.';

-- Index can help when reconciling missed notifications; optional and cheap.
create index if not exists idx_calendly_events_notified_at on public.calendly_events(notified_at);

-- Refresh PostgREST schema cache
notify pgrst, 'reload schema';

