-- Signals, phase 2: audiences built FROM signals (agent_audiences.source =
-- 'signals', filters_version 3).
--
-- A signal names a company (and sometimes a person). An audience turns it into
-- people to enrol: signal -> company -> people matching the audience's target
-- personas. The resolver (_shared/signal-resolver.ts) works cheapest first:
--   a) Vrelly prospects (free) — this file's signals_resolve_people;
--   b) the signal's own named person, when they match the persona — also here;
--   c) Apollo (paid) — only for companies a) and b) found nobody at; edge code.
--
-- VISIBILITY. Every function here runs as SECURITY DEFINER for the service
-- role (the edge functions pass the caller's user id, as vrelly_audience_search
-- does) and re-applies the signals RLS rule for THAT user: admins see
-- everything, everyone else sees 'all_clients' plus 'team' signals of their own
-- teams. A client can therefore neither list nor resolve an admin-only
-- (private-equity) signal or another team's web visitor, even by naming its id.
--
-- Part 2 (20261013120100) builds the two prospects indexes the company match
-- uses, CONCURRENTLY, outside a transaction.

-- ---------------------------------------------------------------- keys ---

-- Same rule as normalizeDomain in _shared/signals.ts (signals.company_domain is
-- already stored that way), applied to prospects.company_domain.
create or replace function public.signals_domain_key(p text)
returns text
language sql immutable parallel safe
as $$
  select nullif(
    regexp_replace(
      split_part(split_part(split_part(
        regexp_replace(regexp_replace(lower(btrim(coalesce(p, ''))), '^[a-z][a-z0-9+.-]*://', ''), '^www\.', ''),
        '/', 1), '?', 1), ':', 1),
      '\.$', ''),
    '');
$$;

-- "Arthrex, Inc." / "ARTHREX INC" / "Arthrex" -> 'arthrex'. Lower-case, '&' as
-- 'and', punctuation to spaces, trailing legal suffixes dropped (repeatedly:
-- "SE & Co. KG"). Keys shorter than 3 characters are null: they match noise.
create or replace function public.signals_company_name_key(p text)
returns text
language sql immutable parallel safe
as $$
  select case when length(k) >= 3 then k end
  from (
    select btrim(regexp_replace(
      btrim(regexp_replace(replace(lower(coalesce(p, '')), '&', ' and '), '[^a-z0-9]+', ' ', 'g')),
      '( (inc|incorporated|llc|l l c|ltd|limited|corp|corporation|co|company|plc|lp|llp|pllc|pc|gmbh|ag|sa|s a|bv|b v|nv|kg|se|srl|spa|pty|and co))+$',
      '')) as k
  ) x;
$$;

-- A state as every spelling prospects store: {'tx','texas'} for 'TX' or 'Texas'.
create or replace function public.signals_state_keys(p text)
returns text[]
language sql immutable parallel safe
as $$
  with m(code, name) as (values
    ('al','alabama'),('ak','alaska'),('az','arizona'),('ar','arkansas'),('ca','california'),('co','colorado'),
    ('ct','connecticut'),('de','delaware'),('dc','district of columbia'),('fl','florida'),('ga','georgia'),
    ('hi','hawaii'),('id','idaho'),('il','illinois'),('in','indiana'),('ia','iowa'),('ks','kansas'),('ky','kentucky'),
    ('la','louisiana'),('me','maine'),('md','maryland'),('ma','massachusetts'),('mi','michigan'),('mn','minnesota'),
    ('ms','mississippi'),('mo','missouri'),('mt','montana'),('ne','nebraska'),('nv','nevada'),('nh','new hampshire'),
    ('nj','new jersey'),('nm','new mexico'),('ny','new york'),('nc','north carolina'),('nd','north dakota'),
    ('oh','ohio'),('ok','oklahoma'),('or','oregon'),('pa','pennsylvania'),('pr','puerto rico'),('ri','rhode island'),
    ('sc','south carolina'),('sd','south dakota'),('tn','tennessee'),('tx','texas'),('ut','utah'),('vt','vermont'),
    ('va','virginia'),('wa','washington'),('wv','west virginia'),('wi','wisconsin'),('wy','wyoming'))
  select case when nullif(btrim(coalesce(p, '')), '') is null then null
    else coalesce(
      (select array[m.code, m.name] from m where m.code = lower(btrim(p)) or m.name = lower(btrim(p)) limit 1),
      array[lower(btrim(p))]) end;
