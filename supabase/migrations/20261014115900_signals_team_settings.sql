-- Signals: per-team settings (runs before 20261014120000_signals_types_markets).
--
-- Kept apart from the main restructure on purpose: ALTER TABLE teams takes an
-- ACCESS EXCLUSIVE lock, and teams is read by almost every page. Here the lock
-- lives for a metadata-only change (constant defaults, a tiny table to check);
-- the main migration then never touches teams' definition. The enrichment
-- spend ledger lives here too: its foreign key to teams would otherwise lock
-- teams against writes for the whole main transaction.

create or replace function public.signals_markets_valid(p text[])
returns boolean
language sql immutable parallel safe
as $$
  select p is not null and cardinality(p) >= 1
     and p <@ array['private_equity', 'medical_device', 'saas', 'recruiting', 'other']::text[]
$$;

-- ========================================================= team settings ===

alter table public.teams
  add column if not exists signals_default_market text,
  add column if not exists signals_country text default 'US',
  add column if not exists signals_apollo_enrich boolean not null default false;

alter table public.teams drop constraint if exists teams_signals_default_market_check;
alter table public.teams add constraint teams_signals_default_market_check
  check (signals_default_market is null or signals_markets_valid(array[signals_default_market]));
alter table public.teams drop constraint if exists teams_signals_country_check;
alter table public.teams add constraint teams_signals_country_check
  check (signals_country is null or signals_country ~ '^[A-Z]{2}$');

comment on column public.teams.signals_default_market is
  'Signals: market for this team''s own signals (website visits, High Intent) when the company''s industry does not decide it. Admin-edited.';
comment on column public.teams.signals_country is 'Signals: default Country filter (ISO alpha-2). Admin-edited.';
comment on column public.teams.signals_apollo_enrich is
  'Signals: High Intent enrichment may use Apollo (paid, counted against the monthly credit cap). Default off.';

-- Apollo credits spent by High Intent enrichment (one row per bulk_match call).
create table if not exists public.signal_enrichment_spend (
  id              bigint generated always as identity primary key,
  team_id         uuid not null references public.teams(id) on delete cascade,
  user_id         uuid not null,
  agent_config_id uuid,
  credits         integer not null default 0 check (credits >= 0),
  records         integer not null default 0,
  key_source      text not null check (key_source in ('shared', 'client')),
  created_at      timestamptz not null default now()
);
create index if not exists idx_signal_enrichment_spend_user_time on public.signal_enrichment_spend (user_id, created_at desc);
alter table public.signal_enrichment_spend enable row level security;
revoke all on public.signal_enrichment_spend from anon, authenticated;
grant all on public.signal_enrichment_spend to service_role;
drop policy if exists "signal_enrichment_spend: admins read" on public.signal_enrichment_spend;
create policy "signal_enrichment_spend: admins read" on public.signal_enrichment_spend
  for select to authenticated using ((select public.signals_is_admin()));
