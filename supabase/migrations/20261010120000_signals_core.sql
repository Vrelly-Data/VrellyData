-- Signals foundation (1/3): tables, indexes, RLS.
--
-- A signal is a timestamped event suggesting a company/person is in-market.
-- Every source (one edge function + one signal_sources row) writes through the
-- same upsert (signals_upsert, migration 2/3), keyed on signals.dedupe_key.
--
-- Visibility is enforced in the database, not the UI:
--   'admin'       platform admins only (e.g. SourceCo seller intent — client data)
--   'all_clients' every signed-in user (public data: openFDA, job boards, GitHub)
--   'team'        members of signals.team_id only (website visitors of that team's site)
-- A source whose default_visibility is 'admin' can never produce a wider row
-- (trigger signals_guard_visibility), whoever writes it.
--
-- vertical / signal_type are free text with a format CHECK (not a fixed list),
-- so a new vertical is a config row, not a migration. The UI derives its
-- sub-tabs from the data.
--
-- Phase 2 (signals as an audience source + contact enrichment) plugs in via:
--   signals.person_* / company_* columns (what an audience needs),
--   signal_team_status.status = 'pushed' (per-team "already used"),
--   signals_feed(...) filters (the same selection an audience would save).

-- ---------------------------------------------------------------- helpers ---

create or replace function public.signals_is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select p.is_platform_admin from public.profiles p where p.id = auth.uid()), false)
$$;

create or replace function public.signals_my_team_ids()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select m.team_id from public.team_memberships m where m.user_id = auth.uid()
$$;

-- The team a user acts for (review/dismiss status, site registration).
create or replace function public.signals_my_team_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select m.team_id from public.team_memberships m where m.user_id = auth.uid()
  order by m.created_at limit 1
$$;

revoke all on function public.signals_is_admin() from public, anon;
revoke all on function public.signals_my_team_ids() from public, anon;
revoke all on function public.signals_my_team_id() from public, anon;
grant execute on function public.signals_is_admin() to authenticated, service_role;
grant execute on function public.signals_my_team_ids() to authenticated, service_role;
grant execute on function public.signals_my_team_id() to authenticated, service_role;

-- ----------------------------------------------------------- signal_sources ---