$$;

-- -------------------------------------------------------------- source ---

alter table public.agent_audiences drop constraint if exists agent_audiences_source_check;
alter table public.agent_audiences add constraint agent_audiences_source_check
  check (source in ('apollo', 'vrelly', 'signals', 'clay', 'ai'));

alter table public.agent_audiences drop constraint if exists agent_audiences_filters_version_check;
alter table public.agent_audiences add constraint agent_audiences_filters_version_check
  check ((source <> 'apollo' or filters_version = 1)
     and (source <> 'vrelly' or filters_version = 2)
     and (source <> 'signals' or filters_version = 3));

-- -------------------------------------------------------------- tables ---

-- Which signals an audience has already consumed, so a run only collects
-- signals "not yet used by this audience". A signal is recorded once its
-- people were pushed or it was found to have nobody to push; a signal skipped
-- for a budget stop or the run's allowance is NOT recorded and comes back next
-- run.
create table if not exists public.agent_audience_signals (
  audience_id   uuid not null references public.agent_audiences(id) on delete cascade,
  signal_id     uuid not null references public.signals(id) on delete cascade,
  user_id       uuid not null,
  run_id        uuid references public.agent_audience_runs(id) on delete set null,
  outcome       text not null check (outcome in ('pushed', 'no_people', 'all_duplicates', 'failed')),
  people_found  integer not null default 0,
  people_pushed integer not null default 0,
  used_at       timestamptz not null default now(),
  primary key (audience_id, signal_id)
);
create index if not exists idx_agent_audience_signals_user on public.agent_audience_signals (user_id, used_at desc);

-- Company -> people, as resolved. Read back before any Apollo call so the same
-- company is never paid for twice. SCOPED PER USER for the reason
-- apollo_enrichment_cache is (20260830120000): Apollo data is bought with a
-- particular account's credits and is that tenant's data. company_key is
-- 'd:<domain>' or 'n:<name key>|<state>'.
create table if not exists public.signal_contacts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null,
  company_key      text not null,
  signal_id        uuid references public.signals(id) on delete set null,
  source           text not null check (source in ('vrelly', 'signal', 'apollo')),
  prospect_id      uuid,
  apollo_person_id text,
  email            text,
  linkedin         text,
  first_name       text,
  last_name        text,
  title            text,
  company_name     text,
  company_domain   text,
  city             text,
  state            text,
  country          text,
  resolved_at      timestamptz not null default now(),
  person_key       text generated always as (coalesce('p:' || prospect_id::text, 'a:' || apollo_person_id, 'e:' || lower(email))) stored,
  constraint signal_contacts_has_identity check (prospect_id is not null or apollo_person_id is not null or email is not null)
);
create unique index if not exists uq_signal_contacts_person on public.signal_contacts (user_id, company_key, person_key);
create index if not exists idx_signal_contacts_signal on public.signal_contacts (signal_id);

-- One row per (user, company) the Apollo fallback has searched: a company
-- where Apollo found nobody matching is not searched again for 30 days.
create table if not exists public.signal_company_lookups (
  user_id           uuid not null,
  company_key       text not null,
  domain            text,
  apollo_searched_at timestamptz,
  apollo_candidates integer not null default 0,
  apollo_enriched   integer not null default 0,
  updated_at        timestamptz not null default now(),
  primary key (user_id, company_key)
);

alter table public.agent_audience_signals enable row level security;
alter table public.signal_contacts enable row level security;
alter table public.signal_company_lookups enable row level security;
revoke all on public.agent_audience_signals, public.signal_contacts, public.signal_company_lookups from anon, authenticated;
grant select on public.agent_audience_signals, public.signal_contacts to authenticated;
grant all on public.agent_audience_signals, public.signal_contacts, public.signal_company_lookups to service_role;

drop policy if exists "agent_audience_signals: own" on public.agent_audience_signals;
create policy "agent_audience_signals: own" on public.agent_audience_signals
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "signal_contacts: own" on public.signal_contacts;
create policy "signal_contacts: own" on public.signal_contacts
  for select to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------- visibility ---

