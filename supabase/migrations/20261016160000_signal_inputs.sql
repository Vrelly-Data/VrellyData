-- Signals Phase 3: Signal Inputs — per-team, user-configurable inputs.
--
-- Until now every source's watchlist lived in the global signal_sources.config
-- (admins only, no UI for most of it). A Signal Input is a team's own saved
-- query against one input family:
--
--   hiring   companies with open roles: job titles, job locations, industries,
--            company size, posted within N days (Apollo organization search)
--   github   keywords / topics, orgs, min stars (GitHub search API)
--   medical  openFDA 510(k) / PMA / De Novo / recalls / registrations &
--            listings, ClinicalTrials.gov new device trials, FDA Breakthrough
--            authorizations; product codes, device keywords, companies
--
-- (Website visitors are configured per site in signal_sites, unchanged.)
--
-- edge function signal-inputs-run runs them: daily per writer source below
-- (dispatch-signal-sources), on "Run now", and as a no-write preview.
-- Signals it writes carry payload.input_id and are visible only to the
-- input's team (visibility 'team'), unless a platform admin marks the input
-- all_clients.

-- =========================================================== signal_inputs ===

create table if not exists public.signal_inputs (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references public.teams(id) on delete cascade,
  source_key      text not null check (source_key in ('hiring', 'github', 'medical')),
  name            text not null check (length(btrim(name)) between 1 and 120),
  filters         jsonb not null default '{}'::jsonb
                    check (jsonb_typeof(filters) = 'object' and pg_column_size(filters) <= 16384),
  is_active       boolean not null default true,
  -- Admin-only: signals from this input are shown to every client.
  all_clients     boolean not null default false,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Written by signal-inputs-run only (service role).
  last_run_at     timestamptz,
  last_run_status text check (last_run_status in ('running', 'success', 'partial', 'failed', 'skipped')),
  -- { "<writer source key>": { at, status, fetched, matched, inserted, updated, error, credits } }
  last_run        jsonb not null default '{}'::jsonb,
  preview_count   integer,
  preview_at      timestamptz
);

create index if not exists idx_signal_inputs_team on public.signal_inputs (team_id, created_at);
create index if not exists idx_signal_inputs_active on public.signal_inputs (source_key) where is_active;

comment on table public.signal_inputs is
  'Signal Inputs: a team''s saved query against one input family (hiring, github, medical). Run by signal-inputs-run; signals it writes carry payload.input_id.';

-- Guard: only platform admins (or the service role / migrations) may set
-- all_clients or move an input to another team; at most 25 inputs per team.
create or replace function public.signal_inputs_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_trusted boolean := public.signals_is_admin()
    or coalesce(auth.role(), '') = 'service_role'
    or current_user in ('postgres', 'supabase_admin', 'service_role');
begin
  if tg_op = 'INSERT' then
    if new.all_clients and not v_trusted then
      raise exception 'only a platform admin can share a Signal Input with all clients' using errcode = '42501';
    end if;
    if (select count(*) from public.signal_inputs i where i.team_id = new.team_id) >= 25 then
      raise exception 'a team can have at most 25 Signal Inputs' using errcode = '23514';
    end if;
  else
    if new.all_clients is distinct from old.all_clients and not v_trusted then
      raise exception 'only a platform admin can share a Signal Input with all clients' using errcode = '42501';
    end if;
    if new.team_id is distinct from old.team_id and not v_trusted then
      raise exception 'a Signal Input cannot move to another team' using errcode = '42501';
    end if;
    if new.source_key is distinct from old.source_key then
      raise exception 'the input type of a Signal Input cannot change' using errcode = '23514';
    end if;
  end if;
  new.name := btrim(new.name);
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists signal_inputs_guard on public.signal_inputs;
create trigger signal_inputs_guard before insert or update on public.signal_inputs
  for each row execute function public.signal_inputs_guard();

alter table public.signal_inputs enable row level security;
revoke all on public.signal_inputs from anon, authenticated;
grant all on public.signal_inputs to service_role;
grant select, delete on public.signal_inputs to authenticated;
grant insert (team_id, source_key, name, filters, is_active, all_clients) on public.signal_inputs to authenticated;
grant update (name, filters, is_active, all_clients) on public.signal_inputs to authenticated;

drop policy if exists "signal_inputs: admins all" on public.signal_inputs;
create policy "signal_inputs: admins all" on public.signal_inputs
  for all to authenticated
  using ((select public.signals_is_admin())) with check ((select public.signals_is_admin()));

drop policy if exists "signal_inputs: own team reads" on public.signal_inputs;
create policy "signal_inputs: own team reads" on public.signal_inputs
  for select to authenticated using (team_id in (select public.signals_my_team_ids()));

drop policy if exists "signal_inputs: own team creates" on public.signal_inputs;
create policy "signal_inputs: own team creates" on public.signal_inputs
  for insert to authenticated with check (team_id in (select public.signals_my_team_ids()));

