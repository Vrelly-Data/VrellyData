-- Signals restructure: "vertical" is split into two dimensions.
--
--   SIGNAL TYPE (what happened) — signals.signal_type, the primary tabs.
--     Internal keys: positive_response, fda_clearance, hiring, website_visit,
--     product_launch (+ linkedin_post_keyword, fast_growth: "coming soon",
--     no source yet). A source has exactly one type (signal_sources.signal_type)
--     and the guard trigger stamps it on every row.
--   MARKET (who it is relevant to) — signals.markets text[], several per
--     signal, from private_equity / medical_device / saas / recruiting / other.
--     Assigned at ingest by supabase/functions/_shared/signal-markets.ts; the
--     source's default_markets (else 'other') when a writer sends none.
--
-- positive_response is "High Intent" to clients. Clients must never learn a
-- High Intent signal came from someone replying to outbound, so:
--   * the reply excerpt / campaign / platform / channel live in
--     signal_admin_details (admin-only), never in signals.payload/title/url;
--   * authenticated users can no longer SELECT public.signals directly: every
--     read goes through SECURITY DEFINER RPCs that apply the visibility rule
--     AND return a client-safe shape (public type key 'high_intent', no
--     internal source key). The RLS policies stay as a second line.
--   * the source now covers EVERY team's 'interested' replies (team = the
--     client who received the reply; admin-only when no team can be found).
--
-- Also: per-team settings (default market, country, Apollo enrichment opt-in),
-- High Intent auto-enrichment plumbing, ™/®-style text repair, country codes.
--
-- Prerequisites: 20261012120000..120200 (signals), 20261013120000 (audiences),
-- 20261014115900 (team settings + signals_markets_valid; its own short
-- transaction so the app-wide teams table is never locked behind this one).

-- ============================================================ text repair ===

-- SQL twin of fixText (_shared/signals.ts), for repairing stored rows:
-- 1) UTF-8 read as cp1252 ("MickaÃ«l" → "Mickaël") when it round-trips;
-- 2) C1 controls U+0080–U+009F read as cp1252 ("3M" || U+0099 → "3M™").
create or replace function public.signals_fix_text(p text)
returns text
language plpgsql immutable
as $$
declare
  s text := p;
begin
  if s is null then
    return null;
  end if;
  if s ~ '[Â-ô][\u0080-¿€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]' then
    begin
      s := convert_from(convert_to(s, 'WIN1252'), 'UTF8');
    exception when others then
      s := p;
    end;
  end if;
  s := translate(s,
    U&'\0080\0082\0083\0084\0085\0086\0087\0088\0089\008A\008B\008C\008E\0091\0092\0093\0094\0095\0096\0097\0098\0099\009A\009B\009C\009E\009F',
    U&'\20AC\201A\0192\201E\2026\2020\2021\02C6\2030\0160\2039\0152\017D\2018\2019\201C\201D\2022\2013\2014\02DC\2122\0161\203A\0153\017E\0178');
  return regexp_replace(s, '[\u0080-\u009f]', '', 'g');
end
$$;

-- ================================================================ catalog ===

create or replace function public.signals_public_type(p text)
returns text
language sql immutable parallel safe
as $$ select case when p = 'positive_response' then 'high_intent' else p end $$;

-- 'high_intent' (or an internal key) → the internal key.
create or replace function public.signals_internal_type(p text)
returns text
language sql immutable parallel safe
as $$ select case when lower(btrim(p)) = 'high_intent' then 'positive_response' else lower(btrim(p)) end $$;

-- Free-text country → ISO 3166-1 alpha-2 (common names; 2-letter codes pass through).
create or replace function public.signals_country_code(p text)
returns text
language sql immutable parallel safe
as $$
  select case
    when p is null or btrim(p) = '' then null
    when btrim(p) ~ '^[A-Za-z]{2}$' then upper(case when lower(btrim(p)) = 'uk' then 'gb' else btrim(p) end)
    else case regexp_replace(lower(btrim(p)), '[.]', '', 'g')
      when 'usa' then 'US' when 'united states' then 'US' when 'united states of america' then 'US' when 'us of a' then 'US'
      when 'america' then 'US'
      when 'canada' then 'CA' when 'mexico' then 'MX' when 'brazil' then 'BR' when 'argentina' then 'AR'
      when 'united kingdom' then 'GB' when 'great britain' then 'GB' when 'england' then 'GB' when 'scotland' then 'GB'
      when 'wales' then 'GB' when 'northern ireland' then 'GB' when 'ireland' then 'IE'
      when 'germany' then 'DE' when 'france' then 'FR' when 'spain' then 'ES' when 'italy' then 'IT'
      when 'netherlands' then 'NL' when 'the netherlands' then 'NL' when 'belgium' then 'BE' when 'switzerland' then 'CH'
      when 'austria' then 'AT' when 'sweden' then 'SE' when 'norway' then 'NO' when 'denmark' then 'DK'
      when 'finland' then 'FI' when 'poland' then 'PL' when 'portugal' then 'PT' when 'israel' then 'IL'
      when 'india' then 'IN' when 'china' then 'CN' when 'japan' then 'JP' when 'south korea' then 'KR'
      when 'korea' then 'KR' when 'republic of korea' then 'KR' when 'singapore' then 'SG' when 'australia' then 'AU'
      when 'new zealand' then 'NZ' when 'united arab emirates' then 'AE' when 'uae' then 'AE'
      when 'south africa' then 'ZA' when 'pakistan' then 'PK' when 'philippines' then 'PH' when 'taiwan' then 'TW'
      when 'hong kong' then 'HK' when 'malaysia' then 'MY' when 'turkey' then 'TR' when 'türkiye' then 'TR'
      when 'saudi arabia' then 'SA' when 'nigeria' then 'NG' when 'egypt' then 'EG' when 'colombia' then 'CO'
      when 'chile' then 'CL' when 'czech republic' then 'CZ' when 'czechia' then 'CZ' when 'romania' then 'RO'
      when 'greece' then 'GR' when 'hungary' then 'HU' when 'ukraine' then 'UA' when 'vietnam' then 'VN'
      when 'thailand' then 'TH' when 'indonesia' then 'ID' when 'puerto rico' then 'PR'
      else null end
  end
$$;

-- "High intent: <Name>, <Title> at <Company>" — twin of highIntentTitle (signal-catalog.ts).
create or replace function public.signals_high_intent_title(p_name text, p_title text, p_company text)
returns text
language sql immutable parallel safe
as $$
  select left('High intent: ' || coalesce(
    nullif(concat_ws(', ', nullif(btrim(p_name), ''), nullif(btrim(p_title), '')), '')
      || coalesce(' at ' || nullif(btrim(p_company), ''), ''),
    nullif(btrim(p_company), ''),
    'Unnamed contact'), 500)
$$;

-- Platform labels for admin views.
create or replace function public.signals_platform_label(p text)
returns text
language sql immutable parallel safe
as $$
  select case lower(coalesce(p, ''))
    when 'reply_io' then 'Reply.io' when 'reply.io' then 'Reply.io' when 'replyio' then 'Reply.io'
    when 'smartlead' then 'Smartlead' when 'heyreach' then 'HeyReach' when '' then null
    else p end
$$;

-- ======================================================== signals columns ===