-- The signals RLS rule, for a user id passed by the service role.
create or replace function public.signals_visible_to(p_user_id uuid, p_visibility text, p_team_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_user_id is not null and (
    p_visibility = 'all_clients'
    or (p_visibility = 'team' and exists (
          select 1 from public.team_memberships m where m.user_id = p_user_id and m.team_id = p_team_id))
    or coalesce((select pr.is_platform_admin from public.profiles pr where pr.id = p_user_id), false));
$$;
revoke all on function public.signals_visible_to(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.signals_visible_to(uuid, text, uuid) to service_role;

-- ---------------------------------------------------------- candidates ---

-- Signals an audience could use, best first (score, then newest).
--
-- p_query is compiled by _shared/signal-audience.ts:
--   verticals, signal_types       text[]   any of (null = all visible)
--   since                         timestamptz
--   min_score                     int
--   fda_product_codes             text[]   upper-case, medical_device only
--   fda_device_regexes            text[]   whole-word, on payload.device_name
--   fda_state_keys                text[]   signals_state_keys spellings
--   hiring_role_regexes           text[]   whole-word, on payload.job_title
--   github_topics                 text[]   lower-case, overlap with payload.topics
-- Per-vertical filters only constrain signals of that vertical.
--
-- p_signal_ids: an explicit selection (Signals -> "Build audience from these").
-- Only visibility, "not yet used by this audience" and dismissal apply to it —
-- the operator picked those signals by hand.
create or replace function public.signals_audience_candidates(
  p_user_id uuid,
  p_query jsonb,
  p_audience_id uuid default null,
  p_signal_ids uuid[] default null,
  p_limit integer default 25,
  p_offset integer default 0,
  p_count boolean default false
)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_admin boolean;
  v_teams uuid[];
  v_team uuid;
  v_vert text[]; v_types text[]; v_codes text[]; v_dev text[]; v_states text[]; v_roles text[]; v_topics text[];
  v_since timestamptz;
  v_min integer;
  v_rows jsonb;
  v_total bigint;
begin
  if p_user_id is null then
    raise exception 'signals_audience_candidates: p_user_id is required' using errcode = '22023';
  end if;
  v_admin := coalesce((select pr.is_platform_admin from public.profiles pr where pr.id = p_user_id), false);
  v_teams := array(select m.team_id from public.team_memberships m where m.user_id = p_user_id);
  v_team := (select m.team_id from public.team_memberships m where m.user_id = p_user_id order by m.created_at limit 1);

  select array_agg(x) into v_vert from jsonb_array_elements_text(case when jsonb_typeof(p_query -> 'verticals') = 'array' then p_query -> 'verticals' else '[]' end) x where btrim(x) <> '';
  select array_agg(x) into v_types from jsonb_array_elements_text(case when jsonb_typeof(p_query -> 'signal_types') = 'array' then p_query -> 'signal_types' else '[]' end) x where btrim(x) <> '';
  select array_agg(x) into v_codes from jsonb_array_elements_text(case when jsonb_typeof(p_query -> 'fda_product_codes') = 'array' then p_query -> 'fda_product_codes' else '[]' end) x where btrim(x) <> '';
  select array_agg(x) into v_dev from jsonb_array_elements_text(case when jsonb_typeof(p_query -> 'fda_device_regexes') = 'array' then p_query -> 'fda_device_regexes' else '[]' end) x where btrim(x) <> '';
  select array_agg(x) into v_states from jsonb_array_elements_text(case when jsonb_typeof(p_query -> 'fda_state_keys') = 'array' then p_query -> 'fda_state_keys' else '[]' end) x where btrim(x) <> '';
  select array_agg(x) into v_roles from jsonb_array_elements_text(case when jsonb_typeof(p_query -> 'hiring_role_regexes') = 'array' then p_query -> 'hiring_role_regexes' else '[]' end) x where btrim(x) <> '';
  select array_agg(x) into v_topics from jsonb_array_elements_text(case when jsonb_typeof(p_query -> 'github_topics') = 'array' then p_query -> 'github_topics' else '[]' end) x where btrim(x) <> '';
  v_since := coalesce((p_query ->> 'since')::timestamptz, now() - interval '30 days');
  v_min := coalesce((p_query ->> 'min_score')::integer, 0);

  with base as (
    select s.*
      from public.signals s
     where (v_admin or s.visibility = 'all_clients' or (s.visibility = 'team' and s.team_id = any(v_teams)))
       and (p_audience_id is null or not exists (
             select 1 from public.agent_audience_signals u where u.audience_id = p_audience_id and u.signal_id = s.id))
       and (v_team is null or not exists (
             select 1 from public.signal_team_status st
              where st.signal_id = s.id and st.team_id = v_team and st.status = 'dismissed'))
       and (
         case when p_signal_ids is not null then s.id = any(p_signal_ids)
         else
               s.occurred_at >= v_since
           and s.score >= v_min
           and (v_vert is null or s.vertical = any(v_vert))
           and (v_types is null or s.signal_type = any(v_types))
           and (s.vertical <> 'medical_device' or (
                 (v_codes is null or upper(s.payload ->> 'product_code') = any(v_codes))
             and (v_dev is null or coalesce(s.payload ->> 'device_name', '') ~* any(v_dev))
             and (v_states is null or lower(btrim(s.state)) = any(v_states))))
           and (s.vertical <> 'saas_hiring' or v_roles is null or coalesce(s.payload ->> 'job_title', '') ~* any(v_roles))
           and (s.vertical <> 'github' or v_topics is null or exists (
                 select 1 from jsonb_array_elements_text(case when jsonb_typeof(s.payload -> 'topics') = 'array' then s.payload -> 'topics' else '[]' end) t
                  where lower(t) = any(v_topics)))
         end)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id, 'source_key', b.source_key, 'vertical', b.vertical, 'signal_type', b.signal_type,
           'occurred_at', b.occurred_at, 'title', b.title, 'url', b.url, 'score', b.score,
           'company_name', b.company_name, 'company_domain', b.company_domain,
           'person_name', b.person_name, 'person_title', b.person_title,
           'has_person_email', b.person_email is not null,
           'city', b.city, 'state', b.state, 'country', b.country,
           'payload', b.payload)
         order by b.score desc, b.occurred_at desc, b.id), '[]'::jsonb)
    into v_rows
    from (select * from base order by score desc, occurred_at desc, id
          limit greatest(0, least(coalesce(p_limit, 25), 500)) offset greatest(0, coalesce(p_offset, 0))) b;

  if p_count then
    -- Counted over the same rule; signals are few (thousands), so exact.
    select count(*) into v_total
      from public.signals s
     where (v_admin or s.visibility = 'all_clients' or (s.visibility = 'team' and s.team_id = any(v_teams)))
       and (p_audience_id is null or not exists (
             select 1 from public.agent_audience_signals u where u.audience_id = p_audience_id and u.signal_id = s.id))
       and (v_team is null or not exists (
             select 1 from public.signal_team_status st
              where st.signal_id = s.id and st.team_id = v_team and st.status = 'dismissed'))
       and (
         case when p_signal_ids is not null then s.id = any(p_signal_ids)
         else
               s.occurred_at >= v_since
           and s.score >= v_min
           and (v_vert is null or s.vertical = any(v_vert))
           and (v_types is null or s.signal_type = any(v_types))
           and (s.vertical <> 'medical_device' or (
                 (v_codes is null or upper(s.payload ->> 'product_code') = any(v_codes))
             and (v_dev is null or coalesce(s.payload ->> 'device_name', '') ~* any(v_dev))
             and (v_states is null or lower(btrim(s.state)) = any(v_states))))
           and (s.vertical <> 'saas_hiring' or v_roles is null or coalesce(s.payload ->> 'job_title', '') ~* any(v_roles))
           and (s.vertical <> 'github' or v_topics is null or exists (
                 select 1 from jsonb_array_elements_text(case when jsonb_typeof(s.payload -> 'topics') = 'array' then s.payload -> 'topics' else '[]' end) t
                  where lower(t) = any(v_topics)))
         end);
  end if;

  return jsonb_build_object('signals', v_rows, 'total', v_total);