drop policy if exists "signal_inputs: own team edits" on public.signal_inputs;
create policy "signal_inputs: own team edits" on public.signal_inputs
  for update to authenticated
  using (team_id in (select public.signals_my_team_ids()))
  with check (team_id in (select public.signals_my_team_ids()));

drop policy if exists "signal_inputs: own team deletes" on public.signal_inputs;
create policy "signal_inputs: own team deletes" on public.signal_inputs
  for delete to authenticated using (team_id in (select public.signals_my_team_ids()));

-- ===================================================== writer signal sources ===
-- One signal_sources row per signal type an input can write (the visibility
-- guard takes signal_type from the source). All run by signal-inputs-run,
-- daily; the dispatcher passes {source_key}.

insert into public.signal_sources (key, name, kind, cadence, default_visibility, function_name, config, is_active, signal_type, default_markets)
values
  ('input_hiring',           'Signal Inputs: hiring (Apollo job postings)',          'api', 'daily', 'team', 'signal-inputs-run',
     '{"apollo_max_pages": 1, "apollo_max_postings_lookups": 10}'::jsonb, true, 'hiring', '{}'),
  ('input_github',           'Signal Inputs: GitHub',                                'api', 'daily', 'team', 'signal-inputs-run',
     '{"lookback_days": 7, "max_results": 50}'::jsonb, true, 'product_launch', '{saas}'),
  ('input_fda_clearance',    'Signal Inputs: FDA 510(k) / PMA / De Novo / Breakthrough', 'api', 'daily', 'team', 'signal-inputs-run',
     '{"lookback_days": 30, "max_results": 200}'::jsonb, true, 'fda_clearance', '{medical_device}'),
  ('input_fda_recall',       'Signal Inputs: FDA device recalls',                    'api', 'daily', 'team', 'signal-inputs-run',
     '{"lookback_days": 30, "max_results": 200}'::jsonb, true, 'fda_recall', '{medical_device}'),
  ('input_fda_registration', 'Signal Inputs: FDA registrations & listings',          'api', 'daily', 'team', 'signal-inputs-run',
     '{"lookback_days": 30, "max_results": 200}'::jsonb, true, 'fda_registration', '{medical_device}'),
  ('input_clinical_trial',   'Signal Inputs: ClinicalTrials.gov device trials',      'api', 'daily', 'team', 'signal-inputs-run',
     '{"lookback_days": 30, "max_results": 200}'::jsonb, true, 'clinical_trial', '{medical_device}')
on conflict (key) do nothing;

-- ================================================================ read RPCs ===

create index if not exists idx_signals_input_id on public.signals ((payload ->> 'input_id'), occurred_at desc)
  where payload ? 'input_id';

-- What one Signal Input returned (newest first), in the feed's client-safe shape.
create or replace function public.signal_input_results(p_input_id uuid, p_limit integer default 25)
returns jsonb
language plpgsql stable security definer set search_path = public
set statement_timeout = '15s'
as $$
declare
  v_input public.signal_inputs%rowtype;
  v_admin boolean := public.signals_is_admin();
begin
  select * into v_input from public.signal_inputs where id = p_input_id;
  if not found or not (v_admin or v_input.team_id in (select public.signals_my_team_ids())) then
    raise exception 'Signal Input not found' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'total', (select count(*) from public.signals s where s.payload ->> 'input_id' = p_input_id::text),
    'd7', (select count(*) from public.signals s where s.payload ->> 'input_id' = p_input_id::text
             and s.created_at >= now() - interval '7 days'),
    'rows', coalesce((
      select jsonb_agg(public.signals_row_json(x.s, x.status, x.status_at, v_admin) order by (x.s).occurred_at desc)
        from (
          select s, ts.status, ts.updated_at as status_at
            from public.signals s
            left join public.signal_team_status ts on ts.signal_id = s.id and ts.team_id = v_input.team_id
           where s.payload ->> 'input_id' = p_input_id::text
           order by s.occurred_at desc
           limit least(greatest(coalesce(p_limit, 25), 1), 100)
        ) x
    ), '[]'::jsonb)
  );
end
$$;

-- Website visitors: each visible site with when its pixel last reported in.
create or replace function public.signals_site_status()
returns table (site_key text, team_id uuid, domain text, is_active boolean, created_at timestamptz,
               last_hit_at timestamptz, hits_7d bigint)
language sql stable security definer set search_path = public
set statement_timeout = '15s'
as $$
  select s.site_key, s.team_id, s.domain, s.is_active, s.created_at,
         (select max(h.received_at) from public.signal_pixel_hits h where h.site_key = s.site_key),
         (select count(*) from public.signal_pixel_hits h where h.site_key = s.site_key
            and h.received_at >= now() - interval '7 days')
    from public.signal_sites s
   where public.signals_is_admin() or s.team_id in (select public.signals_my_team_ids())
   order by s.created_at
$$;

revoke all on function public.signal_input_results(uuid, integer) from public, anon;
revoke all on function public.signals_site_status() from public, anon;
grant execute on function public.signal_input_results(uuid, integer) to authenticated, service_role;
grant execute on function public.signals_site_status() to authenticated, service_role;