alter table public.signals
  add column if not exists markets text[] not null default '{}',
  add column if not exists industry text,
  add column if not exists seniority text,
  add column if not exists company_size text,
  add column if not exists enriched_at timestamptz,
  add column if not exists enrichment jsonb not null default '{}'::jsonb,
  add column if not exists country_code text generated always as (public.signals_country_code(country)) stored;

-- Admin-only source evidence (High Intent: reply excerpt, campaign, platform…).
create table if not exists public.signal_admin_details (
  signal_id  uuid primary key references public.signals(id) on delete cascade,
  detail     jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.signal_admin_details enable row level security;
revoke all on public.signal_admin_details from anon, authenticated;
grant all on public.signal_admin_details to service_role;
drop policy if exists "signal_admin_details: admins read" on public.signal_admin_details;
create policy "signal_admin_details: admins read" on public.signal_admin_details
  for select to authenticated using ((select public.signals_is_admin()));

-- ========================================================= signal_sources ===

alter table public.signal_sources
  add column if not exists signal_type text,
  add column if not exists default_markets text[] not null default '{}';

update public.signal_sources set signal_type = case key
    when 'pe_seller_intent' then 'positive_response'
    when 'openfda_510k' then 'fda_clearance'
    when 'saas_hiring' then 'hiring'
    when 'github_activity' then 'product_launch'
    when 'web_visitors' then 'website_visit'
    else coalesce(signal_type, 'other_signal') end
 where signal_type is null;

update public.signal_sources set default_markets = case key
    when 'openfda_510k' then array['medical_device']
    when 'github_activity' then array['saas']
    else '{}'::text[] end;

alter table public.signal_sources alter column signal_type set not null;
alter table public.signal_sources drop constraint if exists signal_sources_signal_type_check;
alter table public.signal_sources add constraint signal_sources_signal_type_check
  check (signal_type ~ '^[a-z][a-z0-9_]{1,62}$');
alter table public.signal_sources drop constraint if exists signal_sources_default_markets_check;
alter table public.signal_sources add constraint signal_sources_default_markets_check
  check (cardinality(default_markets) = 0 or signals_markets_valid(default_markets));

-- The guard: type and default markets come from the source; an admin-only
-- source can never write a wider row. (Replaces the vertical stamping.)
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
  new.signal_type := src.signal_type;
  if new.markets is null or cardinality(new.markets) = 0 then
    new.markets := case when cardinality(src.default_markets) > 0 then src.default_markets else array['other'] end;
  end if;
  if src.default_visibility = 'admin' and new.visibility <> 'admin' then
    raise exception 'source % is admin-only; refusing visibility %', new.source_key, new.visibility;
  end if;
  new.updated_at := now();
  return new;
end
$$;

-- --------------------------------------- pe_seller_intent → positive_responses
-- The key cascades to signals.source_key and signal_runs (runs and health kept).

update public.signal_sources
   set key = 'positive_responses',
       name = 'High Intent (interested replies, all teams)',
       function_name = 'signal-positive-responses',
       default_visibility = 'team',
       cadence = 'hourly',
       config = jsonb_build_object(
         'backfill_team_map', coalesce((
           select jsonb_build_object('reply2_backfill', t, 'smartlead_backfill', t)
             from (select (config -> 'team_ids' ->> 0) as t) x where x.t is not null), '{}'::jsonb),
         'excerpt_chars', coalesce(config -> 'excerpt_chars', '280'::jsonb),
         'page_size', 500, 'enrich_batch', 500, 'apollo_max_per_run', 50),
       updated_at = now()
 where key = 'pe_seller_intent';

-- The team that owned the old admin-only rows (SourceCo).
do $$
declare
  v_team uuid := (select (config -> 'backfill_team_map' ->> 'reply2_backfill')::uuid
                    from public.signal_sources where key = 'positive_responses');
begin
  if v_team is not null then
    update public.teams set signals_default_market = 'private_equity'
     where id = v_team and signals_default_market is null;

    -- Source detail → admin-only table, before payload is cleared.
    insert into public.signal_admin_details (signal_id, detail)
    select s.id, jsonb_strip_nulls(jsonb_build_object(
             'person_key', s.payload ->> 'person_key',
             'reply_excerpt', s.payload ->> 'reply_excerpt',
             'reply_date', s.payload ->> 'reply_date',
             'first_interested_at', s.payload ->> 'first_interested_at',
             'interested_rows', s.payload -> 'interested_rows',
             'platform', public.signals_platform_label(case s.payload ->> 'inference_source'
                            when 'reply2_backfill' then 'reply_io' when 'reply1_backfill' then 'reply_io'
                            when 'smartlead_backfill' then 'smartlead' else null end),
             'channel', s.payload ->> 'channel',
             'campaign_name', s.payload ->> 'campaign_name',
             'inference_source', s.payload ->> 'inference_source'))
      from public.signals s
     where s.source_key = 'positive_responses'
    on conflict (signal_id) do update set detail = excluded.detail, updated_at = now();

    update public.signals s
       set dedupe_key = 'hi:' || v_team::text || ':' || (s.payload ->> 'person_key'),
           team_id = v_team,
           visibility = 'team',
           markets = array['private_equity'],
           industry = nullif(btrim(s.payload ->> 'industry'), ''),
           seniority = nullif(btrim(s.payload ->> 'seniority'), ''),
           company_size = nullif(btrim(s.payload ->> 'company_size'), ''),
           person_name = public.signals_fix_text(s.person_name),
           person_title = public.signals_fix_text(s.person_title),
           company_name = public.signals_fix_text(s.company_name),
           title = public.signals_high_intent_title(public.signals_fix_text(s.person_name),
                     public.signals_fix_text(s.person_title), public.signals_fix_text(s.company_name)),
           url = null,
           payload = '{}'::jsonb
     where s.source_key = 'positive_responses'
       and s.payload ? 'person_key';
  end if;
end $$;

-- Remaining sources: the guard re-stamps type + default markets; repair text.
update public.signals s
   set markets = '{}',
       title = public.signals_fix_text(s.title),
       company_name = public.signals_fix_text(s.company_name),
       person_name = public.signals_fix_text(s.person_name),
       person_title = public.signals_fix_text(s.person_title),
       city = public.signals_fix_text(s.city),
       payload = case when s.payload::text ~ '[\u0080-\u009f]|Ã|Â|â€'
                      then coalesce(public.signals_fix_text(s.payload::text)::jsonb, s.payload) else s.payload end
 where s.source_key <> 'positive_responses';

-- Anything left over (a run between deploy steps) still gets a type/market.
update public.signals set markets = markets where signal_type is distinct from
  (select src.signal_type from public.signal_sources src where src.key = signals.source_key);

alter table public.signals drop constraint if exists signals_markets_check;
alter table public.signals add constraint signals_markets_check check (signals_markets_valid(markets));

-- ------------------------------------------------------------ drop vertical ---

drop index if exists public.idx_signals_vertical_time;
alter table public.signals drop column if exists vertical;
alter table public.signal_sources drop column if exists vertical;

create index if not exists idx_signals_type_time on public.signals (signal_type, occurred_at desc);
create index if not exists idx_signals_markets on public.signals using gin (markets);
create index if not exists idx_signals_hi_enrich on public.signals (source_key, enriched_at nulls first)
  where source_key = 'positive_responses';

-- Clients read signals only through the RPCs below (client-safe shape).
revoke select on public.signals from authenticated;

grant update (name, config, is_active, cadence, default_markets) on public.signal_sources to authenticated;

comment on column public.signals.signal_type is
  'Internal type key (positive_response, fda_clearance, hiring, website_visit, product_launch). Clients see signals_public_type(): positive_response = high_intent.';
comment on column public.signals.markets is 'Who the signal is relevant to: private_equity, medical_device, saas, recruiting, other. Set by _shared/signal-markets.ts.';

-- ================================================================= ingest ===

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
    'source', jsonb_build_object('key', src.key, 'signal_type', src.signal_type, 'default_markets', to_jsonb(src.default_markets),
                                 'kind', src.kind, 'cadence', src.cadence,
                                 'default_visibility', src.default_visibility, 'config', src.config)
  );