end
$$;
revoke all on function public.signals_audience_candidates(uuid, jsonb, uuid, uuid[], integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.signals_audience_candidates(uuid, jsonb, uuid, uuid[], integer, integer, boolean) to service_role;

-- ------------------------------------------------------ free resolution ---

-- Steps a) and b) of the resolver, for a batch of signals, in one call.
--
-- a) VRELLY PROSPECTS at the signal's company: normalized company_domain, or —
--    when the signal has no domain — normalized company name AND state (the
--    company's or the person's). A domain-less signal also gets a DERIVED
--    domain: the most common domain among those name+state matches, which the
--    Apollo fallback then uses. Every #107 guard applies, because people are
--    read through prospect_audience_search: first valid email only, the
--    email's domain equals the prospect's company domain; plus, when the
--    signal's company domain is known, the email's domain must be that domain
--    (or a subdomain). p_us_only adds the US rules: no email on a foreign
--    country TLD, and no person whose country is non-US or whose "US" country
--    contradicts a non-US state.
-- b) THE SIGNAL'S OWN NAMED PERSON: with an email on the signal, or found by
--    full name among the company's prospects. Used only when their known title
--    matches the persona's job titles (a person whose title is unknown cannot
--    be shown to match, so is not used).
--
-- Persona (compiled by _shared/signal-audience.ts): title_regexes,
-- exclude_title_regexes (whole words, ~*), seniorities (stored values),
-- department_patterns (ILIKE). At most p_per_company people per signal, the
-- named person first, then by seniority.
--
-- Everyone this user already pushed, already has as a lead, or has as a synced
-- contact of their teams is excluded (email and LinkedIn), exactly as
-- vrelly_audience_search does. Signals the user may not see are dropped and
-- counted in 'refused'.
create or replace function public.signals_resolve_people(
  p_user_id uuid,
  p_signal_ids uuid[],
  p_persona jsonb,
  p_per_company integer default 2,
  p_us_only boolean default true
)
returns jsonb
language plpgsql security definer set search_path = public
set work_mem = '64MB'
as $$
declare
  v_admin boolean;
  v_teams uuid[];
  v_title text[]; v_xtitle text[]; v_sen text[]; v_dept text[];
  v_n integer := greatest(1, least(coalesce(p_per_company, 2), 10));
  v_us text[] := array['united states', 'us', 'usa', 'united states of america', 'u.s.', 'u.s.a.'];
  v_out jsonb;
  v_refused integer;