create table if not exists public.signal_sources (
  id                 uuid primary key default gen_random_uuid(),
  key                text not null unique check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  vertical           text not null check (vertical ~ '^[a-z][a-z0-9_]{1,62}$'),
  name               text not null,
  kind               text not null check (kind in ('api', 'internal', 'pixel')),
  cadence            text not null check (cadence in ('hourly', 'daily', 'realtime')),
  default_visibility text not null check (default_visibility in ('admin', 'all_clients', 'team')),
  -- Edge function that ingests this source. Convention: 'signal-' || key with '-'.
  function_name      text not null,
  -- Filters / watchlists. NEVER secrets (those are Supabase secrets / Vault).
  config             jsonb not null default '{}'::jsonb,
  is_active          boolean not null default true,
  last_run_at        timestamptz,
  last_run_status    text check (last_run_status in ('running', 'success', 'partial', 'failed', 'skipped')),
  last_error         text,
  items_last_run     integer,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.signal_sources is
  'One row per signal source. A new source = one ingest edge function + one row here. config holds filters/watchlists, never secrets.';

-- ------------------------------------------------------------------ signals ---

create table if not exists public.signals (
  id               uuid primary key default gen_random_uuid(),
  source_key       text not null references public.signal_sources(key) on update cascade,
  vertical         text not null check (vertical ~ '^[a-z][a-z0-9_]{1,62}$'),
  signal_type      text not null check (signal_type ~ '^[a-z0-9][a-z0-9_]{1,62}$'),
  occurred_at      timestamptz not null,
  company_name     text,
  company_domain   text,
  person_name      text,
  person_title     text,
  person_email     text,
  person_linkedin  text,
  city             text,
  state            text,
  country          text,
  title            text not null,
  url              text,
  score            integer not null default 0 check (score between 0 and 100),
  payload          jsonb not null default '{}'::jsonb,
  dedupe_key       text not null unique,
  visibility       text not null check (visibility in ('admin', 'all_clients', 'team')),
  team_id          uuid references public.teams(id) on delete cascade,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint signals_team_visibility_has_team check (visibility <> 'team' or team_id is not null)
);

create index if not exists idx_signals_vertical_time   on public.signals (vertical, occurred_at desc);
create index if not exists idx_signals_source_time     on public.signals (source_key, occurred_at desc);
create index if not exists idx_signals_company_domain  on public.signals (company_domain);
create index if not exists idx_signals_visibility_time on public.signals (visibility, occurred_at desc);
create index if not exists idx_signals_team_time       on public.signals (team_id, occurred_at desc);

comment on table public.signals is
  'Timestamped in-market events. Written only by service_role through signals_upsert. Read under RLS: admins all; users all_clients + their team''s rows; never admin rows.';

-- A source with default_visibility 'admin' can never write a wider row, and the
-- row's vertical always comes from its source.
create or replace function public.signals_guard_visibility()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  src public.signal_sources%rowtype;
begin
  select * into src from public.signal_sources where key = new.source_key;
  if not found then
    raise exception 'unknown signal source %', new.source_key;
  end if;
  new.vertical := src.vertical;
  if src.default_visibility = 'admin' and new.visibility <> 'admin' then
    raise exception 'source % is admin-only; refusing visibility %', new.source_key, new.visibility;
  end if;
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists signals_guard_visibility on public.signals;
create trigger signals_guard_visibility
  before insert or update on public.signals
  for each row execute function public.signals_guard_visibility();

-- ------------------------------------------------------- signal_team_status ---

create table if not exists public.signal_team_status (
  signal_id  uuid not null references public.signals(id) on delete cascade,
  team_id    uuid not null references public.teams(id) on delete cascade,
  status     text not null check (status in ('new', 'reviewed', 'dismissed', 'pushed')),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (signal_id, team_id)
);
create index if not exists idx_signal_team_status_team on public.signal_team_status (team_id, status);

-- --------------------------------------------------------------- signal_runs ---

create table if not exists public.signal_runs (
  id           uuid primary key default gen_random_uuid(),
  source_key   text not null references public.signal_sources(key) on update cascade on delete cascade,
  triggered_by text not null default 'dispatcher',
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'running'
               check (status in ('running', 'success', 'partial', 'failed', 'skipped', 'abandoned')),
  fetched      integer not null default 0,
  inserted     integer not null default 0,
  updated      integer not null default 0,
  deduped      integer not null default 0,
  error        text,
  detail       jsonb not null default '{}'::jsonb
);
create index if not exists idx_signal_runs_source_time on public.signal_runs (source_key, started_at desc);

-- ------------------------------------------------------- website visitors ---

create table if not exists public.signal_sites (
  site_key   text primary key default ('vs_' || replace(gen_random_uuid()::text, '-', '')),
  team_id    uuid not null references public.teams(id) on delete cascade,
  domain     text not null check (domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  is_active  boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (team_id, domain)
);

-- Raw pixel hits. ip_hash = sha256(secret salt || ip); the raw IP is never
-- stored anywhere and never reaches signals. resolved = the resolveVisitor
-- adapter's answer at hit time (stub: null).
create table if not exists public.signal_pixel_hits (
  id          bigint generated always as identity primary key,
  site_key    text not null references public.signal_sites(site_key) on delete cascade,
  team_id     uuid not null references public.teams(id) on delete cascade,
  url         text not null,
  referrer    text,
  ip_hash     text not null,
  user_agent  text,
  anon_id     text,
  ts          timestamptz not null,
  received_at timestamptz not null default now(),
  resolved    jsonb
);
create index if not exists idx_signal_pixel_hits_site_time on public.signal_pixel_hits (site_key, received_at desc);
create index if not exists idx_signal_pixel_hits_ip_time   on public.signal_pixel_hits (ip_hash, received_at desc);
create index if not exists idx_signal_pixel_hits_ts        on public.signal_pixel_hits (ts);

-- ---------------------------------------------------------------------- RLS ---

alter table public.signal_sources     enable row level security;
alter table public.signals            enable row level security;
alter table public.signal_team_status enable row level security;
alter table public.signal_runs        enable row level security;
alter table public.signal_sites       enable row level security;
alter table public.signal_pixel_hits  enable row level security;

revoke all on public.signal_sources, public.signals, public.signal_team_status,
              public.signal_runs, public.signal_sites, public.signal_pixel_hits from anon, authenticated;
grant all on public.signal_sources, public.signals, public.signal_team_status,
             public.signal_runs, public.signal_sites, public.signal_pixel_hits to service_role;

grant select on public.signals, public.signal_team_status, public.signal_sites,
                public.signal_sources, public.signal_runs, public.signal_pixel_hits to authenticated;
-- Admins edit config/watchlists from the UI; nothing else is client-writable
-- (status and sites go through SECURITY DEFINER RPCs that re-check access).
grant update (name, config, is_active, cadence) on public.signal_sources to authenticated;
grant update (is_active) on public.signal_sites to authenticated;

drop policy if exists "signals: admins read all" on public.signals;
create policy "signals: admins read all" on public.signals
  for select to authenticated using ((select public.signals_is_admin()));

drop policy if exists "signals: clients read shared and own team" on public.signals;
create policy "signals: clients read shared and own team" on public.signals
  for select to authenticated using (
    visibility = 'all_clients'
    or (visibility = 'team' and team_id in (select public.signals_my_team_ids()))
  );

drop policy if exists "signal_team_status: own team" on public.signal_team_status;
create policy "signal_team_status: own team" on public.signal_team_status
  for select to authenticated using (team_id in (select public.signals_my_team_ids()));

drop policy if exists "signal_sources: admins read" on public.signal_sources;
create policy "signal_sources: admins read" on public.signal_sources
  for select to authenticated using ((select public.signals_is_admin()));
drop policy if exists "signal_sources: admins edit" on public.signal_sources;
create policy "signal_sources: admins edit" on public.signal_sources
  for update to authenticated using ((select public.signals_is_admin())) with check ((select public.signals_is_admin()));

drop policy if exists "signal_runs: admins read" on public.signal_runs;
create policy "signal_runs: admins read" on public.signal_runs
  for select to authenticated using ((select public.signals_is_admin()));

drop policy if exists "signal_sites: admins read" on public.signal_sites;
create policy "signal_sites: admins read" on public.signal_sites
  for select to authenticated using ((select public.signals_is_admin()));
drop policy if exists "signal_sites: own team reads" on public.signal_sites;
create policy "signal_sites: own team reads" on public.signal_sites
  for select to authenticated using (team_id in (select public.signals_my_team_ids()));
drop policy if exists "signal_sites: admins toggle" on public.signal_sites;
create policy "signal_sites: admins toggle" on public.signal_sites
  for update to authenticated using ((select public.signals_is_admin())) with check ((select public.signals_is_admin()));

drop policy if exists "signal_pixel_hits: admins read" on public.signal_pixel_hits;
create policy "signal_pixel_hits: admins read" on public.signal_pixel_hits
  for select to authenticated using ((select public.signals_is_admin()));