end
$$;

-- The one write path, now with markets / firmographics / admin detail.
-- Enrichable columns (industry, seniority, company_size; and for High Intent
-- also title/location) are never blanked by a later write: a source that
-- lost a value must not undo the enrichment.
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
  v_keep boolean;
begin
  select * into src from public.signal_sources where key = p_source_key;
  if not found then
    raise exception 'unknown signal source %', p_source_key;
  end if;
  v_keep := src.signal_type = 'positive_response';

  create temporary table if not exists _signals_in (
    ord integer, signal_type text, occurred_at timestamptz, company_name text, company_domain text,
    person_name text, person_title text, person_email text, person_linkedin text, city text, state text,
    country text, title text, url text, score integer, payload jsonb, dedupe_key text, visibility text, team_id uuid,
    markets text[], industry text, seniority text, company_size text, admin_detail jsonb
  ) on commit drop;
  truncate _signals_in;

  insert into _signals_in
  select x.ord::integer, r.signal_type, r.occurred_at, nullif(btrim(r.company_name), ''), nullif(lower(btrim(r.company_domain)), ''),
         nullif(btrim(r.person_name), ''), nullif(btrim(r.person_title), ''), nullif(lower(btrim(r.person_email)), ''),
         nullif(btrim(r.person_linkedin), ''), nullif(btrim(r.city), ''), nullif(btrim(r.state), ''), nullif(btrim(r.country), ''),
         left(btrim(r.title), 500), nullif(btrim(r.url), ''), greatest(0, least(100, coalesce(r.score, 0))),
         coalesce(r.payload, '{}'::jsonb), btrim(r.dedupe_key),
         case when src.default_visibility = 'admin' then 'admin' else coalesce(r.visibility, src.default_visibility) end,
         r.team_id,
         coalesce(array(select distinct lower(btrim(m)) from unnest(r.markets) m where btrim(m) <> ''), '{}'),
         nullif(btrim(r.industry), ''), nullif(btrim(r.seniority), ''), nullif(btrim(r.company_size), ''),
         r.admin_detail
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality as x(elem, ord)
    cross join lateral jsonb_to_record(x.elem) as r(
      signal_type text, occurred_at timestamptz, company_name text, company_domain text, person_name text,
      person_title text, person_email text, person_linkedin text, city text, state text, country text,
      title text, url text, score integer, payload jsonb, dedupe_key text, visibility text, team_id uuid,
      markets text[], industry text, seniority text, company_size text, admin_detail jsonb)
   where nullif(btrim(r.dedupe_key), '') is not null
     and nullif(btrim(r.title), '') is not null
     and r.occurred_at is not null
     and r.signal_type ~ '^[a-z0-9][a-z0-9_]{1,62}$'
     and (r.markets is null or cardinality(r.markets) = 0 or public.signals_markets_valid(r.markets));

  select count(*) into v_valid from _signals_in;

  with dedup as (
    select distinct on (dedupe_key) * from _signals_in order by dedupe_key, ord desc
  ), up as (
    insert into public.signals as s (
      source_key, signal_type, occurred_at, company_name, company_domain, person_name, person_title,
      person_email, person_linkedin, city, state, country, title, url, score, payload, dedupe_key, visibility, team_id,
      markets, industry, seniority, company_size)
    select p_source_key, src.signal_type, i.occurred_at, i.company_name, i.company_domain, i.person_name, i.person_title,
           i.person_email, i.person_linkedin, i.city, i.state, i.country, i.title, i.url, i.score, i.payload, i.dedupe_key,
           i.visibility, i.team_id, i.markets, i.industry, i.seniority, i.company_size
      from dedup i
    on conflict (dedupe_key) do update set
      occurred_at = excluded.occurred_at, company_name = excluded.company_name,
      company_domain = excluded.company_domain, person_name = excluded.person_name,
      person_title = case when v_keep then coalesce(excluded.person_title, s.person_title) else excluded.person_title end,
      person_email = excluded.person_email, person_linkedin = excluded.person_linkedin,
      city = case when v_keep then coalesce(excluded.city, s.city) else excluded.city end,
      state = case when v_keep then coalesce(excluded.state, s.state) else excluded.state end,
      country = case when v_keep then coalesce(excluded.country, s.country) else excluded.country end,
      title = case when v_keep and excluded.person_title is null and s.person_title is not null
                   then public.signals_high_intent_title(excluded.person_name, s.person_title, excluded.company_name)
                   else excluded.title end,
      url = excluded.url, score = excluded.score, payload = excluded.payload,
      markets = case when cardinality(excluded.markets) > 0 then excluded.markets else s.markets end,
      industry = coalesce(excluded.industry, s.industry),
      seniority = coalesce(excluded.seniority, s.seniority),
      company_size = coalesce(excluded.company_size, s.company_size)
    where s.source_key = excluded.source_key
      and (s.occurred_at, s.company_name, s.company_domain, s.person_name, s.person_title,
           s.person_email, s.person_linkedin, s.city, s.state, s.country, s.title, s.url, s.score, s.payload,
           s.markets, s.industry, s.seniority, s.company_size)
          is distinct from
          (excluded.occurred_at, excluded.company_name, excluded.company_domain,
           excluded.person_name,
           case when v_keep then coalesce(excluded.person_title, s.person_title) else excluded.person_title end,
           excluded.person_email, excluded.person_linkedin,
           case when v_keep then coalesce(excluded.city, s.city) else excluded.city end,
           case when v_keep then coalesce(excluded.state, s.state) else excluded.state end,
           case when v_keep then coalesce(excluded.country, s.country) else excluded.country end,
           case when v_keep and excluded.person_title is null and s.person_title is not null
                then public.signals_high_intent_title(excluded.person_name, s.person_title, excluded.company_name)
                else excluded.title end,
           excluded.url, excluded.score, excluded.payload,
           case when cardinality(excluded.markets) > 0 then excluded.markets else s.markets end,
           coalesce(excluded.industry, s.industry), coalesce(excluded.seniority, s.seniority),
           coalesce(excluded.company_size, s.company_size))
    returning (xmax = 0) as is_insert
  )
  select count(*) filter (where is_insert), count(*) filter (where not is_insert) into v_inserted, v_updated from up;

  -- Admin-only detail, after the rows exist (a CTE would not see new ids).
  insert into public.signal_admin_details as d (signal_id, detail, updated_at)
  select s.id, jsonb_strip_nulls(i.admin_detail), now()
    from (select distinct on (dedupe_key) * from _signals_in order by dedupe_key, ord desc) i
    join public.signals s on s.dedupe_key = i.dedupe_key and s.source_key = p_source_key
   where i.admin_detail is not null and jsonb_typeof(i.admin_detail) = 'object'
  on conflict (signal_id) do update set detail = excluded.detail, updated_at = now()
   where d.detail is distinct from excluded.detail;

  return jsonb_build_object(
    'received', v_received,
    'inserted', v_inserted,
    'updated', v_updated,
    'deduped', v_valid - v_inserted - v_updated,
    'rejected', v_received - v_valid
  );