begin
  if p_user_id is null then
    raise exception 'signals_resolve_people: p_user_id is required' using errcode = '22023';
  end if;
  if coalesce(array_length(p_signal_ids, 1), 0) > 200 then
    raise exception 'signals_resolve_people: at most 200 signals per call' using errcode = '22023';
  end if;
  v_admin := coalesce((select pr.is_platform_admin from public.profiles pr where pr.id = p_user_id), false);
  v_teams := array(select m.team_id from public.team_memberships m where m.user_id = p_user_id);

  select array_agg(x) into v_title from jsonb_array_elements_text(case when jsonb_typeof(p_persona -> 'title_regexes') = 'array' then p_persona -> 'title_regexes' else '[]' end) x where btrim(x) <> '';
  select array_agg(x) into v_xtitle from jsonb_array_elements_text(case when jsonb_typeof(p_persona -> 'exclude_title_regexes') = 'array' then p_persona -> 'exclude_title_regexes' else '[]' end) x where btrim(x) <> '';
  select array_agg(x) into v_sen from jsonb_array_elements_text(case when jsonb_typeof(p_persona -> 'seniorities') = 'array' then p_persona -> 'seniorities' else '[]' end) x where btrim(x) <> '';
  select array_agg(x) into v_dept from jsonb_array_elements_text(case when jsonb_typeof(p_persona -> 'department_patterns') = 'array' then p_persona -> 'department_patterns' else '[]' end) x where btrim(x) <> '';
  if v_title is null and v_sen is null and v_dept is null then
    raise exception 'A target persona (job titles, seniority or department) is required' using errcode = '22023';
  end if;

  -- Exclusion keys for this user, once per call (as vrelly_audience_search).
  create temp table if not exists _srp_ex_email (k text primary key) on commit drop;
  create temp table if not exists _srp_ex_li (k text primary key) on commit drop;
  truncate _srp_ex_email, _srp_ex_li;
  insert into _srp_ex_email (k)
  select distinct k from (
    select ap.email_key as k from public.agent_audience_pushes ap where ap.user_id = p_user_id
    union all select lower(btrim(l.email)) from public.agent_leads l where l.user_id = p_user_id
    union all select lower(btrim(l.email_address)) from public.agent_leads l where l.user_id = p_user_id
    union all select lower(btrim(sc.email)) from public.synced_contacts sc where sc.team_id = any(v_teams)
  ) e where k is not null and k <> '';
  insert into _srp_ex_li (k)
  select distinct k from (
    select ap.linkedin_key as k from public.agent_audience_pushes ap where ap.user_id = p_user_id
    union all select public.audience_linkedin_key(l.linkedin_url) from public.agent_leads l where l.user_id = p_user_id
    union all select public.audience_linkedin_key(sc.linkedin_url) from public.synced_contacts sc where sc.team_id = any(v_teams)
  ) e where k is not null and k <> '';

  select count(*) into v_refused
    from unnest(p_signal_ids) i(id)
   where not exists (
     select 1 from public.signals s where s.id = i.id
        and (v_admin or s.visibility = 'all_clients' or (s.visibility = 'team' and s.team_id = any(v_teams))));

  with sig as (
    select s.id, s.company_name, s.company_domain as domain,
           public.signals_company_name_key(s.company_name) as name_key,
           public.signals_state_keys(s.state) as state_keys,
           nullif(btrim(s.person_name), '') as person_name,
           nullif(btrim(s.person_title), '') as person_title,
           lower(nullif(btrim(s.person_email), '')) as person_email,
           nullif(btrim(s.person_linkedin), '') as person_linkedin,
           s.city, s.state, s.country
      from public.signals s
     where s.id = any(p_signal_ids)
       and (v_admin or s.visibility = 'all_clients' or (s.visibility = 'team' and s.team_id = any(v_teams)))
  ),
  -- Domain-less signals: name + state matches, and the domain they point at.
  by_name as (
    select sg.id as signal_id, p.id as prospect_id, public.signals_domain_key(p.company_domain) as dkey
      from sig sg
      join public.prospects p on public.signals_company_name_key(p.company_name) = sg.name_key
     where sg.domain is null and sg.name_key is not null and sg.state_keys is not null
       and (lower(btrim(p.company_state)) = any(sg.state_keys) or lower(btrim(p.state)) = any(sg.state_keys))
  ),
  derived as (
    select signal_id, mode() within group (order by dkey) as dkey
      from by_name
     where dkey is not null
       -- a mailbox or social domain says nothing about the company
       and dkey not in ('gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com',
                        'live.com', 'msn.com', 'linkedin.com', 'facebook.com', 'google.com')
     group by signal_id
  ),
  sig2 as (
    select sg.*, d.dkey as derived_domain, coalesce(sg.domain, d.dkey) as match_domain,
           case when coalesce(sg.domain, d.dkey) is not null then 'd:' || coalesce(sg.domain, d.dkey)
                when sg.name_key is not null and sg.state_keys is not null then 'n:' || sg.name_key || '|' || sg.state_keys[1]
           end as company_key
      from sig sg left join derived d on d.signal_id = sg.id
  ),
  cand as (
    select sg.id as signal_id, p.id as prospect_id, 'domain'::text as how
      from sig2 sg
      join public.prospects p on public.signals_domain_key(p.company_domain) = sg.match_domain
     where sg.match_domain is not null
    union
    select bn.signal_id, bn.prospect_id, 'name_state' from by_name bn
  ),
  people as (
    select c.signal_id, c.how, p.id as prospect_id, s.email_key as email,
           nullif(btrim(p.first_name), '') as first_name, nullif(btrim(p.last_name), '') as last_name,
           nullif(btrim(p.job_title), '') as title, nullif(btrim(p.seniority), '') as seniority,
           nullif(btrim(p.department), '') as department,
           nullif(btrim(p.company_name), '') as company_name, nullif(btrim(p.company_domain), '') as company_domain,
           nullif(btrim(p.linkedin_url), '') as linkedin_url,
           nullif(btrim(p.city), '') as city, nullif(btrim(p.state), '') as state, nullif(btrim(p.country), '') as country,
           s.seniority_l,
           (sg.person_name is not null
             and lower(regexp_replace(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '\s+', ' ', 'g'))
               = lower(regexp_replace(sg.person_name, '\s+', ' ', 'g'))) as is_named
      from cand c
      join sig2 sg on sg.id = c.signal_id
      join public.prospects p on p.id = c.prospect_id
      join public.prospect_audience_search s on s.id = c.prospect_id
     where (sg.match_domain is null
            or split_part(s.email_key, '@', 2) = sg.match_domain
            or split_part(s.email_key, '@', 2) like '%.' || sg.match_domain)
       and (not p_us_only or (
             s.email_foreign_cctld is null
         and (s.country_l is null or s.country_l = any(v_us))
         and not (lower(btrim(p.country)) = any(v_us) and nullif(btrim(p.state), '') is not null
                  and not public.audience_is_us_state(p.state))))
       and not exists (select 1 from _srp_ex_email e where e.k = s.email_key)
       and (s.linkedin_key is null or not exists (select 1 from _srp_ex_li l where l.k = s.linkedin_key))
  ),
  persona_ok as (
    select pe.*,
           case when pe.is_named then 'signal' else 'vrelly' end as source
      from people pe
     where (v_xtitle is null or coalesce(pe.title, '') !~* all (v_xtitle))
       and (
         -- the named person: their title must match the persona's titles
         (pe.is_named and v_title is not null and coalesce(pe.title, '') ~* any (v_title))
         or (
               (v_title is null or coalesce(pe.title, '') ~* any (v_title))
           and (v_sen is null or pe.seniority_l = any (v_sen))
           and (v_dept is null or coalesce(pe.department, '') ilike any (v_dept))))
  ),
  -- b) a named person with an email ON the signal (a resolved visitor, etc).
  sig_person as (
    select sg.id as signal_id, 'signal'::text as source, null::uuid as prospect_id, sg.person_email as email,
           split_part(sg.person_name, ' ', 1) as first_name,
           nullif(btrim(substr(sg.person_name, length(split_part(sg.person_name, ' ', 1)) + 1)), '') as last_name,
           sg.person_title as title, null::text as seniority, null::text as department,
           sg.company_name, sg.domain as company_domain, sg.person_linkedin as linkedin_url,
           sg.city, sg.state, sg.country, 0 as rank_key
      from sig2 sg
     where sg.person_email ~ '^[^@[:space:],;]+@[^@[:space:],;]+\.[a-z]{2,}$'
       and v_title is not null
       and coalesce(sg.person_title, '') ~* any (v_title)
       and (v_xtitle is null or coalesce(sg.person_title, '') !~* all (v_xtitle))
       and (not p_us_only or substring(split_part(sg.person_email, '@', 2) from '\.([a-z]{2})$') is null
            or substring(split_part(sg.person_email, '@', 2) from '\.([a-z]{2})$') = any (array[
              'us', 'io', 'co', 'ai', 'me', 'tv', 'ly', 'so', 'fm', 'gg', 'sh', 'cc', 'to', 'ws', 'la', 'vc']))
       and not exists (select 1 from _srp_ex_email e where e.k = sg.person_email)
       and (sg.person_linkedin is null or not exists (
             select 1 from _srp_ex_li l where l.k = public.audience_linkedin_key(sg.person_linkedin)))
  ),
  merged as (
    select signal_id, source, prospect_id, email, first_name, last_name, title, seniority, department,
           company_name, company_domain, linkedin_url, city, state, country, rank_key
      from sig_person
    union all
    select signal_id, source, prospect_id, email, first_name, last_name, title, seniority, department,
           company_name, company_domain, linkedin_url, city, state, country,
           case when source = 'signal' then 0
                else case seniority_l when 'cxo' then 1 when 'c suite' then 1 when 'vp' then 2 when 'head' then 3
                                      when 'director' then 4 when 'manager' then 5 when 'senior' then 6 else 7 end
           end
      from persona_ok
  ),
  ranked as (
    select m.*, row_number() over (partition by m.signal_id order by m.rank_key, m.email) as rn
      from (select distinct on (signal_id, email) * from merged order by signal_id, email, rank_key) m
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'signal_id', sg.id,
           'company_key', sg.company_key,
           'domain', sg.domain,
           'derived_domain', case when sg.domain is null then sg.derived_domain end,
           'people', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'source', r.source, 'prospect_id', r.prospect_id, 'email', r.email,
                      'first_name', r.first_name, 'last_name', r.last_name, 'title', r.title,
                      'seniority', r.seniority, 'department', r.department,
                      'company_name', coalesce(r.company_name, sg.company_name),
                      'company_domain', coalesce(r.company_domain, sg.match_domain),
                      'linkedin_url', r.linkedin_url, 'city', r.city, 'state', r.state, 'country', r.country)
                    order by r.rn)
               from ranked r where r.signal_id = sg.id and r.rn <= v_n), '[]'::jsonb))), '[]'::jsonb)
    into v_out
    from sig2 sg;

  return jsonb_build_object('signals', v_out, 'refused', v_refused);
