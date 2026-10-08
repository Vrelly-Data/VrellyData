-- Agent Audiences: Vrelly source (part 2 of 2) — the search.
--
-- WHY A SEPARATE SEARCH INDEX AND NOT public.prospects DIRECTLY. prospects is
-- 1.91M rows in a 4.4GB heap (8.8GB with indexes) on an instance with ~1.5GB
-- of cache, so any query that has to visit matching rows reads them from
-- disk. Measured 2026-10-08: counting the Agent Upload audience
-- (CEO/Owner/Founder, Financial Services, US) straight off prospects took
-- 10.0s, 38k heap blocks read, even with the trigram indexes doing the
-- filtering. The table has not changed since 2026-03-17.
--
-- So the search reads two narrow materialized views instead, both physically
-- ordered by id:
--   prospect_audience_search    every filterable column, lower-cased once, plus
--                               the dedup keys; only rows WITH a business email
--                               (1.72M of 1.91M) — the others can never be
--                               pushed. ~325MB.
--   prospect_audience_keywords  the company description/keywords tsvector,
--                               stripped of positions. ~620MB, kept apart so
--                               the common, keyword-free search never reads it.
-- Full prospect rows are fetched by primary key only for the page returned.
--
-- Ordering by id is what makes runs "walk the list": a run takes the first
-- max_per_run matches in id order, those people become pushes, the exclusion
-- below drops them, and the next run starts where the last one ended.
--
-- Reading public.prospects to build the views takes only ACCESS SHARE on it:
-- selects, inserts and updates on prospects carry on during the ~2.5 min build.
--
-- REFRESH: weekly (Sunday 07:10 UTC), concurrently, skip-if-running, with its
-- own 30min statement_timeout. prospects is imported in bulk and rarely;
-- public.refresh_prospect_audience_index() can be run by hand after an import.

create extension if not exists pg_trgm;

-- Must match normalizeLinkedInUrl in _shared/lead-dedup.ts exactly, or the
-- LinkedIn exclusion silently misses: lower+trim, strip protocol, strip www.,
-- cut #fragment and ?query, strip trailing slashes.
create or replace function public.audience_linkedin_key(p_url text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(
    regexp_replace(
      split_part(split_part(
        regexp_replace(regexp_replace(lower(btrim(p_url)), '^https?://', ''), '^www\.', ''),
        '#', 1), '?', 1),
      '/+$', ''),
    '');
$$;

do $mv$
begin
  if to_regclass('public.prospect_audience_search') is null then
    create materialized view public.prospect_audience_search as
    select p.id,
           p.job_title,
           lower(btrim(p.seniority))        as seniority_l,
           p.department,
           p.company_industry,
           lower(btrim(p.company_size))     as company_size_l,
           lower(btrim(p.country))          as country_l,
           lower(btrim(p.state))            as state_l,
           lower(btrim(p.company_country))  as company_country_l,
           lower(btrim(p.company_state))    as company_state_l,
           lower(btrim(p.business_email))   as email_key,
           public.audience_linkedin_key(p.linkedin_url) as linkedin_key
    from public.prospects p
    where nullif(btrim(p.business_email), '') is not null
    order by p.id;

  end if;

  if to_regclass('public.prospect_audience_keywords') is null then
    create materialized view public.prospect_audience_keywords as
    select p.id,
           strip(to_tsvector('english', coalesce(p.company_description, '') || ' ' || coalesce(p.keywords, ''))) as kw
    from public.prospects p
    where nullif(btrim(p.business_email), '') is not null
      and (nullif(btrim(p.company_description), '') is not null or nullif(btrim(p.keywords), '') is not null)
    order by p.id;

  end if;
end
$mv$;

-- Not exposed: prospects data reaches clients only through the definer function.
revoke all on public.prospect_audience_search, public.prospect_audience_keywords from public, anon, authenticated;
-- Indexes are built by 20261008150100's companion 20261008150200 with CREATE
-- INDEX CONCURRENTLY, outside a transaction, so nothing waits on them.

comment on materialized view public.prospect_audience_search is
  'Narrow, id-ordered copy of the filterable prospects columns (rows with a business email only) for Agent Audiences source=vrelly. Read by vrelly_audience_search; refreshed weekly by refresh-prospect-audience-index.';
comment on materialized view public.prospect_audience_keywords is
  'Company description/keywords tsvector per prospect, for the Vrelly audience keyword filter. Refreshed with prospect_audience_search.';

create or replace function public.refresh_prospect_audience_index()
returns text
language plpgsql
set search_path = public
set lock_timeout = '2min'
as $$
begin
  if not pg_try_advisory_xact_lock(hashtext('public.refresh_prospect_audience_index')) then
    raise notice 'refresh_prospect_audience_index: skipped, a refresh is already running';
    return 'skipped';
  end if;
  refresh materialized view concurrently public.prospect_audience_search;
  refresh materialized view concurrently public.prospect_audience_keywords;
  return 'refreshed';
end;
$$;
revoke all on function public.refresh_prospect_audience_index() from public, anon, authenticated;

do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'refresh-prospect-audience-index',
      '10 7 * * 0',
      $job$set statement_timeout = '30min'; select public.refresh_prospect_audience_index();$job$
    );
  end if;
