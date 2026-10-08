-- Admin → Inference: server-side aggregation.
--
-- The Inference tab used to page every replied / classified / sent row into the
-- browser (parallel 1000-row offset pages, ~45k rows) and aggregate there. This
-- function does the same aggregation in Postgres and returns only the grouped
-- numbers the tab renders, in one call:
--
--   baseline        stats over the filtered replies (source + date range)
--   segment_stats   stats over the focused segment (p_segment), or the baseline
--   segments        explorer rows grouped by p_dims (1-3 dimensions)
--   covered         replies with known values for every p_dim (or all, with unknowns)
--   suggestions     candidate segments for auto-deductions: single dimensions and
--                   pairs (GROUPING SETS), n >= 30, lift > 1, pairs only when they
--                   beat both of their single-dimension parents. Two lists of up to
--                   300: 'all', and 'unbiased' (no enrichment-biased dimension,
--                   listed in 'biased_dims'), so the default view is not starved
--                   by the cap
--   copy            leaderboard for the focused segment (by interested count, and
--                   by interested share with n >= 30)
--   heatmap         interested replies by ET reply weekday x hour, focused segment
--   bias            per dimension: replies with a known value, interested vs rest
--
-- Semantics are those of the client code it replaces (src/lib/inferenceAnalytics.ts),
-- including tie-breaks (first appearance in id order):
--   * one row per `replied` event; origin = backfill when source = reply2_backfill
--     or metadata.backfill = 'true', else live
--   * intent = the row's own intent, else the person's newest non-backfill
--     classification
--   * send hour / weekday (ET) from reply2_backfill `sent` events joined on
--     metadata.provider_thread_id; reply hour / weekday from *_et fields
--   * dimension values are the display strings the UI shows and sends back as a
--     segment filter: '(unknown)', job titles folded to the top 25 else
--     '(other titles)', 'Step n', 'HH:00', 'Mon'..'Sun'
--
-- Admin-only (platform / super admin): anyone else gets an insufficient_privilege
-- error. SECURITY DEFINER so it reads every team's rows like the admin RLS policy
-- allows, without depending on the caller's RLS.

