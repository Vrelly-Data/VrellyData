-- Inference auto-enrichment: every new reply in inference_events gets the same
-- data the backfill rows carry, written under the SAME keys, so the Inference
-- tab reads it with no changes.
--
-- WHAT RUNS: enrich-inference-events (edge function), every 5 min via pg_cron.
-- The job is created DISABLED; enable it with
--   select cron.alter_job((select jobid from cron.job where jobname = 'enrich-inference-events-5min'), active := true);
-- Turn it off again with active := false, or set the edge secret
-- ENRICH_ENABLED=false (the function then returns without doing anything).
--
-- WHICH ROWS: event_type replied/classified, source NOT like '%_backfill',
-- not flagged metadata.backfill, metadata.enriched_at missing, within the last
-- 30 days. Interested first, Not-interested last, newest first. The intent of a
-- 'replied' row is on the newest 'classified' row of the same team + person.
--
-- WHAT IS WRITTEN (on the row itself):
--   metadata — the backfill's keys (sequence_step_number, step_source,
--     variant_id, variant_match, emails_before_reply, platform_category,
--     sent_at, replied_at, hours_to_reply, send/reply_hour_et, send/reply_dow_et,
--     time_zone, tz_effective, tz_basis, headline, employees, revenue,
--     founded_year, company_domain, company_linkedin, company_keywords,
--     apollo_matched) plus enriched_at, enrichment_version = 1. Keys already on
--     the row are never overwritten.
--   columns — job_title, seniority, department, industry, company_size, city,
--     linkedin_url, campaign_external_id, campaign_name, subject,
--     copy_fingerprint: only when empty. country/state: the normalized value
--     ("USA" → "United States", "TX" → "Texas"), from the row's own value
--     first.
--   failures — enrichment_attempts / enrichment_next_at (backoff 5, 10, 20,
--     40 min); after 5 failures enrichment_status = 'failed' (not retried).
--
-- Every step of every row is logged in inference_enrichment_log; Apollo rows
-- carry the credits spent, which is what the daily cap (APOLLO_DAILY_CAP,
-- default 300) and the admin health card read.

-- ------------------------------------------------------------------ index ---
-- The queue's scan. Small table (~85k rows): a plain build takes well under a
-- second, so no CONCURRENTLY (which cannot run inside a migration transaction).
create index if not exists idx_inference_events_unenriched
  on public.inference_events (occurred_at desc)
  where (metadata ->> 'enriched_at') is null and source not like '%_backfill';