end
$cron$;

-- ---------------------------------------------------------------------------
-- The search.
--
-- p_query is CompiledVrellyQuery from _shared/vrelly-audience.ts: every key is
-- a text[] (or null = no filter). Lists are OR-ed within, AND-ed across.
-- Only the clauses actually in use are put into the SQL, so the planner sees a
-- query it can plan for this filter set (no "x is null or …" guards).
--
-- Excluded, always: anyone this user already pushed (any audience, any source),
-- any agent_lead of this user, and any synced contact of a team the user is a
-- member of — matched on lower(email) AND on normalized LinkedIn URL.
--
-- Returns { people: [...], total, total_capped } — total only when p_count.
-- service_role only: the caller (an edge function) has already authenticated
-- the user and passes their id.
-- ---------------------------------------------------------------------------
create or replace function public.vrelly_audience_search(
  p_user_id uuid,
  p_query jsonb,
  p_limit integer default 25,
  p_offset integer default 0,
  p_count boolean default false,
  p_count_cap integer default 100000,
  p_prospect_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
set work_mem = '64MB'
as $$
declare
  v_where text := '';
  v_where_base text;
  v_estimate boolean := false;
  v_base bigint;
  v_hits bigint;
  v_sampled bigint;
  v_terms text[];
  v_tsq tsquery;
  v_term text;
  v_people jsonb;
  v_total bigint;
  v_cap integer := greatest(1, least(coalesce(p_count_cap, 100000), 1000000));
  arr text[];
  a_title text[]; a_xtitle text[]; a_sen text[]; a_dept text[]; a_ind text[]; a_size text[];
  a_pc text[]; a_ps text[]; a_cc text[]; a_cs text[];
begin
  if p_user_id is null then
    raise exception 'vrelly_audience_search: p_user_id is required' using errcode = '22023';
  end if;

  -- jsonb list -> text[]; null/absent/empty -> null (no filter).
  for v_term in select unnest(array['title_patterns','exclude_title_patterns','seniorities','department_patterns','industry_patterns',
                                    'company_sizes','person_countries','person_states','company_countries',
                                    'company_states','keywords'])
  loop
    arr := null;
    if jsonb_typeof(p_query -> v_term) = 'array' then
      select array_agg(x) into arr from jsonb_array_elements_text(p_query -> v_term) x where btrim(x) <> '';
    end if;
    case v_term
      when 'title_patterns'      then a_title := arr;
      when 'exclude_title_patterns' then a_xtitle := arr;
      when 'seniorities'         then a_sen := arr;
      when 'department_patterns' then a_dept := arr;
      when 'industry_patterns'   then a_ind := arr;
      when 'company_sizes'       then a_size := arr;
      when 'person_countries'    then a_pc := arr;
      when 'person_states'       then a_ps := arr;
      when 'company_countries'   then a_cc := arr;
      when 'company_states'      then a_cs := arr;
      when 'keywords'            then v_terms := arr;
    end case;
  end loop;

  -- Keywords: terms are OR-ed; the words inside one term must all appear
  -- (plainto_tsquery = AND), the same rule the Apollo keyword box states. NOT a
  -- phrase match: prospect_audience_keywords stores a position-stripped
  -- tsvector (a third smaller), and a phrase query (<->) never matches a
  -- stripped vector — measured: "private equity" as a phrase found 0 rows.
  -- A term made only of stop words compiles to an empty query; refuse it.
  if v_terms is not null then
    foreach v_term in array v_terms loop
      if numnode(plainto_tsquery('english', v_term)) = 0 then
        raise exception 'Keyword "%" is only common words and cannot be searched', v_term using errcode = '22023';
      end if;
      v_tsq := case when v_tsq is null then plainto_tsquery('english', v_term)
                    else v_tsq || plainto_tsquery('english', v_term) end;
    end loop;
  end if;

  if a_title is null and a_sen is null and a_dept is null and a_ind is null and a_size is null
     and a_pc is null and a_ps is null and a_cc is null and a_cs is null and v_tsq is null
     and p_prospect_ids is null then
    raise exception 'vrelly_audience_search: at least one filter is required' using errcode = '22023';
  end if;

  if a_title is not null then v_where := v_where || ' and s.job_title ilike any ($1)'; end if;
  if a_sen   is not null then v_where := v_where || ' and s.seniority_l = any ($2)'; end if;
  if a_dept  is not null then v_where := v_where || ' and s.department ilike any ($3)'; end if;
  if a_ind   is not null then v_where := v_where || ' and s.company_industry ilike any ($4)'; end if;
  if a_size  is not null then v_where := v_where || ' and s.company_size_l = any ($5)'; end if;
  if a_pc    is not null then v_where := v_where || ' and s.country_l = any ($6)'; end if;
  if a_ps    is not null then v_where := v_where || ' and s.state_l = any ($7)'; end if;
  if a_cc    is not null then v_where := v_where || ' and s.company_country_l = any ($8)'; end if;
  if a_cs    is not null then v_where := v_where || ' and s.company_state_l = any ($9)'; end if;
  if p_prospect_ids is not null then v_where := v_where || ' and s.id = any ($11)'; end if;
  -- Exclusions narrow; they never count as a filter on their own (above).
  if a_xtitle is not null then v_where := v_where || ' and coalesce(s.job_title, '''') not ilike all ($14)'; end if;

  -- Exclusion keys for this user, once per call.
  create temp table if not exists _vas_ex_email (k text primary key) on commit drop;
  create temp table if not exists _vas_ex_li (k text primary key) on commit drop;
  truncate _vas_ex_email, _vas_ex_li;

  insert into _vas_ex_email (k)
  select distinct k from (
    select ap.email_key as k from public.agent_audience_pushes ap where ap.user_id = p_user_id
    union all select lower(btrim(l.email)) from public.agent_leads l where l.user_id = p_user_id
    union all select lower(btrim(l.email_address)) from public.agent_leads l where l.user_id = p_user_id
    union all select lower(btrim(sc.email)) from public.synced_contacts sc
      where sc.team_id in (select tm.team_id from public.team_memberships tm where tm.user_id = p_user_id)
  ) e where k is not null and k <> '';

  insert into _vas_ex_li (k)
  select distinct k from (
    select ap.linkedin_key as k from public.agent_audience_pushes ap where ap.user_id = p_user_id
    union all select public.audience_linkedin_key(l.linkedin_url) from public.agent_leads l where l.user_id = p_user_id
    union all select public.audience_linkedin_key(sc.linkedin_url) from public.synced_contacts sc
      where sc.team_id in (select tm.team_id from public.team_memberships tm where tm.user_id = p_user_id)
  ) e where k is not null and k <> '';
  analyze _vas_ex_email;
  analyze _vas_ex_li;

  v_where := v_where
    || ' and not exists (select 1 from _vas_ex_email e where e.k = s.email_key)'
    || ' and (s.linkedin_key is null or not exists (select 1 from _vas_ex_li l where l.k = s.linkedin_key))';
  -- Everything except the keyword clause; the keyword count samples on top of it.
  v_where_base := v_where;
  if v_tsq is not null then
    v_where := v_where || ' and exists (select 1 from public.prospect_audience_keywords k where k.id = s.id and k.kw @@ $10)';
  end if;

  if coalesce(p_limit, 0) > 0 then
    execute format($q$
      select coalesce(jsonb_agg(to_jsonb(r) order by r.prospect_id), '[]'::jsonb)
      from (
        select p.id as prospect_id,
               nullif(btrim(p.first_name), '') as first_name,
               nullif(btrim(p.last_name), '') as last_name,
               btrim(p.business_email) as email,
               nullif(btrim(p.job_title), '') as title,
               nullif(btrim(p.seniority), '') as seniority,
               nullif(btrim(p.department), '') as department,
               nullif(btrim(p.company_name), '') as company_name,
               nullif(btrim(p.company_domain), '') as company_domain,
               nullif(btrim(p.company_industry), '') as company_industry,
               nullif(btrim(p.company_size), '') as company_size,
               nullif(btrim(p.linkedin_url), '') as linkedin_url,
               nullif(btrim(p.city), '') as city,
               nullif(btrim(p.state), '') as state,
               nullif(btrim(p.country), '') as country
        from (
          select s.id from public.prospect_audience_search s
          where true %s
          order by s.id
          limit $12 offset $13
        ) page
        join public.prospects p on p.id = page.id
      ) r
    $q$, v_where)
    into v_people
    using a_title, a_sen, a_dept, a_ind, a_size, a_pc, a_ps, a_cc, a_cs, v_tsq, p_prospect_ids,
          least(p_limit, 500), greatest(coalesce(p_offset, 0), 0), a_xtitle;
  else
    v_people := '[]'::jsonb;
  end if;

  -- COUNT, capped at v_cap. Without keywords it is exact. With keywords,
  -- checking a candidate's description is one random read of
  -- prospect_audience_keywords per candidate (measured on prod-size data:
  -- 20,825 candidates -> seconds cold), so ONE pass over the other filters
  -- counts every candidate and checks keywords only for the first v_sample of
  -- them in scan order (the views are physically id-ordered and ids are random
  -- UUIDs, so that is an unbiased sample). If there are no more candidates
  -- than that, every one was checked and the count is exact; otherwise the hit
  -- rate is applied to the exact candidate count and 'total_is_estimate' says so.
  if p_count then
    if v_tsq is null then
      execute format($q$
        select count(*) from (
          select 1 from public.prospect_audience_search s where true %s limit $12
        ) x
      $q$, v_where_base)
      into v_base
      using a_title, a_sen, a_dept, a_ind, a_size, a_pc, a_ps, a_cc, a_cs, v_tsq, p_prospect_ids, v_cap + 1,
            null::integer, a_xtitle;
      v_total := v_base;
    else
      execute format($q$
        select count(*),
               count(*) filter (where x.n <= 2000),
               count(*) filter (where x.n <= 2000 and exists (
                 select 1 from public.prospect_audience_keywords k where k.id = x.id and k.kw @@ $10))
        from (
          select s.id, row_number() over () as n
          from public.prospect_audience_search s where true %s limit $12
        ) x
      $q$, v_where_base)
      into v_base, v_sampled, v_hits
      using a_title, a_sen, a_dept, a_ind, a_size, a_pc, a_ps, a_cc, a_cs, v_tsq, p_prospect_ids, v_cap + 1,
            null::integer, a_xtitle;
      if v_base <= v_sampled then
        v_total := v_hits;
      else
        v_total := round(v_base::numeric * v_hits / greatest(v_sampled, 1));
        v_estimate := true;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'people', v_people,
    'total', case when p_count then least(v_total, v_cap) end,
    'total_capped', coalesce(p_count and v_base > v_cap, false),
    'total_is_estimate', v_estimate
  );
end;
$$;

revoke all on function public.vrelly_audience_search(uuid, jsonb, integer, integer, boolean, integer, uuid[]) from public, anon, authenticated;
grant execute on function public.vrelly_audience_search(uuid, jsonb, integer, integer, boolean, integer, uuid[]) to service_role;
