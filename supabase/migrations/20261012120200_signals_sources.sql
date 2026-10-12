-- Signals foundation (3/3): source-specific SQL, seed rows, dispatcher cron.

-- ------------------------------------------------- PE seller intent (internal) ---
-- One candidate per person_key: SourceCo replies classified 'interested'.
-- Sources come from config (never hard-coded here):
--   backfill_sources: inference_events.source values that are SourceCo history
--   team_ids:         SourceCo team(s) — their live rows, any source
-- p_since: only people with an interested row created/occurred since then
-- (null = everyone: the one-time backfill). Keyset-paged on person_key.
-- plpgsql (not sql) so it can be created where inference_events is absent.

create or replace function public.signals_pe_candidates(
  p_config jsonb, p_since timestamptz default null, p_after text default null, p_limit integer default 500
)
returns table (
  person_key text, last_at timestamptz, first_at timestamptz, interested_rows integer,
  full_name text, job_title text, seniority text, company_name text, company_domain text, industry text,
  company_size text, city text, state text, country text, email text, linkedin_url text, channel text,
  campaign_name text, source text, reply_text text
)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_sources text[] := coalesce(array(select jsonb_array_elements_text(p_config->'backfill_sources')), '{}');
  v_teams uuid[] := coalesce(array(select (jsonb_array_elements_text(p_config->'team_ids'))::uuid), '{}');
  v_chars integer := coalesce((p_config->>'excerpt_chars')::integer, 280);
begin
  -- OUT columns share names with inference_events columns; every reference
  -- below is qualified, and this makes any slip resolve to the column.
  return query
  with base as (
    select e.* from public.inference_events e
     where e.intent = 'interested'
       and e.person_key is not null and e.person_key <> ''
       and (e.source = any(v_sources) or e.team_id = any(v_teams))
  ),
  persons as (
    select b.person_key from base b
     where (p_since is null or b.created_at >= p_since or b.occurred_at >= p_since)
       and (p_after is null or b.person_key > p_after)
     group by b.person_key
     order by b.person_key
     limit least(greatest(coalesce(p_limit, 500), 1), 2000)
  )
  select p.person_key, a.last_at, a.first_at, a.n::integer,
         a.full_name, a.job_title, a.seniority, a.company_name, a.company_domain, a.industry, a.company_size,
         a.city, a.state, a.country, a.email, a.linkedin_url, a.channel, a.campaign_name, a.source, a.reply_text
    from persons p
    cross join lateral (
      select max(b.occurred_at) as last_at, min(b.occurred_at) as first_at, count(*) as n,
             (array_agg(b.full_name order by b.occurred_at desc) filter (where nullif(btrim(b.full_name), '') is not null))[1] as full_name,
             (array_agg(b.job_title order by b.occurred_at desc) filter (where nullif(btrim(b.job_title), '') is not null))[1] as job_title,
             (array_agg(b.seniority order by b.occurred_at desc) filter (where nullif(btrim(b.seniority), '') is not null))[1] as seniority,
             (array_agg(b.company_name order by b.occurred_at desc) filter (where nullif(btrim(b.company_name), '') is not null))[1] as company_name,
             (array_agg(b.metadata->>'company_domain' order by b.occurred_at desc) filter (where nullif(btrim(b.metadata->>'company_domain'), '') is not null))[1] as company_domain,
             (array_agg(b.industry order by b.occurred_at desc) filter (where nullif(btrim(b.industry), '') is not null))[1] as industry,
             (array_agg(b.company_size order by b.occurred_at desc) filter (where nullif(btrim(b.company_size), '') is not null))[1] as company_size,
             (array_agg(b.city order by b.occurred_at desc) filter (where nullif(btrim(b.city), '') is not null))[1] as city,
             (array_agg(b.state order by b.occurred_at desc) filter (where nullif(btrim(b.state), '') is not null))[1] as state,
             (array_agg(b.country order by b.occurred_at desc) filter (where nullif(btrim(b.country), '') is not null))[1] as country,
             (array_agg(b.email order by b.occurred_at desc) filter (where nullif(btrim(b.email), '') is not null))[1] as email,
             (array_agg(b.linkedin_url order by b.occurred_at desc) filter (where nullif(btrim(b.linkedin_url), '') is not null))[1] as linkedin_url,
             (array_agg(b.channel order by b.occurred_at desc))[1] as channel,
             (array_agg(b.campaign_name order by b.occurred_at desc) filter (where nullif(btrim(b.campaign_name), '') is not null))[1] as campaign_name,
             (array_agg(b.source order by b.occurred_at desc))[1] as source,
             (array_agg(left(b.metadata->>'reply_text', v_chars) order by b.occurred_at desc)
                filter (where nullif(btrim(b.metadata->>'reply_text'), '') is not null))[1] as reply_text
        from base b where b.person_key = p.person_key
    ) a
   order by p.person_key;
