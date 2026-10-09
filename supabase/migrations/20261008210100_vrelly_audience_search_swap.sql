-- Agent Audiences, Vrelly source: data-quality fixes, part 2 of 2.
--
-- RUN OUTSIDE A TRANSACTION (psql autocommit). The CREATE INDEX CONCURRENTLY
-- statements and VACUUM refuse to run inside one; the swap in the middle is
-- its own explicit BEGIN/COMMIT so the old view, the new view and the function
-- that reads them change together. Record the ledger row after the last
-- statement succeeds.
--
-- Order: index the new view (nobody reads it yet) -> swap names and replace
-- vrelly_audience_search in one short transaction (it holds ACCESS EXCLUSIVE
-- on the two views for milliseconds; a search in flight just waits) ->
-- VACUUM ANALYZE. The function change: job titles match WHOLE WORDS
-- (~* with \m \M), it returns the cleaned first email, a US-only country
-- filter also drops emails on foreign country TLDs, and it still accepts the
-- old ILIKE title keys so an edge function deployed earlier keeps working.

create unique index concurrently if not exists prospect_audience_search_next_id_key on public.prospect_audience_search_next (id);
create index concurrently if not exists prospect_audience_search_next_title_trgm on public.prospect_audience_search_next using gin (job_title gin_trgm_ops);
create index concurrently if not exists prospect_audience_search_next_industry_trgm on public.prospect_audience_search_next using gin (company_industry gin_trgm_ops);
create index concurrently if not exists prospect_audience_search_next_department_trgm on public.prospect_audience_search_next using gin (department gin_trgm_ops);
create index concurrently if not exists prospect_audience_search_next_seniority on public.prospect_audience_search_next (seniority_l);
create index concurrently if not exists prospect_audience_search_next_size on public.prospect_audience_search_next (company_size_l);
create index concurrently if not exists prospect_audience_search_next_country on public.prospect_audience_search_next (country_l);
create index concurrently if not exists prospect_audience_search_next_state on public.prospect_audience_search_next (state_l);
create index concurrently if not exists prospect_audience_search_next_company_country on public.prospect_audience_search_next (company_country_l);
create index concurrently if not exists prospect_audience_search_next_company_state on public.prospect_audience_search_next (company_state_l);

begin;
drop materialized view public.prospect_audience_search;
alter materialized view public.prospect_audience_search_next rename to prospect_audience_search;
alter index public.prospect_audience_search_next_id_key rename to prospect_audience_search_id_key;
alter index public.prospect_audience_search_next_title_trgm rename to prospect_audience_search_title_trgm;
alter index public.prospect_audience_search_next_industry_trgm rename to prospect_audience_search_industry_trgm;
alter index public.prospect_audience_search_next_department_trgm rename to prospect_audience_search_department_trgm;
alter index public.prospect_audience_search_next_seniority rename to prospect_audience_search_seniority;
alter index public.prospect_audience_search_next_size rename to prospect_audience_search_size;
alter index public.prospect_audience_search_next_country rename to prospect_audience_search_country;
alter index public.prospect_audience_search_next_state rename to prospect_audience_search_state;
alter index public.prospect_audience_search_next_company_country rename to prospect_audience_search_company_country;
alter index public.prospect_audience_search_next_company_state rename to prospect_audience_search_company_state;
revoke all on public.prospect_audience_search from public, anon, authenticated;
comment on materialized view public.prospect_audience_search is
  'Narrow, id-ordered copy of the filterable prospects columns for Agent Audiences source=vrelly: first valid business email only, country NULL where it contradicts the state. Read by vrelly_audience_search; refreshed weekly by refresh-prospect-audience-index.';

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
  a_title text[]; a_xtitle text[]; a_title_like text[]; a_xtitle_like text[]; a_sen text[]; a_dept text[]; a_ind text[]; a_size text[];
  a_pc text[]; a_ps text[]; a_cc text[]; a_cs text[];