end
$$;
revoke all on function public.signals_resolve_people(uuid, uuid[], jsonb, integer, boolean) from public, anon, authenticated;
grant execute on function public.signals_resolve_people(uuid, uuid[], jsonb, integer, boolean) to service_role;

-- Which of these emails / LinkedIn keys this user may NOT be sent: already
-- pushed, already a lead, or a synced contact of their teams. For people the
-- Apollo fallback bought, whose email was unknown until enrichment.
create or replace function public.audience_known_contacts(p_user_id uuid, p_emails text[], p_linkedin_keys text[])
returns jsonb
language sql stable security definer set search_path = public
as $$
  with teams as (select m.team_id from public.team_memberships m where m.user_id = p_user_id),
  e as (select distinct lower(btrim(x)) as k from unnest(coalesce(p_emails, '{}')) x where nullif(btrim(x), '') is not null),
  l as (select distinct x as k from unnest(coalesce(p_linkedin_keys, '{}')) x where nullif(btrim(x), '') is not null)
  select jsonb_build_object(
    'emails', coalesce((select jsonb_agg(e.k) from e where
        exists (select 1 from public.agent_audience_pushes ap where ap.user_id = p_user_id and ap.email_key = e.k)
     or exists (select 1 from public.agent_leads al where al.user_id = p_user_id and (lower(btrim(al.email)) = e.k or lower(btrim(al.email_address)) = e.k))
     or exists (select 1 from public.synced_contacts sc where lower(btrim(sc.email)) = e.k and sc.team_id in (select team_id from teams))), '[]'::jsonb),
    'linkedin_keys', coalesce((select jsonb_agg(l.k) from l where
        exists (select 1 from public.agent_audience_pushes ap where ap.user_id = p_user_id and ap.linkedin_key = l.k)
     or exists (select 1 from public.agent_leads al where al.user_id = p_user_id and public.audience_linkedin_key(al.linkedin_url) = l.k)
     or exists (select 1 from public.synced_contacts sc where sc.team_id in (select team_id from teams) and public.audience_linkedin_key(sc.linkedin_url) = l.k)), '[]'::jsonb));
