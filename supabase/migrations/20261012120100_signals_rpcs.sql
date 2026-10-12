-- Signals foundation (2/3): RPCs.
--
-- Ingest side (service_role only):
--   signals_start_run / signals_finish_run   run log + source health
--   signals_upsert(source_key, rows jsonb)   the ONE write path, keyed on dedupe_key
-- Read side (authenticated; SECURITY INVOKER so the signals RLS is the boundary):
--   signals_overview()        per-vertical counts (today / 7d / 30d / new for my team)
--   signals_feed(...)         filtered, paged rows with my team's status
--   signals_admin_source_stats()  admin: counts per source
-- Writes for users (SECURITY DEFINER, re-check visibility):
--   signals_set_status(ids, status)
--   signals_register_site(domain, team_id)

-- ----------------------------------------------------------------- runs ---

create or replace function public.signals_start_run(p_source_key text, p_triggered_by text default 'dispatcher')
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  src public.signal_sources%rowtype;
  v_run uuid;
  v_last_success timestamptz;
begin
  select * into src from public.signal_sources where key = p_source_key for update;
  if not found then
    return jsonb_build_object('skipped', 'unknown_source');
  end if;
  if not src.is_active then
    return jsonb_build_object('skipped', 'inactive');
  end if;
  -- A run left 'running' for 30+ minutes died without finishing.
  update public.signal_runs set status = 'abandoned', finished_at = now(), error = 'never finished'
   where source_key = p_source_key and status = 'running' and started_at < now() - interval '30 minutes';
  if exists (select 1 from public.signal_runs where source_key = p_source_key and status = 'running') then
    return jsonb_build_object('skipped', 'already_running');
  end if;
  select max(started_at) into v_last_success
    from public.signal_runs where source_key = p_source_key and status in ('success', 'partial');
  insert into public.signal_runs (source_key, triggered_by) values (p_source_key, coalesce(p_triggered_by, 'dispatcher'))
  returning id into v_run;
  update public.signal_sources set last_run_status = 'running', updated_at = now() where key = p_source_key;
  return jsonb_build_object(
    'run_id', v_run,
    'last_success_at', v_last_success,
    'source', jsonb_build_object('key', src.key, 'vertical', src.vertical, 'kind', src.kind, 'cadence', src.cadence,
                                 'default_visibility', src.default_visibility, 'config', src.config)
  );
end
$$;