end
$$;

revoke all on function public.signals_pe_candidates(jsonb, timestamptz, text, integer) from public, anon, authenticated;
grant execute on function public.signals_pe_candidates(jsonb, timestamptz, text, integer) to service_role;

-- ------------------------------------------------------ website visitors ---
-- One call per pixel hit (from the public 'track' function, service_role).
-- Returns 'ok' | 'unknown_site' | 'domain_mismatch' | 'rate_limited'.
-- Limits: 60 hits/min per ip_hash, 5000 hits/hour per site.

create or replace function public.signals_track_hit(
  p_site_key text, p_url text, p_referrer text, p_ip_hash text, p_user_agent text,
  p_anon_id text, p_ts timestamptz, p_resolved jsonb default null
)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  site public.signal_sites%rowtype;
  v_host text := lower(substring(coalesce(p_url, '') from '^https?://([^/:?#]+)'));
begin
  select * into site from public.signal_sites where site_key = p_site_key and is_active;
  if not found then
    return 'unknown_site';
  end if;
  v_host := regexp_replace(coalesce(v_host, ''), '^www\.', '');
  if not (v_host = site.domain or v_host like '%.' || site.domain) then
    return 'domain_mismatch';
  end if;
  if (select count(*) from public.signal_pixel_hits
       where ip_hash = p_ip_hash and received_at > now() - interval '1 minute') >= 60
     or (select count(*) from public.signal_pixel_hits
          where site_key = p_site_key and received_at > now() - interval '1 hour') >= 5000 then
    return 'rate_limited';
  end if;
  insert into public.signal_pixel_hits (site_key, team_id, url, referrer, ip_hash, user_agent, anon_id, ts, resolved)
  values (p_site_key, site.team_id, left(p_url, 2000), left(p_referrer, 2000), p_ip_hash, left(p_user_agent, 500),
          left(nullif(btrim(p_anon_id), ''), 100),
          -- a client clock is advisory: clamp to [now - 1 day, now]
          least(now(), greatest(coalesce(p_ts, now()), now() - interval '1 day')),
          p_resolved);
  return 'ok';
end
$$;

-- Visitor-day rollup input for signal-web-visitors: one row per
-- (site, anon_id, UTC day) with hits since p_since. Hits without an anon_id
-- are not rolled up (grouping them would need the IP hash in signals).
create or replace function public.signals_pixel_visits(p_since timestamptz)
returns table (
  site_key text, team_id uuid, domain text, anon_id text, day date, first_ts timestamptz, last_ts timestamptz,
  pages integer, urls text[], referrer text, user_agent text, resolved jsonb
)
language sql stable security definer set search_path = public
as $$
  select h.site_key, h.team_id, s.domain, h.anon_id, (h.ts at time zone 'utc')::date as day,
         min(h.ts), max(h.ts), count(*)::integer,
         (array_agg(distinct h.url))[1:25],
         (array_agg(h.referrer order by h.ts) filter (where h.referrer is not null))[1],
         (array_agg(h.user_agent order by h.ts desc))[1],
         (array_agg(h.resolved order by h.ts desc) filter (where h.resolved is not null))[1]
    from public.signal_pixel_hits h
    join public.signal_sites s on s.site_key = h.site_key
   where h.anon_id is not null
     and (h.ts at time zone 'utc')::date >= (p_since at time zone 'utc')::date
   group by h.site_key, h.team_id, s.domain, h.anon_id, (h.ts at time zone 'utc')::date