end
$$;

-- ============================================== High Intent: candidates ===

drop function if exists public.signals_pe_candidates(jsonb, timestamptz, text, integer);

-- Reply.io account id → the one Vrelly team using it (ambiguous → none).
create or replace function public.signals_reply_team_map()
returns table (provider_team_id text, team_id uuid)
language sql stable security definer set search_path = public
as $$
  select oi.reply_team_id::text, (array_agg(distinct oi.team_id))[1]
    from public.outbound_integrations oi
   where oi.platform = 'reply.io' and oi.reply_team_id is not null and oi.team_id is not null
   group by oi.reply_team_id::text
  having count(distinct oi.team_id) = 1
$$;

-- inference_events 'interested' rows with the team that received each reply
-- (scope_team; null = no team found → admin-only) and a per-row platform.
create or replace function public.signals_hi_rows(p_config jsonb)
returns table (
  id uuid, scope_team uuid, person_key text, occurred_at timestamptz, created_at timestamptz,
  full_name text, job_title text, seniority text, company_name text, company_domain text, industry text,
  company_size text, city text, state text, country text, email text, linkedin_url text, keywords text,
  channel text, campaign_name text, source text, reply_text text, platform text
)
language sql stable security definer set search_path = public
as $$
  select e.id,
         -- only a team that still exists (a deleted one → admin scope, never an FK failure)
         (select t.id from public.teams t
           where t.id = coalesce(e.team_id, nullif(p_config -> 'backfill_team_map' ->> e.source, '')::uuid, m.team_id)),
         e.person_key, e.occurred_at, e.created_at,
         e.full_name, e.job_title, e.seniority, e.company_name, e.metadata ->> 'company_domain', e.industry,
         e.company_size, e.city, e.state, e.country, e.email, e.linkedin_url, e.metadata ->> 'company_keywords',
         e.channel, e.campaign_name, e.source, e.metadata ->> 'reply_text',
         public.signals_platform_label(coalesce(l.source, e.metadata ->> 'provider'))
    from public.inference_events e
    left join public.signals_reply_team_map() m
      on e.team_id is null and m.provider_team_id = e.metadata ->> 'provider_team_id'
    left join lateral (
      select al.source from public.agent_leads al
       where al.id = case when e.source_row_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                          then e.source_row_id::uuid end
    ) l on true
   where e.intent = 'interested'
     and coalesce(e.person_key, '') <> ''
$$;

-- One row per (team scope, person_key), newest non-empty value of each field.
-- p_since null = everyone (backfill); keyset-paged on scope_key.
create or replace function public.signals_positive_candidates(
  p_config jsonb, p_since timestamptz default null, p_after text default null, p_limit integer default 500
)
returns table (
  scope_key text, team_id uuid, team_default_market text, person_key text, last_at timestamptz, first_at timestamptz,
  interested_rows integer, full_name text, job_title text, seniority text, company_name text, company_domain text,
  industry text, company_size text, city text, state text, country text, email text, linkedin_url text,
  keywords text, platform text, channel text, campaign_name text, source text, reply_text text
)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_chars integer := coalesce((p_config ->> 'excerpt_chars')::integer, 280);
begin
  return query
  with k as (
    select r.*, coalesce(r.scope_team::text, 'admin') || ':' || r.person_key as sk
      from public.signals_hi_rows(p_config) r
  ),
  persons as (
    select k.sk from k
     where (p_since is null or k.created_at >= p_since or k.occurred_at >= p_since)
       and (p_after is null or k.sk > p_after)
     group by k.sk
     order by k.sk
     limit least(greatest(coalesce(p_limit, 500), 1), 2000)
  )
  select k.sk, (array_agg(k.scope_team))[1], (array_agg(t.signals_default_market))[1], (array_agg(k.person_key))[1],
         max(k.occurred_at), min(k.occurred_at), count(*)::integer,
         (array_agg(k.full_name order by k.occurred_at desc) filter (where nullif(btrim(k.full_name), '') is not null))[1],
         (array_agg(k.job_title order by k.occurred_at desc) filter (where nullif(btrim(k.job_title), '') is not null))[1],
         (array_agg(k.seniority order by k.occurred_at desc) filter (where nullif(btrim(k.seniority), '') is not null))[1],
         (array_agg(k.company_name order by k.occurred_at desc) filter (where nullif(btrim(k.company_name), '') is not null))[1],
         (array_agg(k.company_domain order by k.occurred_at desc) filter (where nullif(btrim(k.company_domain), '') is not null))[1],
         (array_agg(k.industry order by k.occurred_at desc) filter (where nullif(btrim(k.industry), '') is not null))[1],
         (array_agg(k.company_size order by k.occurred_at desc) filter (where nullif(btrim(k.company_size), '') is not null))[1],
         (array_agg(k.city order by k.occurred_at desc) filter (where nullif(btrim(k.city), '') is not null))[1],
         (array_agg(k.state order by k.occurred_at desc) filter (where nullif(btrim(k.state), '') is not null))[1],
         (array_agg(k.country order by k.occurred_at desc) filter (where nullif(btrim(k.country), '') is not null))[1],
         (array_agg(k.email order by k.occurred_at desc) filter (where nullif(btrim(k.email), '') is not null))[1],
         (array_agg(k.linkedin_url order by k.occurred_at desc) filter (where nullif(btrim(k.linkedin_url), '') is not null))[1],
         (array_agg(k.keywords order by k.occurred_at desc) filter (where nullif(btrim(k.keywords), '') is not null))[1],
         (array_agg(k.platform order by k.occurred_at desc) filter (where k.platform is not null))[1],
         (array_agg(k.channel order by k.occurred_at desc))[1],
         (array_agg(k.campaign_name order by k.occurred_at desc) filter (where nullif(btrim(k.campaign_name), '') is not null))[1],
         (array_agg(k.source order by k.occurred_at desc))[1],
         (array_agg(left(k.reply_text, v_chars) order by k.occurred_at desc)
            filter (where nullif(btrim(k.reply_text), '') is not null))[1]
    from k
    join persons p on p.sk = k.sk
    left join public.teams t on t.id = k.scope_team
   group by k.sk
   order by k.sk;
end
$$;

-- ============================================== High Intent: enrichment ===

