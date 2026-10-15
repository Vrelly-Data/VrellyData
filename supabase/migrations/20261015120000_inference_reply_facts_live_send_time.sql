-- Admin → Inference: send hour / weekday for LIVE replies.
--
-- inference_reply_facts (20261008013000) took send_hour / send_dow only from
-- reply2_backfill 'sent' rows (matched on provider_thread_id), so live replies
-- never had a send time. enrich-inference-events (20261014200000) now writes
-- send_hour_et / send_dow_et onto the reply row itself, so the view reads the
-- row's own value first and falls back to the backfill 'sent' row as before.
-- Backfill rows are unchanged (they carry no send_hour_et of their own).
--
-- A materialized view cannot be altered in place: it is dropped and rebuilt
-- with the same columns, unique index, grants and comment. The refresh job and
-- admin_inference_insights read it by name and need no change.
-- Guarded: inference_events only exists on prod (dev skips this).

do $mv$
begin
  if to_regclass('public.inference_events') is null then
    return;
  end if;
  drop materialized view if exists public.inference_reply_facts;
  execute $q$
  create materialized view public.inference_reply_facts as
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
        -- the reply's own send time (live, written by enrich-inference-events) first
        coalesce(public._ii_num(m.send_hour_et), public._ii_num(s.send_hour)) as send_hour,
        coalesce(public._ii_num(m.send_dow_et), public._ii_num(s.send_dow)) as send_dow,
        public._ii_num(m.reply_hour_et) as reply_hour,
        public._ii_num(m.reply_dow_et) as reply_dow,
        public._ii_num(m.hours_to_reply) as hours_to_reply,
        coalesce(r.copy_fingerprint, case when m.variant_id is null or jsonb_typeof(m.variant_id) = 'null' then null else m.variant_id #>> '{}' end) as copy_key,
        nullif(regexp_replace(  -- like JS String.trim(): all whitespace incl. NBSP / BOM
          regexp_replace(coalesce(r.subject, m.reply_subject), '^\s*((re|fw|fwd|aw)\s*:\s*)+', '', 'i'),
          '^[\s ﻿]+|[\s ﻿]+$', '', 'g'), '') as copy_label
      from public.inference_events r
      cross join lateral jsonb_to_record(r.metadata) as m(
        backfill text, sequence_step_number jsonb, sequence_number jsonb, reply_hour_et jsonb, reply_dow_et jsonb,
        hours_to_reply jsonb, variant_id jsonb, reply_subject text, provider_thread_id text,
        send_hour_et jsonb, send_dow_et jsonb)
      left join cls c on c.team_id is not distinct from r.team_id and c.person_key = r.person_key
      left join snd s on s.thread_id = m.provider_thread_id
      where r.event_type = 'replied'
    )
    select id, origin, channel, occurred_at, intent, industry, company_size, seniority, job_title, state,
           step, send_hour, send_dow, reply_hour, reply_dow, hours_to_reply, copy_key, copy_label, now() as refreshed_at
    from base
  $q$;
  -- required for refresh ... concurrently
  create unique index if not exists inference_reply_facts_id_key on public.inference_reply_facts (id);
  revoke all on public.inference_reply_facts from public, anon, authenticated;
  comment on materialized view public.inference_reply_facts is
    'Admin → Inference: one row per replied event with the dimensions admin_inference_insights groups by. Refreshed every 15 minutes (pg_cron refresh-inference-reply-facts → refresh_inference_reply_facts()). Not readable by clients.';
end
$mv$;
