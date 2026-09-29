-- HeyReach poller persistent state for time-budgeted walks and baselines
alter table if exists public.outbound_integrations
  add column if not exists heyreach_poll_state jsonb not null default '{}'::jsonb;

