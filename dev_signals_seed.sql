-- DEV ONLY (iqxzetwuxykplzdjysiu): synthetic SourceCo-shaped inference_events
-- rows so the PE seller-intent source has something to read. No real data:
-- invented names, *.example domains, metadata.synthetic = true.
-- Covers the selection rules:
--   30 people, reply2_backfill (team null), interested         → included
--    6 people, smartlead_backfill, interested                   → included
--    4 people, reply2_backfill, NOT interested                  → excluded
--    4 people, reply1_backfill (not SourceCo), interested       → excluded
-- Each included person has a 'classified' row and a 'replied' row with
-- metadata.reply_text (as in prod); some people reply twice (dedupe check).
-- Re-runnable: deletes its own synthetic rows first.


-- 1. Dev has no inference_events table (prod-only, created outside migrations):
--    create it with prod's exact schema (columns, checks, unique key, RLS), no data.
create table if not exists public.inference_events (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references public.teams(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete set null,
  agent_config_id uuid references public.agent_configs(id) on delete set null,
  person_key text not null, email text, linkedin_url text, full_name text, job_title text, seniority text,
  department text, company_name text, industry text, city text, state text, country text, company_size text,
  channel text not null check (channel = any (array['email','linkedin','other'])),
  campaign_external_id text, campaign_name text, sequence_step_type text, copy_fingerprint text, subject text,
  event_type text not null check (event_type = any (array['sent','opened','replied','bounced','opted_out','meeting_booked','closed_won','closed_lost','classified','connection_sent','connection_accepted'])),
  intent text, is_objection boolean, pipeline_stage text, disposition_tag text,
  occurred_at timestamptz not null, source text not null, source_row_id text,
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), company_phone text,
  constraint inference_events_source_row_event_key unique (source, source_row_id, event_type)
);
create index if not exists idx_inference_person_key on public.inference_events (person_key);
create index if not exists idx_inference_team_time on public.inference_events (team_id, occurred_at desc);
alter table public.inference_events enable row level security;
drop policy if exists "Platform admins can read all inference events" on public.inference_events;
create policy "Platform admins can read all inference events" on public.inference_events for select using (exists (select 1 from profiles p where p.id = auth.uid() and (p.is_platform_admin = true or p.is_super_admin = true)));
drop policy if exists "Service role full access" on public.inference_events;
create policy "Service role full access" on public.inference_events for all using (auth.role() = 'service_role');
drop policy if exists "Users can read their team inference events" on public.inference_events;
create policy "Users can read their team inference events" on public.inference_events for select using (team_id = get_user_team_id(auth.uid()));
comment on table public.inference_events is 'DEV: schema copied from prod 2026-10-09 for Signals testing; contains synthetic rows only.';

-- 2. Synthetic rows.
delete from public.inference_events where metadata->>'synthetic' = 'true';

with first_names as (select array['Avery','Jordan','Morgan','Riley','Casey','Quinn','Harper','Rowan','Emerson','Finley','Parker','Sawyer'] a),
last_names as (select array['Calloway','Brightwater','Okafor','Lindqvist','Marchetti','Haldane','Nakamura','Prescott','Delacroix','Ferreira','Whitlock','Ashdown'] a),
titles as (select array['Owner','Founder & CEO','President','Managing Partner','Co-Founder','CFO','VP Operations','Principal','General Manager','Owner/Operator'] a),
industries as (select array['Construction','HVAC services','Specialty manufacturing','Logistics','Dental practices','Landscaping','Commercial printing','IT managed services'] a),
places as (select array[['Austin','TX'],['Denver','CO'],['Columbus','OH'],['Raleigh','NC'],['Tampa','FL'],['Boise','ID'],['Omaha','NE'],['Spokane','WA']] a),
replies as (select array[
  'Thanks for reaching out. We have been thinking about succession — happy to have a call next week.',
  'Timing is interesting. Can you share what a process would look like and typical multiples?',
  'Open to a conversation. My partner and I are planning to step back in the next 18 months.',
  'Sure, send me some times. We had an inbound offer last year and want to understand our options.',
  'Appreciate the note — yes, we would consider the right partner. What size businesses do you work with?'] a),
people as (
  select g as n,
         case when g <= 30 then 'reply2_backfill' when g <= 36 then 'smartlead_backfill' when g <= 40 then 'reply2_backfill' else 'reply1_backfill' end as src,
         case when g between 37 and 40 then 'not_interested' else 'interested' end as intent
    from generate_series(1, 44) g
)
insert into public.inference_events (person_key, email, full_name, job_title, seniority, company_name, industry, city, state, country,
  company_size, channel, campaign_name, event_type, intent, occurred_at, source, source_row_id, metadata, created_at)
select 'synthetic:' || p.n,
       lower(fn.a[1 + p.n % 12]) || '@' || lower(ln.a[1 + (p.n * 7) % 12]) || '-' || p.n || '.example',
       fn.a[1 + p.n % 12] || ' ' || ln.a[1 + (p.n * 7) % 12],
       t.a[1 + (p.n * 3) % 10],
       case when (p.n * 3) % 10 in (0, 1, 2, 3, 4, 7, 9) then 'owner' else 'vp' end,
       ln.a[1 + (p.n * 7) % 12] || ' ' || (array['Builders','Mechanical','Industries','Group','Partners','Services'])[1 + p.n % 6],
       i.a[1 + p.n % 8],
       pl.a[1 + p.n % 8][1], pl.a[1 + p.n % 8][2], 'United States',
       (10 + (p.n * 13) % 190)::text,
       case when p.src = 'smartlead_backfill' then 'email' else (case when p.n % 5 = 0 then 'linkedin' else 'email' end) end,
       'Owner outreach (synthetic)',
       ev.event_type, p.intent,
       -- spread over the last ~120 days; repeat replies a few days later
       now() - ((p.n * 2.7) || ' days')::interval + (ev.k * interval '3 days') + (ev.k2 * interval '5 minutes'),
       p.src,
       'synthetic-' || p.n || '-' || ev.k,
       jsonb_build_object('synthetic', true,
         'account', case p.src when 'reply2_backfill' then 'reply_io_2_sourceco' when 'smartlead_backfill' then 'smartlead_sourceco' else 'reply_io_1' end,
         'company_domain', lower(ln.a[1 + (p.n * 7) % 12]) || '-' || p.n || '.example')
       || case when ev.event_type = 'replied' then jsonb_build_object('reply_text', r.a[1 + (p.n + ev.k) % 5]) else '{}'::jsonb end,
       now() - interval '1 hour'
  from people p
  cross join first_names fn cross join last_names ln cross join titles t cross join industries i cross join places pl cross join replies r
  cross join lateral (
    select e.event_type, k.k, case when e.event_type = 'replied' then 1 else 0 end as k2
      from (values ('replied'), ('classified')) e(event_type)
      cross join generate_series(0, case when p.n % 7 = 0 then 1 else 0 end) k(k)
  ) ev;

select source, intent, count(*) rows, count(distinct person_key) people
  from public.inference_events where metadata->>'synthetic' = 'true' group by 1, 2 order by 1, 2;