create or replace function public.signals_finish_run(
  p_run_id uuid, p_status text, p_fetched integer, p_inserted integer, p_updated integer,
  p_deduped integer, p_error text default null, p_detail jsonb default '{}'::jsonb
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_source text;
  v_started timestamptz;
begin
  update public.signal_runs
     set status = p_status, finished_at = now(), fetched = coalesce(p_fetched, 0),
         inserted = coalesce(p_inserted, 0), updated = coalesce(p_updated, 0), deduped = coalesce(p_deduped, 0),
         error = left(p_error, 2000), detail = coalesce(p_detail, '{}'::jsonb)
   where id = p_run_id
  returning source_key, started_at into v_source, v_started;
  if v_source is null then
    raise exception 'unknown run %', p_run_id;
  end if;
  update public.signal_sources
     set last_run_at = v_started, last_run_status = p_status, last_error = left(p_error, 2000),
         items_last_run = coalesce(p_inserted, 0), updated_at = now()
   where key = v_source;
end
$$;

-- ---------------------------------------------------------------- upsert ---
-- The one write path. Rows are deduped on dedupe_key (last one in the batch
-- wins); an existing row is updated only when something changed, and only by
-- its own source. Visibility comes from the row, else the source default; the
-- guard trigger refuses anything wider than an admin-only source allows.
-- Returns {received, inserted, updated, deduped, rejected}.

create or replace function public.signals_upsert(p_source_key text, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  src public.signal_sources%rowtype;
  v_received integer := coalesce(jsonb_array_length(p_rows), 0);
  v_valid integer;
  v_inserted integer := 0;
  v_updated integer := 0;
begin
  select * into src from public.signal_sources where key = p_source_key;
  if not found then
    raise exception 'unknown signal source %', p_source_key;
  end if;

  create temporary table if not exists _signals_in (
    ord integer, signal_type text, occurred_at timestamptz, company_name text, company_domain text,
    person_name text, person_title text, person_email text, person_linkedin text, city text, state text,
    country text, title text, url text, score integer, payload jsonb, dedupe_key text, visibility text, team_id uuid
  ) on commit drop;
  truncate _signals_in;

  insert into _signals_in
  select x.ord::integer, r.signal_type, r.occurred_at, nullif(btrim(r.company_name), ''), nullif(lower(btrim(r.company_domain)), ''),
         nullif(btrim(r.person_name), ''), nullif(btrim(r.person_title), ''), nullif(lower(btrim(r.person_email)), ''),
         nullif(btrim(r.person_linkedin), ''), nullif(btrim(r.city), ''), nullif(btrim(r.state), ''), nullif(btrim(r.country), ''),
         left(btrim(r.title), 500), nullif(btrim(r.url), ''), greatest(0, least(100, coalesce(r.score, 0))),
         coalesce(r.payload, '{}'::jsonb), btrim(r.dedupe_key),
         case when src.default_visibility = 'admin' then 'admin' else coalesce(r.visibility, src.default_visibility) end,
         r.team_id
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality as x(elem, ord)
    cross join lateral jsonb_to_record(x.elem) as r(
      signal_type text, occurred_at timestamptz, company_name text, company_domain text, person_name text,
      person_title text, person_email text, person_linkedin text, city text, state text, country text,
      title text, url text, score integer, payload jsonb, dedupe_key text, visibility text, team_id uuid)
   where nullif(btrim(r.dedupe_key), '') is not null
     and nullif(btrim(r.title), '') is not null
     and r.occurred_at is not null
     and r.signal_type ~ '^[a-z0-9][a-z0-9_]{1,62}$';

  select count(*) into v_valid from _signals_in;

  with dedup as (
    select distinct on (dedupe_key) * from _signals_in order by dedupe_key, ord desc
  ), up as (
    insert into public.signals as s (
      source_key, vertical, signal_type, occurred_at, company_name, company_domain, person_name, person_title,
      person_email, person_linkedin, city, state, country, title, url, score, payload, dedupe_key, visibility, team_id)
    select p_source_key, src.vertical, signal_type, occurred_at, company_name, company_domain, person_name, person_title,
           person_email, person_linkedin, city, state, country, title, url, score, payload, dedupe_key, visibility, team_id
      from dedup
    on conflict (dedupe_key) do update set
      signal_type = excluded.signal_type, occurred_at = excluded.occurred_at, company_name = excluded.company_name,
      company_domain = excluded.company_domain, person_name = excluded.person_name, person_title = excluded.person_title,
      person_email = excluded.person_email, person_linkedin = excluded.person_linkedin, city = excluded.city,
      state = excluded.state, country = excluded.country, title = excluded.title, url = excluded.url,
      score = excluded.score, payload = excluded.payload
    where s.source_key = excluded.source_key
      and (s.signal_type, s.occurred_at, s.company_name, s.company_domain, s.person_name, s.person_title,
           s.person_email, s.person_linkedin, s.city, s.state, s.country, s.title, s.url, s.score, s.payload)
          is distinct from
          (excluded.signal_type, excluded.occurred_at, excluded.company_name, excluded.company_domain,
           excluded.person_name, excluded.person_title, excluded.person_email, excluded.person_linkedin,
           excluded.city, excluded.state, excluded.country, excluded.title, excluded.url, excluded.score, excluded.payload)
    returning (xmax = 0) as is_insert
  )
  select count(*) filter (where is_insert), count(*) filter (where not is_insert) into v_inserted, v_updated from up;

  return jsonb_build_object(
    'received', v_received,
    'inserted', v_inserted,
    'updated', v_updated,
    'deduped', v_valid - v_inserted - v_updated,
    'rejected', v_received - v_valid
  );
end
$$;

-- ------------------------------------------------------------ read side ---

-- Per-vertical counts of what the caller can read (RLS), plus 'new' for the
-- caller's team. Admins also get configured verticals that have no signals yet.
create or replace function public.signals_overview()
returns jsonb
language sql stable security invoker set search_path = public
as $$
  with my_team as (select public.signals_my_team_id() as team_id),
  counts as (
    select s.vertical,
           count(*) filter (where s.occurred_at >= date_trunc('day', now())) as today,
           count(*) filter (where s.occurred_at >= now() - interval '7 days') as d7,
           count(*) filter (where s.occurred_at >= now() - interval '30 days') as d30,
           count(*) as total,
           count(*) filter (where coalesce(ts.status, 'new') = 'new') as new_for_team
      from public.signals s
      left join public.signal_team_status ts on ts.signal_id = s.id and ts.team_id = (select team_id from my_team)
     group by s.vertical
  ),
  configured as (
    select distinct vertical from public.signal_sources  -- RLS: admins only
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'vertical', v.vertical, 'today', coalesce(c.today, 0), 'd7', coalesce(c.d7, 0),
           'd30', coalesce(c.d30, 0), 'total', coalesce(c.total, 0), 'new', coalesce(c.new_for_team, 0))
           order by v.vertical), '[]'::jsonb)
    from (select vertical from counts union select vertical from configured) v
    left join counts c using (vertical)