begin
  if p_user_id is null then
    raise exception 'vrelly_audience_search: p_user_id is required' using errcode = '22023';
  end if;

  -- jsonb list -> text[]; null/absent/empty -> null (no filter).
  for v_term in select unnest(array['title_regexes','exclude_title_regexes','title_patterns','exclude_title_patterns','seniorities','department_patterns','industry_patterns',
                                    'company_sizes','person_countries','person_states','company_countries',
                                    'company_states','keywords'])
  loop
    arr := null;
    if jsonb_typeof(p_query -> v_term) = 'array' then
      select array_agg(x) into arr from jsonb_array_elements_text(p_query -> v_term) x where btrim(x) <> '';
    end if;
    case v_term
      when 'title_regexes'          then a_title := arr;
      when 'exclude_title_regexes'  then a_xtitle := arr;
      -- Pre-20261008210000 callers (ILIKE patterns), accepted so an edge
      -- function deployed before this migration keeps working until redeployed.
      when 'title_patterns'         then a_title_like := arr;
      when 'exclude_title_patterns' then a_xtitle_like := arr;
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

  if a_title is null and a_title_like is null and a_sen is null and a_dept is null and a_ind is null and a_size is null
     and a_pc is null and a_ps is null and a_cc is null and a_cs is null and v_tsq is null
     and p_prospect_ids is null then
    raise exception 'vrelly_audience_search: at least one filter is required' using errcode = '22023';
  end if;

  -- Whole-word title match (case-insensitive regex; pg_trgm indexes ~*).
  if a_title is not null then v_where := v_where || ' and s.job_title ~* any ($1)'; end if;
  if a_title_like is not null then v_where := v_where || ' and s.job_title ilike any ($15)'; end if;
  if a_sen   is not null then v_where := v_where || ' and s.seniority_l = any ($2)'; end if;
  if a_dept  is not null then v_where := v_where || ' and s.department ilike any ($3)'; end if;
  if a_ind   is not null then v_where := v_where || ' and s.company_industry ilike any ($4)'; end if;
  if a_size  is not null then v_where := v_where || ' and s.company_size_l = any ($5)'; end if;
  if a_pc    is not null then v_where := v_where || ' and s.country_l = any ($6)'; end if;
  -- A US-only person-country filter also drops emails on non-US country TLDs
  -- (.co.uk, .ca, .de, ...; see email_foreign_cctld in 20261008210000).
  if a_pc is not null and a_pc <@ array['united states', 'us', 'usa', 'united states of america', 'u.s.', 'u.s.a.'] then
    v_where := v_where || ' and s.email_foreign_cctld is null';
  end if;
  if a_ps    is not null then v_where := v_where || ' and s.state_l = any ($7)'; end if;
  if a_cc    is not null then v_where := v_where || ' and s.company_country_l = any ($8)'; end if;
  if a_cs    is not null then v_where := v_where || ' and s.company_state_l = any ($9)'; end if;
  if p_prospect_ids is not null then v_where := v_where || ' and s.id = any ($11)'; end if;
  -- Exclusions narrow; they never count as a filter on their own (above).
  if a_xtitle is not null then v_where := v_where || ' and coalesce(s.job_title, '''') !~* all ($14)'; end if;
  if a_xtitle_like is not null then v_where := v_where || ' and coalesce(s.job_title, '''') not ilike all ($16)'; end if;

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
               page.email_key as email,
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
          select s.id, s.email_key from public.prospect_audience_search s
          where true %s
          order by s.id
          limit $12 offset $13
        ) page
        join public.prospects p on p.id = page.id
      ) r
    $q$, v_where)
    into v_people
    using a_title, a_sen, a_dept, a_ind, a_size, a_pc, a_ps, a_cc, a_cs, v_tsq, p_prospect_ids,
          least(p_limit, 500), greatest(coalesce(p_offset, 0), 0), a_xtitle, a_title_like, a_xtitle_like;
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
            null::integer, a_xtitle, a_title_like, a_xtitle_like;
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
            null::integer, a_xtitle, a_title_like, a_xtitle_like;
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
commit;

vacuum (analyze) public.prospect_audience_search;