-- What to enrich this run: never-enriched and changed-since-enrichment
-- signals first, then (teams with Apollo on) signals Apollo has not finished.
create or replace function public.signals_hi_enrichment_queue(p_limit integer default 500)
returns table (
  signal_id uuid, team_id uuid, team_default_market text, person_key text, person_name text, company_name text,
  company_domain text, email text, linkedin text, industry text, person_title text, seniority text, city text,
  state text, country text, company_size text, keywords text, apollo_done boolean, free_done boolean
)
language sql stable security definer set search_path = public
as $$
  select s.id, s.team_id, t.signals_default_market, d.detail ->> 'person_key', s.person_name, s.company_name,
         s.company_domain, s.person_email, s.person_linkedin, s.industry, s.person_title, s.seniority, s.city,
         s.state, s.country, s.company_size, null::text,
         coalesce(s.enrichment ->> 'apollo_status', '') in ('not_needed', 'matched', 'no_match', 'no_identifier'),
         s.enriched_at is not null
    from public.signals s
    left join public.signal_admin_details d on d.signal_id = s.id
    left join public.teams t on t.id = s.team_id
   where s.source_key = 'positive_responses'
     and d.detail ? 'person_key'
     and (s.enriched_at is null
          or s.enriched_at < s.updated_at
          or (coalesce(t.signals_apollo_enrich, false)
              and coalesce(s.enrichment ->> 'apollo_status', '') not in ('not_needed', 'matched', 'no_match', 'no_identifier')
              and coalesce((s.enrichment ->> 'apollo_at')::timestamptz, '-infinity') < now() - interval '6 hours'))
   order by (s.enriched_at is null) desc, (s.enriched_at < s.updated_at) desc, s.occurred_at desc
   limit least(greatest(coalesce(p_limit, 500), 1), 5000)
$$;

