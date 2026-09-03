-- PhoneBurner MVP — additive dialer tables
-- Safe: new tables only; no changes to agent_leads, people, or synced_contacts.

create extension if not exists pgcrypto;

-- =============================================================================
-- TABLE: phoneburner_contacts
-- One row per PhoneBurner contact (scoped to an integration/team).
-- Used for local matching since the PB API has no phone-search.
-- =============================================================================
create table if not exists public.phoneburner_contacts (
  id               uuid primary key default gen_random_uuid(),
  integration_id   uuid not null references public.outbound_integrations(id) on delete cascade,
  team_id          uuid not null references public.teams(id) on delete cascade,
  pb_contact_id    text not null,                               -- provider id (string)
  email            text,
  full_name        text,
  raw_phone        text,
  phone_e164       text,
  person_key       text,                                        -- normalized email when available; else null
  pb_updated_at    timestamptz,                                 -- provider-side updated_at watermark
  raw              jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique(integration_id, pb_contact_id)
);

create index if not exists idx_pb_contacts_team             on public.phoneburner_contacts(team_id);
create index if not exists idx_pb_contacts_integration      on public.phoneburner_contacts(integration_id);
create index if not exists idx_pb_contacts_email_lower      on public.phoneburner_contacts((lower(email)));
create index if not exists idx_pb_contacts_phone_e164       on public.phoneburner_contacts(phone_e164);
create index if not exists idx_pb_contacts_person_key       on public.phoneburner_contacts(person_key);

alter table public.phoneburner_contacts enable row level security;

do $pol$ begin
  create policy "Service role full access"
    on public.phoneburner_contacts
    for all
    using (auth.role() = 'service_role')
    with check (auth.role() = 'service_role');
exception when duplicate_object then null; end $pol$;

do $pol$ begin
  create policy "Users can read their team phoneburner contacts"
    on public.phoneburner_contacts
    for select
    using (team_id = public.get_user_team_id(auth.uid()));
exception when duplicate_object then null; end $pol$;

create trigger update_phoneburner_contacts_updated_at
  before update on public.phoneburner_contacts
  for each row execute function public.update_updated_at_column();

-- =============================================================================
-- TABLE: dialer_events
-- One row per call event fetched from PhoneBurner (poll/webhook).
-- Stores additive call outcomes; inference_events writes are best-effort.
-- =============================================================================
create table if not exists public.dialer_events (
  id                 uuid primary key default gen_random_uuid(),
  integration_id     uuid not null references public.outbound_integrations(id) on delete cascade,
  team_id            uuid not null references public.teams(id) on delete cascade,
  person_key         text,                         -- normalized email when matched (nullable)
  pb_contact_id      text,                         -- for traceability back to contacts table
  phone_e164         text,
  call_id            text not null,
  dialsession_id     text,
  disposition        text,
  connected          boolean,
  voicemail          boolean,
  duration_seconds   integer,
  note               text,
  recording_url      text,
  occurred_at        timestamptz not null,
  source             text not null check (source in ('poll','webhook','callback')) default 'poll',
  raw                jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  unique(integration_id, call_id)
);

create index if not exists idx_dialer_events_team_time     on public.dialer_events(team_id, occurred_at desc);
create index if not exists idx_dialer_events_person_key    on public.dialer_events(person_key);
create index if not exists idx_dialer_events_phone_e164    on public.dialer_events(phone_e164);
create index if not exists idx_dialer_events_integration   on public.dialer_events(integration_id);

alter table public.dialer_events enable row level security;

do $pol$ begin
  create policy "Service role full access"
    on public.dialer_events
    for all
    using (auth.role() = 'service_role')
    with check (auth.role() = 'service_role');
exception when duplicate_object then null; end $pol$;

do $pol$ begin
  create policy "Users can read their team dialer events"
    on public.dialer_events
    for select
    using (team_id = public.get_user_team_id(auth.uid()));
exception when duplicate_object then null; end $pol$;