$$;

create or replace function public.signals_feed(
  p_vertical   text,
  p_from       timestamptz default null,
  p_to         timestamptz default null,
  p_min_score  integer default null,
  p_status     text default null,      -- 'new' | 'reviewed' | 'dismissed' | 'pushed' | null = all but dismissed
  p_state      text default null,
  p_country    text default null,
  p_search     text default null,
  p_source_key text default null,
  p_limit      integer default 50,
  p_offset     integer default 0
)
returns jsonb
language sql stable security invoker set search_path = public
as $$
  with my_team as (select public.signals_my_team_id() as team_id),
  f as (
    select s.*, coalesce(ts.status, 'new') as team_status, ts.updated_at as status_updated_at
      from public.signals s
      left join public.signal_team_status ts on ts.signal_id = s.id and ts.team_id = (select team_id from my_team)
     where s.vertical = p_vertical
       and (p_from is null or s.occurred_at >= p_from)
       and (p_to is null or s.occurred_at < p_to)
       and (p_min_score is null or s.score >= p_min_score)
       and (p_source_key is null or s.source_key = p_source_key)
       and (p_state is null or s.state ilike p_state)
       and (p_country is null or s.country ilike p_country)
       and (p_search is null or btrim(p_search) = '' or
            (coalesce(s.title, '') || ' ' || coalesce(s.company_name, '') || ' ' || coalesce(s.company_domain, '') || ' ' ||
             coalesce(s.person_name, '') || ' ' || coalesce(s.person_title, '') || ' ' || coalesce(s.city, ''))
              ilike '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%')
  ),
  g as (
    select * from f
     where case when p_status is null then team_status <> 'dismissed' else team_status = p_status end
  )
  select jsonb_build_object(
    'total', (select count(*) from g),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.occurred_at desc, r.id)
        from (select id, source_key, vertical, signal_type, occurred_at, company_name, company_domain, person_name,
                     person_title, person_email, person_linkedin, city, state, country, title, url, score, payload,
                     visibility, team_status, status_updated_at, created_at
                from g order by occurred_at desc, id
               limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) r
    ), '[]'::jsonb)
  )
$$;

create or replace function public.signals_admin_source_stats()
returns jsonb
language plpgsql stable security invoker set search_path = public
as $$
begin
  if not public.signals_is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'source_key', src.key, 'total', coalesce(c.total, 0), 'today', coalesce(c.today, 0),
             'd7', coalesce(c.d7, 0), 'd30', coalesce(c.d30, 0), 'latest', c.latest) order by src.key)
      from public.signal_sources src
      left join (
        select source_key, count(*) total,
               count(*) filter (where occurred_at >= date_trunc('day', now())) today,
               count(*) filter (where occurred_at >= now() - interval '7 days') d7,
               count(*) filter (where occurred_at >= now() - interval '30 days') d30,
               max(occurred_at) latest
          from public.signals group by source_key
      ) c on c.source_key = src.key
  ), '[]'::jsonb);