-- Free lookups for a batch: Vrelly prospects by email (person + company),
-- by company domain (company: the most common industry / size), and the
-- person's other inference rows in the SAME team scope.
create or replace function public.signals_hi_free_lookups(p_emails text[], p_domains text[], p_signal_ids uuid[])
returns jsonb
language plpgsql stable security definer set search_path = public
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

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_domain from (
    select d.domain,
           mode() within group (order by nullif(btrim(p.company_industry), '')) as industry,
           mode() within group (order by coalesce(nullif(btrim(p.company_size), ''), nullif(btrim(p.company_size_range), ''))) as company_size,
           (array_agg(p.keywords) filter (where nullif(btrim(p.keywords), '') is not null))[1] as keywords
      from (select distinct lower(btrim(d0)) as domain, public.signals_domain_key(d0) as dkey
              from unnest(coalesce(p_domains, '{}')) d0 where btrim(d0) <> '') d
      join public.prospects p on public.signals_domain_key(p.company_domain) = d.dkey
     group by d.domain
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

-- Per team: Apollo opt-in, and whose agent config / key / cap it spends.
create or replace function public.signals_hi_team_apollo(p_team_ids uuid[])
returns table (team_id uuid, enabled boolean, user_id uuid, agent_config_id uuid)
language sql stable security definer set search_path = public
as $$
  select t.id, t.signals_apollo_enrich, c.user_id, c.id
    from public.teams t
    left join lateral (
      select ac.id, ac.user_id from public.agent_configs ac
        join public.team_memberships tm on tm.user_id = ac.user_id
       where tm.team_id = t.id
       order by ac.created_at limit 1
    ) c on true
   where t.id = any(coalesce(p_team_ids, '{}'))
$$;

-- Store a batch of enrichment results: on the signal (empty fields only;
-- markets/title recomputed by the caller), then into the backing
-- inference_events rows' EMPTY fields only (same team scope, 'interested').
create or replace function public.signals_hi_apply_enrichment(p_rows jsonb, p_config jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_config jsonb := coalesce(p_config, (select config from public.signal_sources where key = 'positive_responses'));
  v_signals integer := 0;
  v_inf integer := 0;
begin
  create temporary table if not exists _hi_enrich (
    signal_id uuid primary key, industry text, person_title text, seniority text, city text, state text,
    country text, company_size text, markets text[], title text, filled jsonb, apollo_status text
  ) on commit drop;
  truncate _hi_enrich;

  insert into _hi_enrich
  select (r ->> 'signal_id')::uuid,
         nullif(btrim(r -> 'values' ->> 'industry'), ''), nullif(btrim(r -> 'values' ->> 'person_title'), ''),
         nullif(btrim(r -> 'values' ->> 'seniority'), ''), nullif(btrim(r -> 'values' ->> 'city'), ''),
         nullif(btrim(r -> 'values' ->> 'state'), ''), nullif(btrim(r -> 'values' ->> 'country'), ''),
         nullif(btrim(r -> 'values' ->> 'company_size'), ''),
         case when jsonb_typeof(r -> 'markets') = 'array'
              then array(select jsonb_array_elements_text(r -> 'markets')) end,
         nullif(btrim(r ->> 'title'), ''),
         coalesce(r -> 'filled', '{}'::jsonb),
         nullif(r ->> 'apollo_status', '')
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
   where (r ->> 'signal_id') ~* '^[0-9a-f-]{36}$'
  on conflict (signal_id) do nothing;

  with u as (
    update public.signals s set
      industry = coalesce(s.industry, x.industry),
      person_title = coalesce(s.person_title, x.person_title),
      seniority = coalesce(s.seniority, x.seniority),
      city = coalesce(s.city, x.city),
      state = coalesce(s.state, x.state),
      country = coalesce(s.country, x.country),
      company_size = coalesce(s.company_size, x.company_size),
      markets = case when public.signals_markets_valid(x.markets) then x.markets else s.markets end,
      title = coalesce(x.title, s.title),
      enriched_at = now(),
      enrichment = s.enrichment
        || jsonb_build_object('enriched_at', now(), 'filled', coalesce(s.enrichment -> 'filled', '{}'::jsonb) || x.filled)
        || case when x.apollo_status is not null
                then jsonb_build_object('apollo_status', x.apollo_status, 'apollo_at', now()) else '{}'::jsonb end
      from _hi_enrich x
     where s.id = x.signal_id and s.source_key = 'positive_responses'
    returning s.id
  )
  select count(*) into v_signals from u;

  with tgt as (
    select s.id, s.team_id, d.detail ->> 'person_key' as person_key,
           s.industry, s.person_title, s.seniority, s.city, s.state, s.country, s.company_size
      from _hi_enrich x
      join public.signals s on s.id = x.signal_id
      join public.signal_admin_details d on d.signal_id = s.id
     where d.detail ? 'person_key'
  ), w as (
    update public.inference_events e set
      job_title = case when nullif(btrim(e.job_title), '') is null then t.person_title else e.job_title end,
      seniority = case when nullif(btrim(e.seniority), '') is null then t.seniority else e.seniority end,
      industry = case when nullif(btrim(e.industry), '') is null then t.industry else e.industry end,
      city = case when nullif(btrim(e.city), '') is null then t.city else e.city end,
      state = case when nullif(btrim(e.state), '') is null then t.state else e.state end,
      country = case when nullif(btrim(e.country), '') is null then t.country else e.country end,
      company_size = case when nullif(btrim(e.company_size), '') is null then t.company_size else e.company_size end
      from tgt t
     where e.person_key = t.person_key
       and e.intent = 'interested'
       and coalesce(e.team_id, nullif(v_config -> 'backfill_team_map' ->> e.source, '')::uuid,
                    (select m.team_id from public.signals_reply_team_map() m
                      where e.team_id is null and m.provider_team_id = e.metadata ->> 'provider_team_id'))
           is not distinct from t.team_id
       and ((nullif(btrim(e.job_title), '') is null and t.person_title is not null)
         or (nullif(btrim(e.seniority), '') is null and t.seniority is not null)
         or (nullif(btrim(e.industry), '') is null and t.industry is not null)
         or (nullif(btrim(e.city), '') is null and t.city is not null)
         or (nullif(btrim(e.state), '') is null and t.state is not null)
         or (nullif(btrim(e.country), '') is null and t.country is not null)
         or (nullif(btrim(e.company_size), '') is null and t.company_size is not null))
    returning 1
  )
  select count(*) into v_inf from w;

  return jsonb_build_object('signals', v_signals, 'inference_rows', v_inf);
end
$$;

-- ======================================================= website visitors ===

drop function if exists public.signals_pixel_visits(timestamptz);
create function public.signals_pixel_visits(p_since timestamptz)
returns table (
  site_key text, team_id uuid, team_default_market text, domain text, anon_id text, day date, first_ts timestamptz,
  last_ts timestamptz, pages integer, urls text[], referrer text, user_agent text, resolved jsonb
)
language sql stable security definer set search_path = public
as $$
  select h.site_key, h.team_id, t.signals_default_market, s.domain, h.anon_id, (h.ts at time zone 'utc')::date as day,
         min(h.ts), max(h.ts), count(*)::integer,
         (array_agg(distinct h.url))[1:25],
         (array_agg(h.referrer order by h.ts) filter (where h.referrer is not null))[1],
         (array_agg(h.user_agent order by h.ts desc))[1],
         (array_agg(h.resolved order by h.ts desc) filter (where h.resolved is not null))[1]
    from public.signal_pixel_hits h
    join public.signal_sites s on s.site_key = h.site_key
    left join public.teams t on t.id = h.team_id
   where h.anon_id is not null
     and (h.ts at time zone 'utc')::date >= (p_since at time zone 'utc')::date
   group by h.site_key, h.team_id, t.signals_default_market, s.domain, h.anon_id, (h.ts at time zone 'utc')::date
$$;

-- ============================================================ read side ===
-- Every client read is SECURITY DEFINER with the visibility rule applied
-- explicitly (admins: all; others: all_clients + their teams' 'team' rows),
-- and a client-safe row shape. p_filters (all optional):
--   type            public or internal key ('high_intent' ok)
--   markets         text[] any of
--   from, to        timestamptz (to exclusive)
--   min_score       int
--   status          new | reviewed | dismissed | pushed (null = all but dismissed)
--   state           ilike
--   country         ISO alpha-2 (or a name); include_unknown_country (default true)
--   search          company / person / title / domain / city (never admin detail)
--   industry, seniority, title, company_size   exact (breakdown clicks)
--   platform, campaign, source_key, team_id    admin only (ignored for clients)

create or replace function public.signals_filtered(p_uid uuid, p_filters jsonb)
returns table (s public.signals, team_status text, status_updated_at timestamptz, is_admin boolean)
language plpgsql stable security definer set search_path = public
as $$
declare
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_admin boolean;
  v_teams uuid[];
  v_team uuid;
  v_type text := nullif(public.signals_internal_type(f ->> 'type'), '');
  v_markets text[] := case when jsonb_typeof(f -> 'markets') = 'array'
                           then nullif(array(select lower(btrim(x)) from jsonb_array_elements_text(f -> 'markets') x where btrim(x) <> ''), '{}') end;
  v_country text := case when nullif(btrim(f ->> 'country'), '') is null then null
                         else coalesce(public.signals_country_code(f ->> 'country'), upper(btrim(f ->> 'country'))) end;
  v_unknown boolean := coalesce((f ->> 'include_unknown_country')::boolean, true);
  v_search text := nullif(btrim(f ->> 'search'), '');
begin
  if p_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  v_admin := coalesce((select pr.is_platform_admin from public.profiles pr where pr.id = p_uid), false);
  v_teams := array(select m.team_id from public.team_memberships m where m.user_id = p_uid);
  v_team := (select m.team_id from public.team_memberships m where m.user_id = p_uid order by m.created_at limit 1);
  return query
  select x, coalesce(ts.status, 'new'), ts.updated_at, v_admin
    from public.signals x
    left join public.signal_team_status ts on ts.signal_id = x.id and ts.team_id = v_team
    left join public.signal_admin_details d on v_admin and d.signal_id = x.id
   where (v_admin or x.visibility = 'all_clients' or (x.visibility = 'team' and x.team_id = any(v_teams)))
     and (v_type is null or x.signal_type = v_type)
     and (v_markets is null or x.markets && v_markets)
     and (f ->> 'from' is null or x.occurred_at >= (f ->> 'from')::timestamptz)
     and (f ->> 'to' is null or x.occurred_at < (f ->> 'to')::timestamptz)
     and (f ->> 'min_score' is null or x.score >= (f ->> 'min_score')::integer)
     and (case when nullif(f ->> 'status', '') is null then coalesce(ts.status, 'new') <> 'dismissed'
               when f ->> 'status' = 'any' then true
               else coalesce(ts.status, 'new') = f ->> 'status' end)
     and (nullif(btrim(f ->> 'state'), '') is null or x.state ilike btrim(f ->> 'state'))
     and (v_country is null or x.country_code = v_country or (v_unknown and x.country_code is null))
     and (v_search is null or
          (coalesce(x.title, '') || ' ' || coalesce(x.company_name, '') || ' ' || coalesce(x.company_domain, '') || ' ' ||
           coalesce(x.person_name, '') || ' ' || coalesce(x.person_title, '') || ' ' || coalesce(x.city, ''))
            ilike '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%')
     and (f ->> 'industry' is null or coalesce(x.industry, '(unknown)') = f ->> 'industry')
     and (f ->> 'seniority' is null or coalesce(x.seniority, '(unknown)') = f ->> 'seniority')
     and (f ->> 'title' is null or coalesce(lower(x.person_title), '(unknown)') = lower(f ->> 'title'))
     and (f ->> 'company_size' is null or coalesce(x.company_size, '(unknown)') = f ->> 'company_size')
     and (f ->> 'breakdown_state' is null or coalesce(x.state, '(unknown)') = f ->> 'breakdown_state')
     and (f ->> 'breakdown_country' is null or coalesce(x.country_code, '(unknown)') = f ->> 'breakdown_country')
     and (not v_admin or f ->> 'source_key' is null or x.source_key = f ->> 'source_key')
     and (not v_admin or f ->> 'team_id' is null or x.team_id = (f ->> 'team_id')::uuid)
     and (not v_admin or f ->> 'platform' is null or coalesce(d.detail ->> 'platform', '(unknown)') = f ->> 'platform')
     and (not v_admin or f ->> 'campaign' is null or coalesce(d.detail ->> 'campaign_name', '(unknown)') = f ->> 'campaign');
end
$$;
revoke all on function public.signals_filtered(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.signals_filtered(uuid, jsonb) to service_role;

-- The client-safe shape of one row. Admins additionally get the internal
-- type/source, visibility, team and the admin-only source detail.
create or replace function public.signals_row_json(
  p_s public.signals, p_team_status text, p_status_updated_at timestamptz, p_admin boolean
)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
      'id', p_s.id, 'type', public.signals_public_type(p_s.signal_type), 'markets', to_jsonb(p_s.markets),
      'occurred_at', p_s.occurred_at, 'title', p_s.title,
      'url', case when p_s.signal_type = 'positive_response' then null else p_s.url end,
      'score', p_s.score,
      'company_name', p_s.company_name, 'company_domain', p_s.company_domain,
      'person_name', p_s.person_name, 'person_title', p_s.person_title, 'person_email', p_s.person_email,
      'person_linkedin', p_s.person_linkedin, 'city', p_s.city, 'state', p_s.state, 'country', p_s.country,
      'country_code', p_s.country_code, 'industry', p_s.industry, 'seniority', p_s.seniority,
      'company_size', p_s.company_size,
      'payload', case when p_s.signal_type = 'positive_response' then '{}'::jsonb else p_s.payload end,
      'team_status', p_team_status, 'status_updated_at', p_status_updated_at, 'created_at', p_s.created_at)
   || case when p_admin then jsonb_build_object(
        'signal_type', p_s.signal_type, 'source_key', p_s.source_key, 'visibility', p_s.visibility,
        'team_id', p_s.team_id, 'team_name', (select t.name from public.teams t where t.id = p_s.team_id),
        'enrichment', p_s.enrichment,
        'admin_detail', (select d.detail from public.signal_admin_details d where d.signal_id = p_s.id))
      else '{}'::jsonb end
$$;
revoke all on function public.signals_row_json(public.signals, text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.signals_row_json(public.signals, text, timestamptz, boolean) to service_role;

drop function if exists public.signals_overview();
create or replace function public.signals_overview(p_filters jsonb default '{}'::jsonb)
returns jsonb
language sql stable security definer set search_path = public
as $$
  -- Counts per type under the market/country/search filters (every status;
  -- the date window is the counts' own).
  with f as (
    select r.s, r.team_status from public.signals_filtered(auth.uid(),
      coalesce(p_filters, '{}'::jsonb) - 'type' - 'from' - 'to' || jsonb_build_object('status', 'any')) r
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'type', public.signals_public_type(c.signal_type), 'today', c.today, 'd7', c.d7, 'd30', c.d30,
           'total', c.total, 'new', c.new_for_team) order by c.signal_type), '[]'::jsonb)
    from (
      select (f.s).signal_type,
             count(*) filter (where (f.s).occurred_at >= date_trunc('day', now())) as today,
             count(*) filter (where (f.s).occurred_at >= now() - interval '7 days') as d7,
             count(*) filter (where (f.s).occurred_at >= now() - interval '30 days') as d30,
             count(*) as total,
             count(*) filter (where f.team_status = 'new') as new_for_team
        from f group by (f.s).signal_type
    ) c
$$;

drop function if exists public.signals_feed(text, timestamptz, timestamptz, integer, text, text, text, text, text, integer, integer);
create or replace function public.signals_feed(p_filters jsonb, p_limit integer default 50, p_offset integer default 0)
returns jsonb
language sql stable security definer set search_path = public
as $$
  with g as (select * from public.signals_filtered(auth.uid(), p_filters))
  select jsonb_build_object(
    'total', (select count(*) from g),
    'rows', coalesce((
      select jsonb_agg(public.signals_row_json(r.s, r.team_status, r.status_updated_at, r.is_admin)
                       order by (r.s).occurred_at desc, (r.s).id)
        from (select * from g order by (g.s).occurred_at desc, (g.s).id
               limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) r
    ), '[]'::jsonb)
  )
$$;

-- Breakdown counts for the filtered set (High Intent panel): industry,
-- seniority, title, state, country, company size; admins also platform and
-- campaign. Top 15 per dimension, '(unknown)' for blanks — the values are
-- exactly what the matching filter key accepts.
create or replace function public.signals_breakdown(p_filters jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_admin boolean := coalesce((select pr.is_platform_admin from public.profiles pr where pr.id = auth.uid()), false);
  v_out jsonb;
begin
  create temporary table if not exists _sb (id uuid, industry text, seniority text, title text, state text,
    country text, company_size text, platform text, campaign text) on commit drop;
  truncate _sb;
  insert into _sb
  select (r.s).id, coalesce((r.s).industry, '(unknown)'), coalesce((r.s).seniority, '(unknown)'),
         coalesce(lower((r.s).person_title), '(unknown)'), coalesce((r.s).state, '(unknown)'),
         coalesce((r.s).country_code, '(unknown)'), coalesce((r.s).company_size, '(unknown)'),
         case when v_admin then coalesce(d.detail ->> 'platform', '(unknown)') end,
         case when v_admin then coalesce(d.detail ->> 'campaign_name', '(unknown)') end
    from public.signals_filtered(auth.uid(), p_filters) r
    left join public.signal_admin_details d on v_admin and d.signal_id = (r.s).id;

  select jsonb_build_object(
    'total', (select count(*) from _sb),
    'industry', (select coalesce(jsonb_agg(jsonb_build_object('value', v, 'count', n) order by n desc, v), '[]') from (select industry v, count(*) n from _sb group by 1 order by 2 desc, 1 limit 15) a),
    'seniority', (select coalesce(jsonb_agg(jsonb_build_object('value', v, 'count', n) order by n desc, v), '[]') from (select seniority v, count(*) n from _sb group by 1 order by 2 desc, 1 limit 15) a),
    'title', (select coalesce(jsonb_agg(jsonb_build_object('value', v, 'count', n) order by n desc, v), '[]') from (select title v, count(*) n from _sb group by 1 order by 2 desc, 1 limit 15) a),
    'state', (select coalesce(jsonb_agg(jsonb_build_object('value', v, 'count', n) order by n desc, v), '[]') from (select state v, count(*) n from _sb group by 1 order by 2 desc, 1 limit 15) a),
    'country', (select coalesce(jsonb_agg(jsonb_build_object('value', v, 'count', n) order by n desc, v), '[]') from (select country v, count(*) n from _sb group by 1 order by 2 desc, 1 limit 15) a),
    'company_size', (select coalesce(jsonb_agg(jsonb_build_object('value', v, 'count', n) order by n desc, v), '[]') from (select company_size v, count(*) n from _sb group by 1 order by 2 desc, 1 limit 15) a)
  ) || case when v_admin then jsonb_build_object(
    'platform', (select coalesce(jsonb_agg(jsonb_build_object('value', v, 'count', n) order by n desc, v), '[]') from (select platform v, count(*) n from _sb group by 1 order by 2 desc, 1 limit 15) a),
    'campaign', (select coalesce(jsonb_agg(jsonb_build_object('value', v, 'count', n) order by n desc, v), '[]') from (select campaign v, count(*) n from _sb group by 1 order by 2 desc, 1 limit 15) a)
  ) else '{}'::jsonb end into v_out;
  return v_out;
end
$$;

-- The caller's team defaults for the Signals page (country filter).
create or replace function public.signals_my_settings()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'team_id', t.id, 'country', coalesce(t.signals_country, 'US'), 'default_market', t.signals_default_market,
    'is_admin', public.signals_is_admin())
    from (select 1) one
    left join public.teams t on t.id = public.signals_my_team_id()
$$;

-- Admin: per-team Signals settings.
create or replace function public.signals_admin_teams()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.signals_is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'team_id', t.id, 'name', t.name, 'default_market', t.signals_default_market,
      'country', t.signals_country, 'apollo_enrich', t.signals_apollo_enrich,
      'high_intent', (select count(*) from public.signals s where s.team_id = t.id and s.signal_type = 'positive_response'))
      order by t.name) from public.teams t), '[]'::jsonb);