-- -------------------------------------------------------------------- log ---
create table if not exists public.inference_enrichment_log (
  id bigserial primary key,
  event_id uuid,
  step text not null,
  status text not null,
  error text,
  credits integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_inference_enrichment_log_time on public.inference_enrichment_log (created_at desc);
create index if not exists idx_inference_enrichment_log_event on public.inference_enrichment_log (event_id);
create index if not exists idx_inference_enrichment_log_apollo
  on public.inference_enrichment_log (created_at) where step = 'apollo' and credits > 0;

alter table public.inference_enrichment_log enable row level security;
drop policy if exists "Platform admins can read the enrichment log" on public.inference_enrichment_log;
create policy "Platform admins can read the enrichment log" on public.inference_enrichment_log
  for select to authenticated
  using (exists (select 1 from public.profiles p
                  where p.id = auth.uid() and (p.is_platform_admin = true or p.is_super_admin = true)));
revoke all on public.inference_enrichment_log from anon, authenticated;
grant select on public.inference_enrichment_log to authenticated;

-- ------------------------------------------------------------------ queue ---
-- p_ids: enrich exactly these rows (manual test runs); the queue filters are
-- then skipped except the source / event_type guard.
create or replace function public.inference_enrich_queue(p_limit integer default 200, p_days integer default 30, p_ids uuid[] default null)
returns table (
  id uuid, team_id uuid, source text, event_type text, channel text, person_key text, email text, linkedin_url text,
  full_name text, company_name text, job_title text, seniority text, department text, industry text, city text,
  state text, country text, company_size text, campaign_external_id text, campaign_name text, subject text,
  copy_fingerprint text, occurred_at timestamptz, metadata jsonb, intent text, priority integer
)
language sql stable security definer set search_path = public
set statement_timeout = '30s'
as $$
  select e.id, e.team_id, e.source, e.event_type, e.channel, e.person_key, e.email, e.linkedin_url, e.full_name,
         e.company_name, e.job_title, e.seniority, e.department, e.industry, e.city, e.state, e.country, e.company_size,
         e.campaign_external_id, e.campaign_name, e.subject, e.copy_fingerprint, e.occurred_at, e.metadata,
         coalesce(e.intent, ci.intent) as intent,
         case coalesce(e.intent, ci.intent) when 'interested' then 0 when 'not_interested' then 2 else 1 end as priority
    from public.inference_events e
    left join lateral (
      select c.intent from public.inference_events c
       where e.event_type = 'replied' and c.event_type = 'classified' and c.person_key = e.person_key
         and c.team_id is not distinct from e.team_id and c.intent is not null
       order by c.occurred_at desc limit 1
    ) ci on true
   where e.event_type in ('replied', 'classified')
     and e.source not like '%_backfill'
     and coalesce(e.metadata ->> 'backfill', '') <> 'true'
     and (
       (p_ids is not null and e.id = any(p_ids))
       or (p_ids is null
           and (e.metadata ->> 'enriched_at') is null
           and e.occurred_at >= now() - make_interval(days => greatest(coalesce(p_days, 30), 1))
           and coalesce(e.metadata ->> 'enrichment_status', '') <> 'failed'
           and coalesce((e.metadata ->> 'enrichment_next_at')::timestamptz, '-infinity') <= now())
     )
   order by priority, (e.event_type = 'replied') desc, e.occurred_at desc
   limit least(greatest(coalesce(p_limit, 200), 1), 500)
$$;

-- ------------------------------------------------------------ free lookups ---
-- Per target (id, team_id, person_key, email): what we already know for free.
--   inference    the person's OTHER inference rows in the same team scope
--                (backfill rows resolved to a team the same way Signals does),
--                newest non-empty value per field, and whether Apollo was ever
--                tried for this person (apollo_matched present on any row).
--   people       public.people (team_id, person_key)
--   synced       newest synced_contacts row for the email in the team
--   prospect     Vrelly prospects by business email
--   apollo_cache newest apollo_enrichment_cache person for the email
create or replace function public.inference_enrich_free_lookups(p_targets jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public
set statement_timeout = '60s'
as $$
declare
  v_config jsonb := (select config from public.signal_sources where key = 'positive_responses');
  v_out jsonb;
begin
  with t as (
    select x.id, x.team_id, nullif(btrim(x.person_key), '') as person_key, nullif(lower(btrim(x.email)), '') as email
      from jsonb_to_recordset(coalesce(p_targets, '[]'::jsonb)) as x(id uuid, team_id uuid, person_key text, email text)
  ),
  inf as (
    select t.id,
           jsonb_strip_nulls(jsonb_build_object(
             'job_title', (array_agg(e.job_title order by e.occurred_at desc) filter (where nullif(btrim(e.job_title), '') is not null))[1],
             'seniority', (array_agg(e.seniority order by e.occurred_at desc) filter (where nullif(btrim(e.seniority), '') is not null))[1],
             'department', (array_agg(e.department order by e.occurred_at desc) filter (where nullif(btrim(e.department), '') is not null))[1],
             'industry', (array_agg(e.industry order by e.occurred_at desc) filter (where nullif(btrim(e.industry), '') is not null))[1],
             'company_size', (array_agg(e.company_size order by e.occurred_at desc) filter (where nullif(btrim(e.company_size), '') is not null))[1],
             'company_name', (array_agg(e.company_name order by e.occurred_at desc) filter (where nullif(btrim(e.company_name), '') is not null))[1],
             'city', (array_agg(e.city order by e.occurred_at desc) filter (where nullif(btrim(e.city), '') is not null))[1],
             'state', (array_agg(e.state order by e.occurred_at desc) filter (where nullif(btrim(e.state), '') is not null))[1],
             'country', (array_agg(e.country order by e.occurred_at desc) filter (where nullif(btrim(e.country), '') is not null))[1],
             'linkedin_url', (array_agg(e.linkedin_url order by e.occurred_at desc) filter (where nullif(btrim(e.linkedin_url), '') is not null))[1],
             'headline', (array_agg(e.metadata -> 'headline' order by e.occurred_at desc) filter (where jsonb_typeof(e.metadata -> 'headline') = 'string'))[1],
             'employees', (array_agg(e.metadata -> 'employees' order by e.occurred_at desc) filter (where jsonb_typeof(e.metadata -> 'employees') = 'number'))[1],
             'revenue', (array_agg(e.metadata -> 'revenue' order by e.occurred_at desc) filter (where jsonb_typeof(e.metadata -> 'revenue') = 'string'))[1],
             'founded_year', (array_agg(e.metadata -> 'founded_year' order by e.occurred_at desc) filter (where jsonb_typeof(e.metadata -> 'founded_year') in ('string', 'number')))[1],
             'company_domain', (array_agg(e.metadata -> 'company_domain' order by e.occurred_at desc) filter (where jsonb_typeof(e.metadata -> 'company_domain') = 'string'))[1],
             'company_linkedin', (array_agg(e.metadata -> 'company_linkedin' order by e.occurred_at desc) filter (where jsonb_typeof(e.metadata -> 'company_linkedin') = 'string'))[1],
             'company_keywords', (array_agg(e.metadata -> 'company_keywords' order by e.occurred_at desc) filter (where jsonb_typeof(e.metadata -> 'company_keywords') = 'array'))[1],
             'time_zone', (array_agg(e.metadata -> 'time_zone' order by e.occurred_at desc) filter (where jsonb_typeof(e.metadata -> 'time_zone') = 'string'))[1]
           )) as fields,
           bool_or(e.metadata ? 'apollo_matched') as apollo_tried
      from t
      join public.inference_events e on e.person_key = t.person_key and e.id <> t.id
      left join public.signals_reply_team_map() m
        on e.team_id is null and m.provider_team_id = e.metadata ->> 'provider_team_id'
     where coalesce(e.team_id, nullif(v_config -> 'backfill_team_map' ->> e.source, '')::uuid, m.team_id)
           is not distinct from t.team_id
     group by t.id
  ),
  ppl as (
    select distinct on (t.id) t.id,
           jsonb_strip_nulls(jsonb_build_object(
             'job_title', nullif(btrim(p.job_title), ''), 'seniority', nullif(btrim(p.seniority), ''),
             'department', nullif(btrim(p.department), ''), 'industry', nullif(btrim(p.industry), ''),
             'company_size', nullif(btrim(p.company_size), ''), 'company_name', nullif(btrim(p.company_name), ''),
             'city', nullif(btrim(p.city), ''), 'state', nullif(btrim(p.state), ''), 'country', nullif(btrim(p.country), ''),
             'linkedin_url', nullif(btrim(p.linkedin_url), ''))) as fields
      from t join public.people p on p.team_id = t.team_id and p.person_key = t.person_key
     order by t.id, p.updated_at desc nulls last
  ),
  syn as (
    select distinct on (t.id) t.id,
           jsonb_strip_nulls(jsonb_build_object(
             'job_title', nullif(btrim(s.job_title), ''), 'industry', nullif(btrim(s.industry), ''),
             'company_size', nullif(btrim(s.company_size), ''), 'company_name', nullif(btrim(s.company), ''),
             'city', nullif(btrim(s.city), ''), 'state', nullif(btrim(s.state), ''), 'country', nullif(btrim(s.country), ''),
             'linkedin_url', nullif(btrim(s.linkedin_url), ''), 'company_domain', nullif(btrim(s.domain), ''))) as fields
      from t join public.synced_contacts s on s.email = t.email and s.team_id = t.team_id
     where t.email is not null
     order by t.id, s.updated_at desc nulls last
  ),
  pro as (
    select distinct on (t.id) t.id,
           jsonb_strip_nulls(jsonb_build_object(
             'job_title', nullif(btrim(p.job_title), ''), 'seniority', nullif(btrim(p.seniority), ''),
             'department', nullif(btrim(p.department), ''), 'industry', nullif(btrim(p.company_industry), ''),
             'company_size', coalesce(nullif(btrim(p.company_size), ''), nullif(btrim(p.company_size_range), '')),
             'company_name', nullif(btrim(p.company_name), ''), 'city', nullif(btrim(p.city), ''),
             'state', nullif(btrim(p.state), ''), 'country', nullif(btrim(p.country), ''),
             'linkedin_url', nullif(btrim(p.linkedin_url), ''), 'company_domain', nullif(btrim(p.company_domain), ''),
             'company_linkedin', nullif(btrim(p.company_linkedin), ''))) as fields
      from t join public.prospects p on p.business_email = t.email
     where t.email is not null
     order by t.id, (p.job_title is null), p.created_at desc
  ),
  apc as (
    select distinct on (t.id) t.id, c.person
      from t join public.apollo_enrichment_cache c on lower(c.email) = t.email
     where t.email is not null and c.person is not null
     order by t.id, c.fetched_at desc nulls last
  )
  select coalesce(jsonb_object_agg(t.id, jsonb_build_object(
           'inference', coalesce(inf.fields, '{}'::jsonb),
           'apollo_tried', coalesce(inf.apollo_tried, false),
           'people', coalesce(ppl.fields, '{}'::jsonb),
           'synced', coalesce(syn.fields, '{}'::jsonb),
           'prospect', coalesce(pro.fields, '{}'::jsonb),
           'apollo_cache', apc.person)), '{}'::jsonb)
    into v_out
    from t
    left join inf on inf.id = t.id
    left join ppl on ppl.id = t.id
    left join syn on syn.id = t.id
    left join pro on pro.id = t.id
    left join apc on apc.id = t.id;
  return v_out;
end
$$;

-- ------------------------------------------------------------------ apply ---
-- p_rows: [{ id, fill: {metadata keys, only if absent}, set: {metadata keys,
-- always}, cols: {column: value} }]. Columns fill only when empty, except
-- country/state, which the caller sends already normalized from the row's own
-- value first.
create or replace function public.inference_enrich_apply(p_rows jsonb)
returns integer
language plpgsql security definer set search_path = public
set statement_timeout = '60s'
as $$
declare
  v_n integer;
begin
  update public.inference_events e
     set metadata = (coalesce(r.fill, '{}'::jsonb) || coalesce(e.metadata, '{}'::jsonb)) || coalesce(r.set, '{}'::jsonb),
         job_title = coalesce(nullif(btrim(e.job_title), ''), nullif(btrim(r.cols ->> 'job_title'), '')),
         seniority = coalesce(nullif(btrim(e.seniority), ''), nullif(btrim(r.cols ->> 'seniority'), '')),
         department = coalesce(nullif(btrim(e.department), ''), nullif(btrim(r.cols ->> 'department'), '')),
         industry = coalesce(nullif(btrim(e.industry), ''), nullif(btrim(r.cols ->> 'industry'), '')),
         company_size = coalesce(nullif(btrim(e.company_size), ''), nullif(btrim(r.cols ->> 'company_size'), '')),
         company_name = coalesce(nullif(btrim(e.company_name), ''), nullif(btrim(r.cols ->> 'company_name'), '')),
         city = coalesce(nullif(btrim(e.city), ''), nullif(btrim(r.cols ->> 'city'), '')),
         state = coalesce(nullif(btrim(r.cols ->> 'state'), ''), e.state),
         country = coalesce(nullif(btrim(r.cols ->> 'country'), ''), e.country),
         linkedin_url = coalesce(nullif(btrim(e.linkedin_url), ''), nullif(btrim(r.cols ->> 'linkedin_url'), '')),
         campaign_external_id = coalesce(nullif(btrim(e.campaign_external_id), ''), nullif(btrim(r.cols ->> 'campaign_external_id'), '')),
         campaign_name = coalesce(nullif(btrim(e.campaign_name), ''), nullif(btrim(r.cols ->> 'campaign_name'), '')),
         subject = coalesce(nullif(btrim(e.subject), ''), nullif(btrim(r.cols ->> 'subject'), '')),
         copy_fingerprint = coalesce(nullif(btrim(e.copy_fingerprint), ''), nullif(btrim(r.cols ->> 'copy_fingerprint'), ''))
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(id uuid, fill jsonb, set jsonb, cols jsonb)
   where e.id = r.id;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

-- US state → IANA zone (the backfill's table; keys are lowercase names and
-- two-letter codes).
create or replace function public.inference_enrich_state_tz()
returns table (state text, tz text)
language sql stable security definer set search_path = public
as $$ select u.state, u.tz from inference_staging.us_state_tz u $$;

-- --------------------------------------------------------------- admin card ---
-- Enrichment health for the Inference tab. Replies = 'replied' rows, live only.
create or replace function public.admin_inference_enrichment_health(p_days integer default 7)
returns jsonb
language plpgsql stable security definer set search_path = public
set statement_timeout = '30s'
as $$
declare
  v_out jsonb;
begin
  if not exists (select 1 from public.profiles p
                  where p.id = auth.uid() and (p.is_platform_admin = true or p.is_super_admin = true)) then
    raise exception 'admin_inference_enrichment_health: platform admins only' using errcode = '42501';
  end if;

  with r as (
    select e.*, coalesce(e.intent, ci.intent) as intent2
      from public.inference_events e
      left join lateral (
        select c.intent from public.inference_events c
         where c.event_type = 'classified' and c.person_key = e.person_key
           and c.team_id is not distinct from e.team_id and c.intent is not null
         order by c.occurred_at desc limit 1
      ) ci on true
     where e.event_type = 'replied' and e.source not like '%_backfill'
       and coalesce(e.metadata ->> 'backfill', '') <> 'true'
       and e.occurred_at >= now() - make_interval(days => greatest(coalesce(p_days, 7), 1))
  ),
  g as (
    select case intent2 when 'interested' then 'interested' when 'not_interested' then 'not_interested' else 'other' end as grp,
           count(*) as n,
           count(*) filter (where metadata ? 'enriched_at') as enriched,
           count(*) filter (where metadata ? 'sequence_step_number' or metadata ? 'sequence_number') as step,
           count(*) filter (where nullif(btrim(industry), '') is not null) as industry,
           count(*) filter (where nullif(btrim(company_size), '') is not null) as size,
           count(*) filter (where nullif(btrim(job_title), '') is not null) as title,
           count(*) filter (where nullif(btrim(state), '') is not null) as state,
           count(*) filter (where metadata ? 'tz_effective' or metadata ? 'time_zone') as timezone
      from r group by 1
  )
  select jsonb_build_object(
           'days', p_days,
           'replies', coalesce((select sum(n) from g), 0),
           'enriched', coalesce((select sum(enriched) from g), 0),
           'groups', coalesce((select jsonb_agg(to_jsonb(g) order by case grp when 'interested' then 0 when 'other' then 1 else 2 end) from g), '[]'::jsonb),
           'apollo_credits_today', coalesce((select sum(credits) from public.inference_enrichment_log
                                              where step = 'apollo' and credits > 0 and created_at >= date_trunc('day', now())), 0),
           'waiting', (select count(*) from public.inference_events e
                        where e.event_type in ('replied', 'classified') and e.source not like '%_backfill'
                          and (e.metadata ->> 'enriched_at') is null
                          and coalesce(e.metadata ->> 'backfill', '') <> 'true'
                          and coalesce(e.metadata ->> 'enrichment_status', '') <> 'failed'
                          and e.occurred_at >= now() - interval '30 days'),
           'failed', (select count(*) from public.inference_events e
                       where e.source not like '%_backfill' and (e.metadata ->> 'enriched_at') is null
                         and e.metadata ->> 'enrichment_status' = 'failed'),
           'last_run_at', (select max(created_at) from public.inference_enrichment_log where step = 'run'))
    into v_out;
  return v_out;
end
$$;

-- Teams for the Live Feed's team filter: admins get every team with inference
-- rows; anyone else only their own teams.
create or replace function public.inference_feed_teams()
returns table (id uuid, name text)
language sql stable security definer set search_path = public
as $$
  select t.id, t.name from public.teams t
   where exists (select 1 from public.inference_events e where e.team_id = t.id)
     and (exists (select 1 from public.profiles p
                   where p.id = auth.uid() and (p.is_platform_admin = true or p.is_super_admin = true))
          or exists (select 1 from public.team_memberships m where m.team_id = t.id and m.user_id = auth.uid()))
   order by t.name
$$;

revoke all on function public.inference_enrich_queue(integer, integer, uuid[]) from public, anon, authenticated;
revoke all on function public.inference_enrich_free_lookups(jsonb) from public, anon, authenticated;
revoke all on function public.inference_enrich_apply(jsonb) from public, anon, authenticated;
revoke all on function public.inference_enrich_state_tz() from public, anon, authenticated;
revoke all on function public.admin_inference_enrichment_health(integer) from public, anon;
revoke all on function public.inference_feed_teams() from public, anon;
grant execute on function public.inference_enrich_queue(integer, integer, uuid[]) to service_role;
grant execute on function public.inference_enrich_free_lookups(jsonb) to service_role;
grant execute on function public.inference_enrich_apply(jsonb) to service_role;
grant execute on function public.inference_enrich_state_tz() to service_role;
grant execute on function public.admin_inference_enrichment_health(integer) to authenticated, service_role;
grant execute on function public.inference_feed_teams() to authenticated, service_role;

-- ------------------------------------------------------------------- cron ---
-- Same pattern as dispatch-signal-sources (Vault agent_api_key, project URL
-- taken from an existing job). Created DISABLED.
do $$
declare
  v_base text;
  v_job bigint;
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'agent_api_key') then
    raise exception 'Cannot schedule enrich-inference-events: Vault secret agent_api_key is missing.';
  end if;
  select substring(command from '(https://[a-z0-9]+\.supabase\.co)/functions/v1/') into v_base
    from cron.job where command ~ 'https://[a-z0-9]+\.supabase\.co/functions/v1/' limit 1;
  if v_base is null then
    raise exception 'Cannot schedule enrich-inference-events: no existing cron job to take the project URL from.';
  end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'enrich-inference-events-5min';
  v_job := cron.schedule('enrich-inference-events-5min', '*/5 * * * *', format($cmd$
    select net.http_post(
      url := %L,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-agent-key',
                   (select decrypted_secret from vault.decrypted_secrets where name = 'agent_api_key' limit 1)),
      body := '{}'::jsonb,
      timeout_milliseconds := 150000);
  $cmd$, v_base || '/functions/v1/enrich-inference-events'));
  perform cron.alter_job(job_id := v_job, active := false);
end $$;
