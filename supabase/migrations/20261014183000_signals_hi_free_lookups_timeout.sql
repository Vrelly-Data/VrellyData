-- signals_hi_free_lookups: its own 60s statement timeout, and a by-domain
-- lookup that always uses its index.
--
-- Every hourly signal-positive-responses run on prod ended "partial" with
-- "signals_hi_free_lookups: canceling statement due to statement timeout"
-- once the enrichment batch went to 2,000. The call ran under PostgREST's 8s
-- authenticator timeout, and the by-domain prospects lookup took 18.7s for
-- 2,000 signals (big domains — morganstanley.com 5,159 prospects — read cold).
-- The edge function now calls this in chunks of 250 signals.
--
--   * set statement_timeout = '60s': a function-level SET overrides the role
--     timeout for RPC calls (verified on dev: 9s sleep → 200 with it, 57014
--     without).
--   * by-domain lookup is a LATERAL probe per domain. idx_prospects_signals_
--     domain_key (20261013120100) has never been analyzed, so the planner
--     guesses ~9.6k rows per domain and, for a 250-signal chunk (~200
--     domains), chose a parallel seq scan of all 1.9M prospects (34.2s on
--     prod). Lateral: same chunk 8.5s cold, index every time. Same output:
--     domains with no prospects are left out, as with the inner join.
--   * analyze public.prospects: gives that expression index statistics (the
--     table was last analyzed 2026-04-01; signal audiences use the index too).
--
-- No new index: every join column is already indexed on prod
-- (idx_prospects_business_email, idx_prospects_signals_domain_key,
-- idx_inference_person_key, signal_admin_details_pkey, signals_pkey).
-- Otherwise the body is unchanged from 20261014120000; create or replace
-- keeps the grants.

create or replace function public.signals_hi_free_lookups(p_emails text[], p_domains text[], p_signal_ids uuid[])
returns jsonb
language plpgsql stable security definer set search_path = public
set statement_timeout = '60s'
as $$
declare
  v_config jsonb := (select config from public.signal_sources where key = 'positive_responses');
  v_email jsonb;
  v_domain jsonb;
  v_inf jsonb;
begin
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_email from (
    select distinct on (lower(p.business_email)) lower(p.business_email) as email,
           nullif(btrim(p.job_title), '') as person_title, nullif(btrim(p.seniority), '') as seniority,
           nullif(btrim(p.city), '') as city, nullif(btrim(p.state), '') as state, nullif(btrim(p.country), '') as country,
           nullif(btrim(p.company_industry), '') as industry,
           coalesce(nullif(btrim(p.company_size), ''), nullif(btrim(p.company_size_range), '')) as company_size
      from public.prospects p
     where p.business_email = any(coalesce(p_emails, '{}'))
     order by lower(p.business_email), (p.job_title is null), p.created_at desc
  ) x;

  -- One index probe per domain (lateral): a plain join let the planner pick a
  -- seq scan of all prospects for ~200 domains.
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_domain from (
    select d.domain, a.industry, a.company_size, a.keywords
      from (select distinct lower(btrim(d0)) as domain, public.signals_domain_key(d0) as dkey
              from unnest(coalesce(p_domains, '{}')) d0 where btrim(d0) <> '') d
      cross join lateral (
        select count(*) as n,
               mode() within group (order by nullif(btrim(p.company_industry), '')) as industry,
               mode() within group (order by coalesce(nullif(btrim(p.company_size), ''), nullif(btrim(p.company_size_range), ''))) as company_size,
               (array_agg(p.keywords) filter (where nullif(btrim(p.keywords), '') is not null))[1] as keywords
          from public.prospects p
         where public.signals_domain_key(p.company_domain) = d.dkey
      ) a
     where a.n > 0
  ) x;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_inf from (
    select s.id as signal_id,
           (array_agg(e.job_title order by e.occurred_at desc) filter (where nullif(btrim(e.job_title), '') is not null))[1] as person_title,
           (array_agg(e.seniority order by e.occurred_at desc) filter (where nullif(btrim(e.seniority), '') is not null))[1] as seniority,
           (array_agg(e.industry order by e.occurred_at desc) filter (where nullif(btrim(e.industry), '') is not null))[1] as industry,
           (array_agg(e.city order by e.occurred_at desc) filter (where nullif(btrim(e.city), '') is not null))[1] as city,
           (array_agg(e.state order by e.occurred_at desc) filter (where nullif(btrim(e.state), '') is not null))[1] as state,
           (array_agg(e.country order by e.occurred_at desc) filter (where nullif(btrim(e.country), '') is not null))[1] as country,
           coalesce(
             (array_agg(e.company_size order by e.occurred_at desc) filter (where nullif(btrim(e.company_size), '') is not null))[1],
             (array_agg(e.metadata ->> 'employees' order by e.occurred_at desc) filter (where nullif(btrim(e.metadata ->> 'employees'), '') is not null))[1]
           ) as company_size,
           (array_agg(e.metadata ->> 'company_keywords' order by e.occurred_at desc)
              filter (where nullif(btrim(e.metadata ->> 'company_keywords'), '') is not null))[1] as keywords
      from public.signals s
      join public.signal_admin_details d on d.signal_id = s.id
      join public.inference_events e on e.person_key = d.detail ->> 'person_key'
      left join public.signals_reply_team_map() m
        on e.team_id is null and m.provider_team_id = e.metadata ->> 'provider_team_id'
     where s.id = any(coalesce(p_signal_ids, '{}'))
       and coalesce(e.team_id, nullif(v_config -> 'backfill_team_map' ->> e.source, '')::uuid, m.team_id)
           is not distinct from s.team_id
     group by s.id
  ) x;

  return jsonb_build_object('by_email', v_email, 'by_domain', v_domain, 'inference', v_inf);
end
$$;

analyze public.prospects;