end
$$;

create or replace function public.signals_admin_set_team(
  p_team_id uuid, p_default_market text, p_country text, p_apollo_enrich boolean
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.signals_is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  update public.teams
     set signals_default_market = nullif(btrim(p_default_market), ''),
         signals_country = upper(nullif(btrim(p_country), '')),
         signals_apollo_enrich = coalesce(p_apollo_enrich, false)
   where id = p_team_id;
  if not found then
    raise exception 'unknown team %', p_team_id;
  end if;
end
$$;

-- ==================================================== audience candidates ===
-- As 20261013120000, with vertical replaced by type + markets. Output is the
-- client-safe shape (public type key, no source key, High Intent payload {}).
-- p_query: signal_types (INTERNAL keys), markets, since, min_score,
-- fda_product_codes, fda_device_regexes, fda_state_keys (fda_clearance),
-- hiring_role_regexes (hiring), launch_topics (product_launch).

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
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_admin boolean;
  v_teams uuid[];
  v_team uuid;
  v_types text[]; v_markets text[]; v_codes text[]; v_dev text[]; v_states text[]; v_roles text[]; v_topics text[];
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

  select array_agg(public.signals_internal_type(x)) into v_types from jsonb_array_elements_text(case when jsonb_typeof(p_query -> 'signal_types') = 'array' then p_query -> 'signal_types' else '[]' end) x where btrim(x) <> '';
  select array_agg(lower(x)) into v_markets from jsonb_array_elements_text(case when jsonb_typeof(p_query -> 'markets') = 'array' then p_query -> 'markets' else '[]' end) x where btrim(x) <> '';
  select array_agg(x) into v_codes from jsonb_array_elements_text(case when jsonb_typeof(p_query -> 'fda_product_codes') = 'array' then p_query -> 'fda_product_codes' else '[]' end) x where btrim(x) <> '';
  select array_agg(x) into v_dev from jsonb_array_elements_text(case when jsonb_typeof(p_query -> 'fda_device_regexes') = 'array' then p_query -> 'fda_device_regexes' else '[]' end) x where btrim(x) <> '';
  select array_agg(x) into v_states from jsonb_array_elements_text(case when jsonb_typeof(p_query -> 'fda_state_keys') = 'array' then p_query -> 'fda_state_keys' else '[]' end) x where btrim(x) <> '';
  select array_agg(x) into v_roles from jsonb_array_elements_text(case when jsonb_typeof(p_query -> 'hiring_role_regexes') = 'array' then p_query -> 'hiring_role_regexes' else '[]' end) x where btrim(x) <> '';
  select array_agg(x) into v_topics from jsonb_array_elements_text(case when jsonb_typeof(p_query -> 'launch_topics') = 'array' then p_query -> 'launch_topics' else '[]' end) x where btrim(x) <> '';
  v_since := coalesce((p_query ->> 'since')::timestamptz, now() - interval '30 days');
  v_min := coalesce((p_query ->> 'min_score')::integer, 0);

  create temporary table if not exists _sac (id uuid primary key) on commit drop;
  truncate _sac;
  insert into _sac
  select s.id
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
         and (v_types is null or s.signal_type = any(v_types))
         and (v_markets is null or s.markets && v_markets)
         and (s.signal_type <> 'fda_clearance' or (
               (v_codes is null or upper(s.payload ->> 'product_code') = any(v_codes))
           and (v_dev is null or coalesce(s.payload ->> 'device_name', '') ~* any(v_dev))
           and (v_states is null or lower(btrim(s.state)) = any(v_states))))
         and (s.signal_type <> 'hiring' or v_roles is null or coalesce(s.payload ->> 'job_title', '') ~* any(v_roles))
         and (s.signal_type <> 'product_launch' or v_topics is null or exists (
               select 1 from jsonb_array_elements_text(case when jsonb_typeof(s.payload -> 'topics') = 'array' then s.payload -> 'topics' else '[]' end) t
                where lower(t) = any(v_topics)))
       end);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id, 'type', public.signals_public_type(b.signal_type), 'markets', to_jsonb(b.markets),
           'occurred_at', b.occurred_at, 'title', b.title,
           'url', case when b.signal_type = 'positive_response' then null else b.url end, 'score', b.score,
           'company_name', b.company_name, 'company_domain', b.company_domain,
           'person_name', b.person_name, 'person_title', b.person_title,
           'has_person_email', b.person_email is not null,
           'city', b.city, 'state', b.state, 'country', b.country,
           'industry', b.industry, 'seniority', b.seniority, 'company_size', b.company_size,
           'payload', case when b.signal_type = 'positive_response' then '{}'::jsonb else b.payload end)
         order by b.score desc, b.occurred_at desc, b.id), '[]'::jsonb)
    into v_rows
    from (select s.* from public.signals s join _sac c on c.id = s.id
          order by s.score desc, s.occurred_at desc, s.id
          limit greatest(0, least(coalesce(p_limit, 25), 500)) offset greatest(0, coalesce(p_offset, 0))) b;

  if p_count then
    select count(*) into v_total from _sac;
  end if;

  return jsonb_build_object('signals', v_rows, 'total', v_total);