$$;
revoke all on function public.audience_known_contacts(uuid, text[], text[]) from public, anon, authenticated;
grant execute on function public.audience_known_contacts(uuid, text[], text[]) to service_role;

-- --------------------------------------------------------- after a push ---

-- Record which signals a run consumed and mark pushed ones 'pushed' for the
-- user's team (their first team, as signals_set_status uses). p_rows:
-- [{signal_id, outcome, people_found, people_pushed}]. Signals the user may
-- not see are ignored.
create or replace function public.signals_mark_audience_used(
  p_user_id uuid, p_audience_id uuid, p_run_id uuid, p_rows jsonb
)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_team uuid := (select m.team_id from public.team_memberships m where m.user_id = p_user_id order by m.created_at limit 1);
  v_n integer;
begin
  if not exists (select 1 from public.agent_audiences a where a.id = p_audience_id and a.user_id = p_user_id) then
    raise exception 'audience not found for this user' using errcode = '42501';
  end if;

  insert into public.agent_audience_signals (audience_id, signal_id, user_id, run_id, outcome, people_found, people_pushed)
  select p_audience_id, s.id, p_user_id, p_run_id, r.outcome, coalesce(r.people_found, 0), coalesce(r.people_pushed, 0)
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(signal_id uuid, outcome text, people_found integer, people_pushed integer)
    join public.signals s on s.id = r.signal_id
   where public.signals_visible_to(p_user_id, s.visibility, s.team_id)
  on conflict (audience_id, signal_id) do update
    set run_id = excluded.run_id, outcome = excluded.outcome, people_found = excluded.people_found,
        people_pushed = public.agent_audience_signals.people_pushed + excluded.people_pushed, used_at = now();
  get diagnostics v_n = row_count;

  if v_team is not null then
    insert into public.signal_team_status (signal_id, team_id, status, updated_by, updated_at)
    select s.id, v_team, 'pushed', p_user_id, now()
      from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(signal_id uuid, people_pushed integer)
      join public.signals s on s.id = r.signal_id
     where coalesce(r.people_pushed, 0) > 0
       and public.signals_visible_to(p_user_id, s.visibility, s.team_id)
    on conflict (signal_id, team_id) do update
      set status = 'pushed', updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  end if;
  return v_n;
end
$$;
revoke all on function public.signals_mark_audience_used(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.signals_mark_audience_used(uuid, uuid, uuid, jsonb) to service_role;
