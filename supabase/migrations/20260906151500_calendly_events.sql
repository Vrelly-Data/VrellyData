-- Calendly MVP — additive booking events table
-- Safe: new tables only; no changes to agent_leads, people, or synced_contacts.
-- Events are additive and team-scoped; no destructive writes anywhere.

create extension if not exists pgcrypto;

-- =============================================================================
-- TABLE: calendly_events
-- One row per Calendly invitee on a scheduled event (poll/webhook/callback).
-- Additive only. person_key is matched-by-email when a people row exists.
-- =============================================================================
create table if not exists public.calendly_events (
  id                    uuid primary key default gen_random_uuid(),
  integration_id        uuid not null references public.outbound_integrations(id) on delete cascade,
  team_id               uuid not null references public.teams(id) on delete cascade,
  person_key            text,                         -- normalized email when matched (nullable)
  email                 text,                         -- invitee email (lowercased when present)
  scheduled_event_uuid  text not null,                -- Calendly scheduled_events UUID
  invitee_uuid          text not null,                -- Calendly invitee UUID (unique per guest)
  event_name            text,
  status                text not null check (status in ('scheduled','canceled','completed')) default 'scheduled',
  start_time            timestamptz,
  end_time              timestamptz,
  source                text not null check (source in ('poll','webhook','callback')) default 'poll',
  raw                   jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique(integration_id, invitee_uuid)
);

create index if not exists idx_calendly_events_team_time   on public.calendly_events(team_id, coalesce(start_time, created_at) desc);
create index if not exists idx_calendly_events_person_key  on public.calendly_events(person_key);
create index if not exists idx_calendly_events_email       on public.calendly_events(email);
create index if not exists idx_calendly_events_integration on public.calendly_events(integration_id);

alter table public.calendly_events enable row level security;

do $pol$ begin
  create policy "Service role full access (calendly_events)"
    on public.calendly_events
    for all
    using (auth.role() = 'service_role')
    with check (auth.role() = 'service_role');
exception when duplicate_object then null; end $pol$;

do $pol$ begin
  create policy "Users can read their team calendly events"
    on public.calendly_events
    for select
    using (team_id = public.get_user_team_id(auth.uid()));
exception when duplicate_object then null; end $pol$;

drop trigger if exists update_calendly_events_updated_at on public.calendly_events;
create trigger update_calendly_events_updated_at
  before update on public.calendly_events
  for each row execute function public.update_updated_at_column();

