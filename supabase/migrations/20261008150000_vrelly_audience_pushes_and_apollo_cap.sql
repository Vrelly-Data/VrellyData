-- Agent Audiences: Vrelly source (part 1 of 2) + Apollo credit guardrails.
--
-- 1. agent_audience_pushes gets an Apollo-independent key. A Vrelly push has no
--    apollo_person_id, so it records prospects.id in prospect_id instead, and
--    apollo_person_id becomes nullable. Every push still carries at least one
--    of the two.
-- 2. "Same LinkedIn is never pushed twice" becomes a database rule, like email
--    already is: idx_agent_audience_pushes_linkedin is promoted to UNIQUE. The
--    original migration said to do this "when linkedin-keyed pushes land";
--    Vrelly rows carry a LinkedIn URL for ~94% of prospects, so that is now.
--    Prod held 0 duplicate (user_id, linkedin_key) pairs when this was written;
--    the guard below refuses to run if that is no longer true.
-- 3. filters_version is tied to source: Apollo filters are version 1, Vrelly's
--    own vocabulary is version 2 (see _shared/vrelly-audience.ts).
-- 4. Apollo guardrails. The shared APOLLO_API_KEY pays for every client without
--    their own key, so each client gets a monthly credit cap
--    (agent_configs.apollo_monthly_credit_cap, default 200), measured from
--    agent_audience_runs.credits_spent for runs that used the shared key.
--    A run that stops early says why in agent_audience_runs.reason, mirrored to
--    agent_audiences.last_run_reason for the audience card.

-- ---------------------------------------------------------------------------
-- 1. pushes: prospect_id, nullable apollo_person_id
-- ---------------------------------------------------------------------------
alter table public.agent_audience_pushes
  add column if not exists prospect_id uuid;

alter table public.agent_audience_pushes
  alter column apollo_person_id drop not null;

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.agent_audience_pushes'::regclass
                   and conname = 'agent_audience_pushes_person_key_check') then
    alter table public.agent_audience_pushes
      add constraint agent_audience_pushes_person_key_check
      check (apollo_person_id is not null or prospect_id is not null);
  end if;
end $$;

create unique index if not exists uq_agent_audience_pushes_prospect
  on public.agent_audience_pushes(user_id, prospect_id)
  where prospect_id is not null;

comment on column public.agent_audience_pushes.prospect_id is
  'prospects.id for pushes from the Vrelly source (apollo_person_id is null for those). No FK: prospects is re-imported in bulk and a push record must outlive its source row.';

-- ---------------------------------------------------------------------------
-- 2. LinkedIn dedup becomes unique
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from (
    select 1 from public.agent_audience_pushes
    where linkedin_key is not null
    group by user_id, linkedin_key having count(*) > 1
  ) d;
  if n > 0 then
    raise exception 'agent_audience_pushes has % duplicate (user_id, linkedin_key) pair(s); resolve them before making LinkedIn dedup unique', n;
  end if;
end $$;

drop index if exists public.idx_agent_audience_pushes_linkedin;
create unique index if not exists uq_agent_audience_pushes_linkedin
  on public.agent_audience_pushes(user_id, linkedin_key)
  where linkedin_key is not null;

-- ---------------------------------------------------------------------------
-- 3. filters_version follows source
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.agent_audiences'::regclass
                   and conname = 'agent_audiences_filters_version_check') then
    alter table public.agent_audiences
      add constraint agent_audiences_filters_version_check
      check ((source <> 'apollo' or filters_version = 1)
         and (source <> 'vrelly' or filters_version = 2));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Apollo guardrails
-- ---------------------------------------------------------------------------
alter table public.agent_configs
  add column if not exists apollo_monthly_credit_cap integer not null default 200;

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.agent_configs'::regclass
                   and conname = 'agent_configs_apollo_monthly_credit_cap_check') then
    alter table public.agent_configs
      add constraint agent_configs_apollo_monthly_credit_cap_check
      check (apollo_monthly_credit_cap >= 0);
  end if;
end $$;

comment on column public.agent_configs.apollo_monthly_credit_cap is
  'Most Apollo credits this client''s audience runs may spend per calendar month (UTC) on the SHARED APOLLO_API_KEY. A client''s own Apollo key is not capped. 0 disables Apollo enrichment on the shared key.';

alter table public.agent_audience_runs
  add column if not exists reason text,
  add column if not exists apollo_key_source text;

alter table public.agent_audiences
  add column if not exists last_run_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.agent_audience_runs'::regclass
                   and conname = 'agent_audience_runs_reason_check') then
    alter table public.agent_audience_runs
      add constraint agent_audience_runs_reason_check
      check (reason is null or reason in ('monthly_cap', 'apollo_insufficient_credits'));
  end if;
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.agent_audience_runs'::regclass
                   and conname = 'agent_audience_runs_apollo_key_source_check') then
    alter table public.agent_audience_runs
      add constraint agent_audience_runs_apollo_key_source_check
      check (apollo_key_source is null or apollo_key_source in ('client', 'shared'));
  end if;
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.agent_audiences'::regclass
                   and conname = 'agent_audiences_last_run_reason_check') then
    alter table public.agent_audiences
      add constraint agent_audiences_last_run_reason_check
      check (last_run_reason is null or last_run_reason in ('monthly_cap', 'apollo_insufficient_credits'));
  end if;
end $$;

-- The monthly-usage read: this user's runs since the start of the month.
-- idx_agent_audience_runs_user (user_id, started_at desc) already serves it.

-- Admin alert: clients whose audience runs were cut short by the monthly cap or
-- by Apollo running out of credits. Admin-gated like
-- admin_capture_scope_skip_alerts; non-admins get an empty list.
create or replace function public.admin_apollo_credit_alerts(p_days integer default 7)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(x order by x.last_at desc), '[]'::jsonb)
  from (
    select
      r.user_id,
      pr.name as user_name,
      r.reason,
      count(*)::int as runs,
      count(distinct r.audience_id)::int as audiences,
      sum(r.credits_spent)::int as credits_spent,
      max(r.started_at) as last_at
    from public.agent_audience_runs r
    left join public.profiles pr on pr.id = r.user_id
    where r.reason in ('monthly_cap', 'apollo_insufficient_credits')
      and r.started_at >= now() - make_interval(days => greatest(1, least(p_days, 90)))
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and (p.is_platform_admin = true or p.is_super_admin = true)
      )
    group by r.user_id, pr.name, r.reason
  ) x;
$$;

revoke all on function public.admin_apollo_credit_alerts(integer) from public, anon;
grant execute on function public.admin_apollo_credit_alerts(integer) to authenticated, service_role;