$$;

revoke all on function public.signals_track_hit(text, text, text, text, text, text, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.signals_pixel_visits(timestamptz) from public, anon, authenticated;
grant execute on function public.signals_track_hit(text, text, text, text, text, text, timestamptz, jsonb) to service_role;
grant execute on function public.signals_pixel_visits(timestamptz) to service_role;

-- -------------------------------------------------------------- seed rows ---

insert into public.signal_sources (key, vertical, name, kind, cadence, default_visibility, function_name, config)
values
  ('pe_seller_intent', 'private_equity', 'SourceCo seller intent', 'internal', 'daily', 'admin', 'signal-pe-seller-intent',
   jsonb_build_object(
     'backfill_sources', jsonb_build_array('reply2_backfill', 'smartlead_backfill'),
     'team_ids', coalesce((select jsonb_agg(id) from public.teams where name = 'SourceCo''s Team'), '[]'::jsonb),
     'excerpt_chars', 280)),
  ('openfda_510k', 'medical_device', 'FDA 510(k) clearances', 'api', 'daily', 'all_clients', 'signal-openfda-510k',
   jsonb_build_object('lookback_days_initial', 30, 'lookback_days', 10, 'page_size', 100, 'max_pages', 50)),
  ('saas_hiring', 'saas_hiring', 'SaaS sales hiring', 'api', 'daily', 'all_clients', 'signal-saas-hiring',
   jsonb_build_object('boards', '[]'::jsonb,
     'role_keywords', jsonb_build_array('SDR', 'BDR', 'Account Executive', 'Head of Sales', 'RevOps'),
     'max_age_days', 30)),
  ('github_activity', 'github', 'GitHub repo activity', 'api', 'daily', 'all_clients', 'signal-github-activity',
   jsonb_build_object('orgs', '[]'::jsonb, 'search_queries', '[]'::jsonb, 'lookback_days', 2, 'max_search_results', 50)),
  ('web_visitors', 'web_visitors', 'Website visitors', 'pixel', 'realtime', 'team', 'signal-web-visitors',
   jsonb_build_object('rollup_days', 2))
on conflict (key) do nothing;

-- Seed pixel sites for Myall's team (prod user 5edc98cc…); where that user does
-- not exist (dev), the first platform admin's team. The snippet is NOT added
-- to either site.
do $$
declare
  v_team uuid := coalesce(
    (select team_id from public.team_memberships where user_id = '5edc98cc-7762-43e8-ab8d-ae8d69a08db8' order by created_at limit 1),
    (select m.team_id from public.team_memberships m join public.profiles p on p.id = m.user_id
      where p.is_platform_admin order by m.created_at limit 1));
begin
  if v_team is not null then
    insert into public.signal_sites (team_id, domain) values (v_team, 'vrelly.com'), (v_team, 'incrementums.org')
    on conflict (team_id, domain) do nothing;
  end if;
end $$;

-- ------------------------------------------------------- dispatcher cron ---
-- Hourly; the dispatcher decides which sources are due. Same URL + Vault
-- agent_api_key header as dispatch-agent-audiences.

do $$
declare
  v_base text;
begin
  select substring(command from '(https://[a-z0-9]+\.supabase\.co)/functions/v1/') into v_base
    from cron.job where command ~ 'https://[a-z0-9]+\.supabase\.co/functions/v1/' limit 1;
  if v_base is null then
    raise exception 'Cannot schedule dispatch-signal-sources: no existing cron job to take the project URL from.';
  end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'dispatch-signal-sources';
  perform cron.schedule('dispatch-signal-sources', '5 * * * *', format($cmd$
    select net.http_post(
      url := %L,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-agent-key',
                   (select decrypted_secret from vault.decrypted_secrets where name = 'agent_api_key' limit 1)),
      body := '{}'::jsonb,
      timeout_milliseconds := 150000);
  $cmd$, v_base || '/functions/v1/dispatch-signal-sources'));
end $$;