-- JSON value → numeric, like the client's num(): numbers, and numeric strings.
create or replace function public._ii_num(v jsonb)
returns numeric
language sql
immutable
as $$
  select case jsonb_typeof(v)
    when 'number' then (v #>> '{}')::numeric
    when 'string' then case when btrim(v #>> '{}') ~ '^-?\d+(\.\d+)?$' then btrim(v #>> '{}')::numeric end
  end;
$$;

create or replace function public.admin_inference_insights(
  p_source text default 'all',
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_dims text[] default array['industry'],
  p_include_unknown boolean default false,
  p_segment jsonb default '{}'::jsonb,
  -- 'summary' (explorer, focused segment, copy, heatmap) and/or 'suggestions'.
  -- Suggestions depend only on source + dates and cost ~1.5s at 28k replies,
  -- so the UI asks for them separately and caches them; clicking around the
  -- explorer only re-runs 'summary'. baseline and bias come with either.
  p_sections text[] default array['summary', 'suggestions']
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_cols constant jsonb := jsonb_build_object(
    'industry', 'd_industry', 'companySize', 'd_company_size', 'seniority', 'd_seniority',
    'jobTitle', 'd_job_title', 'state', 'd_state', 'channel', 'd_channel', 'step', 'd_step',
    'sendHour', 'd_send_hour', 'sendDow', 'd_send_dow');
  v_sugg_dims constant text[] := array['industry', 'companySize', 'seniority', 'state', 'channel', 'step', 'sendHour', 'sendDow'];
  v_stats constant text := $s$jsonb_build_object(
      'replies', count(*),
      'interested', count(*) filter (where intent = 'interested'),
      'not_interested', count(*) filter (where intent = 'not_interested'),
      'live', count(*) filter (where origin = 'live'),
      'median_hours', percentile_cont(0.5) within group (order by hours_to_reply),
      'hours_sample', count(hours_to_reply))$s$;
  v_dim text;
  v_col text;
  v_key text;
  v_val text;
  v_group text := '';
  v_values text := '';
  v_known text := 'true';
  v_seg text := 'true';
  v_sets text := '';
  v_sugg_values text := '';
  v_first_dim text := '';
  v_first_val text := '';
  v_first_idx text := '';
  v_last_dim text := '';
  v_biased text[] := '{}';
  v_i int;
  v_j int;
  v_baseline jsonb;
  v_rate double precision;
  v_segment_stats jsonb;
  v_segments jsonb;
  v_covered bigint;
  v_suggestions jsonb;
  v_copy jsonb;
  v_heatmap jsonb;
  v_bias jsonb;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and (p.is_platform_admin = true or p.is_super_admin = true)
  ) then
    raise exception 'admin_inference_insights: platform admins only' using errcode = '42501';
  end if;

  -- ── validate inputs (dimension names become identifiers below) ────────────
  if p_source is null or p_source not in ('all', 'live', 'backfill') then
    raise exception 'p_source must be all, live or backfill' using errcode = '22023';
  end if;
  if p_sections is null or not (p_sections <@ array['summary', 'suggestions']) or cardinality(p_sections) = 0 then
    raise exception 'p_sections must be summary and/or suggestions' using errcode = '22023';
  end if;
  if p_dims is null or cardinality(p_dims) < 1 or cardinality(p_dims) > 3 then
    raise exception 'p_dims must name 1 to 3 dimensions' using errcode = '22023';
  end if;
  foreach v_dim in array p_dims loop
    v_col := v_cols ->> v_dim;
    if v_col is null then
      raise exception 'unknown dimension %', v_dim using errcode = '22023';
    end if;
    v_group := v_group || case when v_group = '' then '' else ', ' end || quote_ident(v_col);
    v_values := v_values || case when v_values = '' then '' else ', ' end || quote_literal(v_dim) || ', ' || quote_ident(v_col);
    v_known := v_known || format(' and %I <> %L', v_col, '(unknown)');
  end loop;
  for v_key, v_val in select key, value from jsonb_each_text(coalesce(p_segment, '{}'::jsonb)) loop
    v_col := v_cols ->> v_key;
    if v_col is null then
      raise exception 'unknown segment dimension %', v_key using errcode = '22023';
    end if;
    v_seg := v_seg || format(' and %I = %L', v_col, v_val);
  end loop;

  -- ── one row per reply, with every dimension's display value ───────────────
  if to_regclass('pg_temp._ii_facts') is not null then
    drop table pg_temp._ii_facts;
  end if;
  create temp table _ii_facts (
    id uuid, origin text, channel text, occurred_at timestamptz, intent text,
    industry text, company_size text, seniority text, job_title text, state text,
    step numeric, send_hour numeric, send_dow numeric, reply_hour numeric, reply_dow numeric,
    hours_to_reply numeric, copy_key text, copy_label text,
    d_industry text, d_company_size text, d_seniority text, d_job_title text, d_state text,
    d_channel text, d_step text, d_send_hour text, d_send_dow text
  ) on commit drop;

  insert into _ii_facts (id, origin, channel, occurred_at, intent, industry, company_size, seniority, job_title, state,
                         step, send_hour, send_dow, reply_hour, reply_dow, hours_to_reply, copy_key, copy_label)
  with cls as (
    select distinct on (team_id, person_key) team_id, person_key, intent
    from public.inference_events
    where event_type = 'classified' and source <> 'reply2_backfill' and intent is not null
    order by team_id, person_key, occurred_at desc
  ), snd as (
    -- metadata is read once per row (jsonb_to_record): every `metadata -> key`
    -- would de-TOAST the whole value again, which dominated the run time.
    select distinct on (m.provider_thread_id)
      m.provider_thread_id as thread_id, m.send_hour_et as send_hour, m.send_dow_et as send_dow
    from public.inference_events e,
      lateral jsonb_to_record(e.metadata) as m(provider_thread_id text, send_hour_et jsonb, send_dow_et jsonb)
    where e.source = 'reply2_backfill' and e.event_type = 'sent' and m.provider_thread_id is not null
    order by m.provider_thread_id, e.id desc
  ), base as (
    select
      r.id,
      case when r.source = 'reply2_backfill' or m.backfill = 'true' then 'backfill' else 'live' end as origin,
      r.channel,
      r.occurred_at,
      coalesce(r.intent, c.intent) as intent,
      nullif(btrim(r.industry), '') as industry,
      nullif(btrim(r.company_size), '') as company_size,
      nullif(btrim(r.seniority), '') as seniority,
      nullif(btrim(r.job_title), '') as job_title,
      nullif(btrim(r.state), '') as state,
      coalesce(public._ii_num(m.sequence_step_number), public._ii_num(m.sequence_number)) as step,
      public._ii_num(s.send_hour) as send_hour,
      public._ii_num(s.send_dow) as send_dow,
      public._ii_num(m.reply_hour_et) as reply_hour,
      public._ii_num(m.reply_dow_et) as reply_dow,
      public._ii_num(m.hours_to_reply) as hours_to_reply,
      coalesce(r.copy_fingerprint, case when m.variant_id is null or jsonb_typeof(m.variant_id) = 'null' then null else m.variant_id #>> '{}' end) as copy_key,
      nullif(regexp_replace(  -- like JS String.trim(): all whitespace incl. NBSP / BOM
        regexp_replace(coalesce(r.subject, m.reply_subject), '^\s*((re|fw|fwd|aw)\s*:\s*)+', '', 'i'),
        '^[\s\u00a0\ufeff]+|[\s\u00a0\ufeff]+$', '', 'g'), '') as copy_label
    from public.inference_events r
    cross join lateral jsonb_to_record(r.metadata) as m(
      backfill text, sequence_step_number jsonb, sequence_number jsonb, reply_hour_et jsonb, reply_dow_et jsonb,
      hours_to_reply jsonb, variant_id jsonb, reply_subject text, provider_thread_id text)
    left join cls c on c.team_id is not distinct from r.team_id and c.person_key = r.person_key
    left join snd s on s.thread_id = m.provider_thread_id
    where r.event_type = 'replied'
  )
  select id, origin, channel, occurred_at, intent, industry, company_size, seniority, job_title, state,
         step, send_hour, send_dow, reply_hour, reply_dow, hours_to_reply, copy_key, copy_label
  from base
  where (p_source = 'all' or origin = p_source)
    and (p_from is null or occurred_at >= p_from)
    and (p_to is null or occurred_at <= p_to);

  update _ii_facts f set
    d_industry = coalesce(f.industry, '(unknown)'),
    d_company_size = coalesce(f.company_size, '(unknown)'),
    d_seniority = coalesce(f.seniority, '(unknown)'),
    d_job_title = case
      when f.job_title is null then '(unknown)'
      when f.job_title in (
        select t.job_title from _ii_facts t where t.job_title is not null
        group by t.job_title order by count(*) desc, min(t.id::text) limit 25
      ) then f.job_title
      else '(other titles)' end,
    d_state = coalesce(f.state, '(unknown)'),
    d_channel = coalesce(nullif(btrim(f.channel), ''), '(unknown)'),
    d_step = case when f.step is null then '(unknown)' else 'Step ' || trim_scale(f.step)::text end,
    d_send_hour = case when f.send_hour is null then '(unknown)' else lpad(trim_scale(f.send_hour)::text, 2, '0') || ':00' end,
    d_send_dow = case
      when f.send_dow is null then '(unknown)'
      when f.send_dow between 1 and 7 and f.send_dow = trunc(f.send_dow)
        then (array['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])[f.send_dow::int]
      else trim_scale(f.send_dow)::text end;

  -- ── baseline + focused segment ────────────────────────────────────────────
  execute format('select %s from _ii_facts', v_stats) into v_baseline;
  v_rate := case when (v_baseline ->> 'replies')::numeric > 0
    then (v_baseline ->> 'interested')::double precision / (v_baseline ->> 'replies')::double precision else 0 end;
  if 'summary' = any(p_sections) then
  execute format('select %s from _ii_facts where %s', v_stats, v_seg) into v_segment_stats;

  -- ── explorer ──────────────────────────────────────────────────────────────
  execute format(
    'select coalesce(jsonb_agg(x order by (x->>%L)::int desc), %L::jsonb) from (
       select jsonb_build_object(%L, jsonb_build_object(%s)) || %s as x
       from _ii_facts where %s group by %s
       order by count(*) desc limit 2000) q',
    'replies', '[]', 'values', v_values, v_stats,
    case when p_include_unknown then 'true' else v_known end, v_group)
  into v_segments;
  execute format('select count(*) from _ii_facts where %s', case when p_include_unknown then 'true' else v_known end)
  into v_covered;
  end if;

  -- ── suggestion candidates: singles + pairs over the fixed dimension set ──
  -- One GROUPING SETS pass; grouping() tells which dimensions a row groups by.
  -- dim_a/val_a is the first grouped dimension, dim_b/val_b the last (the same
  -- one for singles), so parents are found with plain equality joins. Order and
  -- tie-breaks follow the client: lift, replies, singles before pairs, dimension
  -- order, first appearance.
  if 'suggestions' = any(p_sections) then
  -- Enrichment-biased dimensions (same rule as biasFromCounts in the client):
  -- known for >= 20 points more of the interested replies than of the rest,
  -- with >= 30 replies on each side. The UI hides suggestions on these by
  -- default, so a second list excludes them BEFORE the 300 cap — otherwise
  -- high-lift biased combinations could fill the cap.
  select coalesce(array_agg(d.dim), '{}') into v_biased
  from (
    select
      count(*) filter (where intent = 'interested') as ni,
      count(*) filter (where intent is distinct from 'interested') as no_,
      count(*) filter (where intent = 'interested' and industry is not null) as i1, count(*) filter (where intent is distinct from 'interested' and industry is not null) as o1,
      count(*) filter (where intent = 'interested' and company_size is not null) as i2, count(*) filter (where intent is distinct from 'interested' and company_size is not null) as o2,
      count(*) filter (where intent = 'interested' and seniority is not null) as i3, count(*) filter (where intent is distinct from 'interested' and seniority is not null) as o3,
      count(*) filter (where intent = 'interested' and state is not null) as i4, count(*) filter (where intent is distinct from 'interested' and state is not null) as o4,
      count(*) filter (where intent = 'interested' and nullif(btrim(channel), '') is not null) as i5, count(*) filter (where intent is distinct from 'interested' and nullif(btrim(channel), '') is not null) as o5,
      count(*) filter (where intent = 'interested' and step is not null) as i6, count(*) filter (where intent is distinct from 'interested' and step is not null) as o6,
      count(*) filter (where intent = 'interested' and send_hour is not null) as i7, count(*) filter (where intent is distinct from 'interested' and send_hour is not null) as o7,
      count(*) filter (where intent = 'interested' and send_dow is not null) as i8, count(*) filter (where intent is distinct from 'interested' and send_dow is not null) as o8
    from _ii_facts
  ) c
  cross join lateral (values
    ('industry', i1, o1), ('companySize', i2, o2), ('seniority', i3, o3), ('state', i4, o4),
    ('channel', i5, o5), ('step', i6, o6), ('sendHour', i7, o7), ('sendDow', i8, o8)
  ) as d(dim, ki, ko)
  where c.ni >= 30 and c.no_ >= 30
    and d.ki::double precision / c.ni - d.ko::double precision / c.no_ >= 0.2;

  for v_i in 1 .. cardinality(v_sugg_dims) loop
    v_col := v_cols ->> v_sugg_dims[v_i];
    v_sets := v_sets || case when v_sets = '' then '' else ', ' end || format('(%I)', v_col);
    v_sugg_values := v_sugg_values || format(', grouping(%I) as %I', v_col, 'g_' || v_col);
  end loop;
  for v_i in 1 .. cardinality(v_sugg_dims) loop
    for v_j in v_i + 1 .. cardinality(v_sugg_dims) loop
      v_sets := v_sets || format(', (%I, %I)', v_cols ->> v_sugg_dims[v_i], v_cols ->> v_sugg_dims[v_j]);
    end loop;
  end loop;
  -- CASE chains: first grouped dimension (a) and last grouped dimension (b).
  for v_i in 1 .. cardinality(v_sugg_dims) loop
    v_col := v_cols ->> v_sugg_dims[v_i];
    v_first_dim := v_first_dim || format(' when %I = 0 then %L', 'g_' || v_col, v_sugg_dims[v_i]);
    v_first_val := v_first_val || format(' when %I = 0 then %I', 'g_' || v_col, v_col);
    v_first_idx := v_first_idx || format(' when %I = 0 then %s', 'g_' || v_col, v_i);
  end loop;
  for v_i in reverse cardinality(v_sugg_dims) .. 1 loop
    v_col := v_cols ->> v_sugg_dims[v_i];
    v_last_dim := v_last_dim || format(' when %I = 0 then %L', 'g_' || v_col, v_sugg_dims[v_i]);
  end loop;
  execute format($q$
    with g as (
      select %s, count(*) as replies,
        count(*) filter (where intent = 'interested') as interested,
        count(*) filter (where intent = 'not_interested') as not_interested,
        count(*) filter (where origin = 'live') as live,
        percentile_cont(0.5) within group (order by hours_to_reply) as median_hours,
        count(hours_to_reply) as hours_sample,
        min(id::text) as first_id
        %s
      from _ii_facts group by grouping sets (%s)
    ), k as (
      select g.*,
        case %s end as dim_a,
        case %s end as val_a,
        case %s end as idx_a,
        case %s end as dim_b
      from g
    ), k2 as (
      select k.*,
        case dim_b %s end as val_b,
        case dim_b %s end as idx_b,
        case when dim_a = dim_b then 1 else 2 end as n_keys,
        interested::double precision / nullif(replies, 0)::double precision / nullif(%s::double precision, 0) as lift
      from k
    ), f as (
      select * from k2 where val_a <> '(unknown)' and val_b <> '(unknown)'
    ), singles as (
      select dim_a as dim, val_a as val, lift from f where n_keys = 1
    )
    , cand as (
      select f.* from f
      left join singles s1 on s1.dim = f.dim_a and s1.val = f.val_a
      left join singles s2 on s2.dim = f.dim_b and s2.val = f.val_b
      where f.replies >= 30 and f.lift > 1
        and (f.n_keys = 1 or f.lift > greatest(coalesce(s1.lift, 0), coalesce(s2.lift, 0)))
    )
    select jsonb_build_object(
      'biased_dims', to_jsonb(%L::text[]),
      'all', (select coalesce(jsonb_agg(x.obj order by x.lift desc, x.replies desc, x.n_keys, x.idx_a, x.idx_b, x.first_id), '[]'::jsonb) from (
          select jsonb_build_object(
              'values', jsonb_build_object(dim_a, val_a) || jsonb_build_object(dim_b, val_b),
              'replies', replies, 'interested', interested, 'not_interested', not_interested,
              'live', live, 'median_hours', median_hours, 'hours_sample', hours_sample) as obj,
            lift, replies, n_keys, idx_a, idx_b, first_id
          from cand
          order by lift desc, replies desc, n_keys, idx_a, idx_b, first_id
          limit 300) x),
      'unbiased', (select coalesce(jsonb_agg(x.obj order by x.lift desc, x.replies desc, x.n_keys, x.idx_a, x.idx_b, x.first_id), '[]'::jsonb) from (
          select jsonb_build_object(
              'values', jsonb_build_object(dim_a, val_a) || jsonb_build_object(dim_b, val_b),
              'replies', replies, 'interested', interested, 'not_interested', not_interested,
              'live', live, 'median_hours', median_hours, 'hours_sample', hours_sample) as obj,
            lift, replies, n_keys, idx_a, idx_b, first_id
          from cand
          where dim_a <> all(%L::text[]) and dim_b <> all(%L::text[])
          order by lift desc, replies desc, n_keys, idx_a, idx_b, first_id
          limit 300) x))
  $q$,
    (select string_agg(quote_ident(v_cols ->> d), ', ') from unnest(v_sugg_dims) d),
    v_sugg_values, v_sets,
    v_first_dim, v_first_val, v_first_idx, v_last_dim,
    (select string_agg(format(' when %L then %I', d, v_cols ->> d), '') from unnest(v_sugg_dims) d),
    (select string_agg(format(' when %L then %s', d, array_position(v_sugg_dims, d)), '') from unnest(v_sugg_dims) d),
    v_rate, v_biased, v_biased, v_biased)
  into v_suggestions;
  end if;

  if 'summary' = any(p_sections) then
  -- ── copy leaderboard (focused segment) ────────────────────────────────────
  execute format($q$
    with c as (
      select copy_key,
        (array_agg(copy_label order by id) filter (where copy_label is not null))[1] as label,
        min(id::text) as first_id,  -- uuid text sorts like uuid; no min(uuid)
        %s as st
      from _ii_facts where %s and copy_key is not null group by copy_key
    )
    select jsonb_build_object(
      'by_interested', coalesce((select jsonb_agg(x) from (
          select jsonb_build_object('key', copy_key, 'label', label) || st as x from c
          order by (st->>'interested')::int desc,
                   (st->>'interested')::double precision / nullif((st->>'replies')::double precision, 0) desc,
                   first_id
          limit 25) a), '[]'::jsonb),
      'by_share', coalesce((select jsonb_agg(x) from (
          select jsonb_build_object('key', copy_key, 'label', label) || st as x from c
          where (st->>'replies')::int >= 30
          order by (st->>'interested')::double precision / nullif((st->>'replies')::double precision, 0) desc,
                   (st->>'interested')::int desc,
                   first_id
          limit 25) b), '[]'::jsonb),
      'without_copy', (select count(*) from _ii_facts where %s and copy_key is null),
      'rows', (select count(*) from _ii_facts where %s),
      'live', (select count(*) from _ii_facts where %s and origin = 'live'))
  $q$, v_stats, v_seg, v_seg, v_seg, v_seg)
  into v_copy;

  -- ── heatmap: interested replies, ET weekday x hour (focused segment) ──────
  execute format($q$
    select jsonb_build_object(
      'cells', coalesce((select jsonb_agg(jsonb_build_object('dow', reply_dow::int, 'hour', reply_hour::int, 'n', n)) from (
          select reply_dow, reply_hour, count(*) as n from _ii_facts
          where %s and intent = 'interested' and reply_dow between 1 and 7 and reply_hour between 0 and 23
          group by 1, 2) h), '[]'::jsonb),
      'counted', (select count(*) from _ii_facts where %s and intent = 'interested' and reply_dow between 1 and 7 and reply_hour between 0 and 23),
      'interested', (select count(*) from _ii_facts where %s and intent = 'interested'),
      'interested_live', (select count(*) from _ii_facts where %s and intent = 'interested' and origin = 'live'))
  $q$, v_seg, v_seg, v_seg, v_seg)
  into v_heatmap;
  end if;

  -- ── enrichment bias inputs (all filtered replies) ─────────────────────────
  select jsonb_build_object(
    'interested', count(*) filter (where intent = 'interested'),
    'other', count(*) filter (where intent is distinct from 'interested'),
    'known', jsonb_build_object(
      'industry', jsonb_build_array(count(*) filter (where intent = 'interested' and industry is not null), count(*) filter (where intent is distinct from 'interested' and industry is not null)),
      'companySize', jsonb_build_array(count(*) filter (where intent = 'interested' and company_size is not null), count(*) filter (where intent is distinct from 'interested' and company_size is not null)),
      'seniority', jsonb_build_array(count(*) filter (where intent = 'interested' and seniority is not null), count(*) filter (where intent is distinct from 'interested' and seniority is not null)),
      'jobTitle', jsonb_build_array(count(*) filter (where intent = 'interested' and job_title is not null), count(*) filter (where intent is distinct from 'interested' and job_title is not null)),
      'state', jsonb_build_array(count(*) filter (where intent = 'interested' and state is not null), count(*) filter (where intent is distinct from 'interested' and state is not null)),
      'channel', jsonb_build_array(count(*) filter (where intent = 'interested' and nullif(btrim(channel), '') is not null), count(*) filter (where intent is distinct from 'interested' and nullif(btrim(channel), '') is not null)),
      'step', jsonb_build_array(count(*) filter (where intent = 'interested' and step is not null), count(*) filter (where intent is distinct from 'interested' and step is not null)),
      'sendHour', jsonb_build_array(count(*) filter (where intent = 'interested' and send_hour is not null), count(*) filter (where intent is distinct from 'interested' and send_hour is not null)),
      'sendDow', jsonb_build_array(count(*) filter (where intent = 'interested' and send_dow is not null), count(*) filter (where intent is distinct from 'interested' and send_dow is not null))))
  into v_bias
  from _ii_facts;

  drop table pg_temp._ii_facts;

  -- Only the requested sections are returned.
  return jsonb_build_object('baseline', v_baseline, 'bias', v_bias, 'computed_at', now())
    || case when 'summary' = any(p_sections) then jsonb_build_object(
         'segment_stats', v_segment_stats, 'segments', v_segments, 'covered', v_covered,
         'copy', v_copy, 'heatmap', v_heatmap) else '{}'::jsonb end
    || case when 'suggestions' = any(p_sections) then jsonb_build_object('suggestions', v_suggestions) else '{}'::jsonb end;
end;
$fn$;

revoke all on function public.admin_inference_insights(text, timestamptz, timestamptz, text[], boolean, jsonb, text[]) from public, anon;
grant execute on function public.admin_inference_insights(text, timestamptz, timestamptz, text[], boolean, jsonb, text[]) to authenticated, service_role;

comment on function public.admin_inference_insights(text, timestamptz, timestamptz, text[], boolean, jsonb, text[]) is
  'Admin → Inference: every aggregate the tab renders (baseline, explorer, suggestions, copy, heatmap, bias) computed server-side. Platform admins only.';