end
$$;

-- ------------------------------------------------------------ user writes ---

create or replace function public.signals_set_status(p_signal_ids uuid[], p_status text)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_team uuid := public.signals_my_team_id();
  v_n integer;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if v_team is null then
    raise exception 'no team' using errcode = '42501';
  end if;
  if p_status not in ('new', 'reviewed', 'dismissed') then
    -- 'pushed' is written by the phase-2 audience push, not by users.
    raise exception 'invalid status %', p_status;
  end if;
  insert into public.signal_team_status (signal_id, team_id, status, updated_by, updated_at)
  select s.id, v_team, p_status, auth.uid(), now()
    from public.signals s
   where s.id = any(p_signal_ids)
     -- the same visibility rule as the RLS policies
     and (public.signals_is_admin()
          or s.visibility = 'all_clients'
          or (s.visibility = 'team' and s.team_id in (select public.signals_my_team_ids())))
  on conflict (signal_id, team_id) do update
    set status = excluded.status, updated_by = excluded.updated_by, updated_at = excluded.updated_at
    where public.signal_team_status.status <> 'pushed';
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

-- Register (or fetch) a pixel site. Users register for their own team; admins
-- may pass any team. Returns the site row.
create or replace function public.signals_register_site(p_domain text, p_team_id uuid default null)
returns public.signal_sites
language plpgsql security definer set search_path = public
as $$
declare
  v_team uuid;
  v_domain text := lower(btrim(coalesce(p_domain, '')));
  v_row public.signal_sites;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_team_id is not null and p_team_id is distinct from public.signals_my_team_id() then
    if not public.signals_is_admin() then
      raise exception 'admin only' using errcode = '42501';
    end if;
    v_team := p_team_id;
  else
    v_team := public.signals_my_team_id();
  end if;
  if v_team is null then
    raise exception 'no team' using errcode = '42501';
  end if;
  v_domain := regexp_replace(v_domain, '^[a-z]+://', '');
  v_domain := regexp_replace(v_domain, '[/:?#].*$', '');
  v_domain := regexp_replace(v_domain, '^www\.', '');
  if v_domain !~ '^[a-z0-9.-]+\.[a-z]{2,}$' then
    raise exception 'invalid domain %', p_domain;
  end if;
  insert into public.signal_sites (team_id, domain, created_by) values (v_team, v_domain, auth.uid())
  on conflict (team_id, domain) do nothing;
  select * into v_row from public.signal_sites where team_id = v_team and domain = v_domain;
  return v_row;
end
$$;

-- -------------------------------------------------------------- grants ---

revoke all on function public.signals_start_run(text, text) from public, anon, authenticated;
revoke all on function public.signals_finish_run(uuid, text, integer, integer, integer, integer, text, jsonb) from public, anon, authenticated;
revoke all on function public.signals_upsert(text, jsonb) from public, anon, authenticated;
grant execute on function public.signals_start_run(text, text) to service_role;
grant execute on function public.signals_finish_run(uuid, text, integer, integer, integer, integer, text, jsonb) to service_role;
grant execute on function public.signals_upsert(text, jsonb) to service_role;

revoke all on function public.signals_overview() from public, anon;
revoke all on function public.signals_feed(text, timestamptz, timestamptz, integer, text, text, text, text, text, integer, integer) from public, anon;
revoke all on function public.signals_admin_source_stats() from public, anon;
revoke all on function public.signals_set_status(uuid[], text) from public, anon;
revoke all on function public.signals_register_site(text, uuid) from public, anon;
grant execute on function public.signals_overview() to authenticated;
grant execute on function public.signals_feed(text, timestamptz, timestamptz, integer, text, text, text, text, text, integer, integer) to authenticated;
grant execute on function public.signals_admin_source_stats() to authenticated;
grant execute on function public.signals_set_status(uuid[], text) to authenticated;
grant execute on function public.signals_register_site(text, uuid) to authenticated;