end
$$;

-- ================================================================ grants ===

revoke all on function public.signals_fix_text(text) from public, anon;
revoke all on function public.signals_reply_team_map() from public, anon, authenticated;
revoke all on function public.signals_hi_rows(jsonb) from public, anon, authenticated;
revoke all on function public.signals_positive_candidates(jsonb, timestamptz, text, integer) from public, anon, authenticated;
revoke all on function public.signals_hi_enrichment_queue(integer) from public, anon, authenticated;
revoke all on function public.signals_hi_free_lookups(text[], text[], uuid[]) from public, anon, authenticated;
revoke all on function public.signals_hi_team_apollo(uuid[]) from public, anon, authenticated;
revoke all on function public.signals_hi_apply_enrichment(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.signals_pixel_visits(timestamptz) from public, anon, authenticated;
revoke all on function public.signals_audience_candidates(uuid, jsonb, uuid, uuid[], integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.signals_reply_team_map() to service_role;
grant execute on function public.signals_hi_rows(jsonb) to service_role;
grant execute on function public.signals_positive_candidates(jsonb, timestamptz, text, integer) to service_role;
grant execute on function public.signals_hi_enrichment_queue(integer) to service_role;
grant execute on function public.signals_hi_free_lookups(text[], text[], uuid[]) to service_role;
grant execute on function public.signals_hi_team_apollo(uuid[]) to service_role;
grant execute on function public.signals_hi_apply_enrichment(jsonb, jsonb) to service_role;
grant execute on function public.signals_pixel_visits(timestamptz) to service_role;
grant execute on function public.signals_audience_candidates(uuid, jsonb, uuid, uuid[], integer, integer, boolean) to service_role;

revoke all on function public.signals_overview(jsonb) from public, anon;
revoke all on function public.signals_feed(jsonb, integer, integer) from public, anon;
revoke all on function public.signals_breakdown(jsonb) from public, anon;
revoke all on function public.signals_my_settings() from public, anon;
revoke all on function public.signals_admin_teams() from public, anon;
revoke all on function public.signals_admin_set_team(uuid, text, text, boolean) from public, anon;
grant execute on function public.signals_overview(jsonb) to authenticated;
grant execute on function public.signals_feed(jsonb, integer, integer) to authenticated;
grant execute on function public.signals_breakdown(jsonb) to authenticated;
grant execute on function public.signals_my_settings() to authenticated;
grant execute on function public.signals_admin_teams() to authenticated;
grant execute on function public.signals_admin_set_team(uuid, text, text, boolean) to authenticated;
