-- High Intent (positive_response) SQL test. Run after 20261014120000, inside a
-- transaction; the block ends by raising SIGNALS_HIGH_INTENT_PASSED so every
-- fixture is rolled back. Any other error = FAIL.
--
-- Proves:
--   candidates — one row per (team, person); the team is the client that
--     received the reply (team_id, else the backfill map, else the Reply.io
--     account); unknown → admin scope; newest non-empty values; platform from
--     the lead; reply text only in the candidate (it goes to admin detail)
--   enrichment queue — new / changed signals; Apollo retries only for teams
--     with Apollo on, not more often than every 6 hours
--   apply — fills only EMPTY signal fields; markets/title replaced;
--     provenance kept; with the shipped config (inference_write_back false)
--     NO inference_events row is touched; with it turned on, writes back ONLY
--     to the person's 'interested' rows in the SAME team scope, ONLY their
--     empty fields
--   free lookups — prospects by email / domain, inference by signal

do $t$
declare
  t_a uuid := gen_random_uuid();
  t_b uuid := gen_random_uuid();
  pk text := 'email:hi-test-' || replace(gen_random_uuid()::text, '-', '') || '@acme.test';
  cfg jsonb := (select config from public.signal_sources where key = 'positive_responses');
  r record;
  s_id uuid;
  j jsonb;
  n int;
begin
  -- The queue is capped (5000) and real signals may be waiting in it; set them
  -- aside (rolled back) so the assertions see only this test's signal.
  update public.signals set enriched_at = now() where source_key = 'positive_responses';

  insert into public.teams (id, name, signals_default_market, signals_apollo_enrich)
  values (t_a, 'hi test A', 'private_equity', false), (t_b, 'hi test B', null, true);

  -- Same person replied to team A twice (newest has no title) and to team B once;
  -- one 'not_interested' row in A must never be written back.
  insert into public.inference_events (team_id, person_key, channel, event_type, occurred_at, source, intent, full_name,
                                       job_title, company_name, industry, country, campaign_name, metadata)
  values
    (t_a, pk, 'email', 'classified', now() - interval '3 days', 'classify_reply', 'interested', 'Ann Lee', 'Founder', 'Acme', null, null,
     'A campaign', jsonb_build_object('reply_text', 'yes please', 'company_domain', 'acme.test')),
    (t_a, pk, 'email', 'classified', now() - interval '1 day', 'agent_leads', 'interested', 'Ann Lee', null, 'Acme', null, null,
     'A campaign 2', '{}'::jsonb),
    (t_a, pk, 'email', 'classified', now() - interval '2 days', 'draft_audit', 'not_interested', 'Ann Lee', null, 'Acme', null, null,
     null, '{}'::jsonb),
    (t_b, pk, 'linkedin', 'classified', now() - interval '5 hours', 'classify_reply', 'interested', 'Ann Lee', 'CEO', 'Acme', 'Software', 'Canada',
     'B campaign', '{}'::jsonb);

  -- ------------------------------------------------------------ candidates ---
  select count(*) into n from public.signals_positive_candidates(cfg, now() - interval '1 hour', null, 2000) c where c.person_key = pk;
  if n <> 2 then raise exception 'FAIL: % candidate rows for the person (want 2: one per team)', n; end if;
  select * into r from public.signals_positive_candidates(cfg, now() - interval '1 hour', null, 2000) c
   where c.person_key = pk and c.team_id = t_a;
  if r.scope_key <> t_a::text || ':' || pk then raise exception 'FAIL: scope_key %', r.scope_key; end if;
  if r.job_title <> 'Founder' then raise exception 'FAIL: newest non-empty title, got %', r.job_title; end if;
  if r.interested_rows <> 2 then raise exception 'FAIL: interested rows % (not_interested must not count)', r.interested_rows; end if;
  if r.team_default_market <> 'private_equity' then raise exception 'FAIL: team default market'; end if;
  if r.campaign_name <> 'A campaign 2' or r.reply_text <> 'yes please' or r.company_domain <> 'acme.test' then
    raise exception 'FAIL: candidate detail % / % / %', r.campaign_name, r.reply_text, r.company_domain;
  end if;
  -- keyset paging never repeats or skips
  select count(*) into n from public.signals_positive_candidates(cfg, now() - interval '1 hour', t_a::text || ':' || pk, 2000) c
   where c.person_key = pk and c.team_id = t_a;
  if n <> 0 then raise exception 'FAIL: p_after did not page past the row'; end if;

  -- ------------------------------------------------------------ the signal ---
  j := public.signals_upsert('positive_responses', jsonb_build_array(jsonb_build_object(
         'signal_type', 'positive_response', 'occurred_at', now() - interval '1 day', 'title', 'High intent: Ann Lee, Founder at Acme',
         'dedupe_key', 'hi:' || t_a || ':' || pk, 'score', 80, 'visibility', 'team', 'team_id', t_a,
         'markets', jsonb_build_array('private_equity'), 'person_name', 'Ann Lee', 'person_title', 'Founder',
         'company_name', 'Acme', 'person_email', 'ann@acme.test',
         'admin_detail', jsonb_build_object('person_key', pk, 'reply_excerpt', 'yes please'))));
  select id into s_id from public.signals where dedupe_key = 'hi:' || t_a || ':' || pk;
  if s_id is null then raise exception 'FAIL: upsert %', j; end if;

  -- queue: new → listed
  if not exists (select 1 from public.signals_hi_enrichment_queue(5000) q where q.signal_id = s_id and not q.free_done and q.person_key = pk) then
    raise exception 'FAIL: new signal not queued for enrichment';
  end if;

  -- free lookups: inference for this signal stays inside team A's scope
  j := public.signals_hi_free_lookups(array['ann@acme.test'], array['acme.test'], array[s_id]);
  if (select x ->> 'country' from jsonb_array_elements(j -> 'inference') x where (x ->> 'signal_id')::uuid = s_id) is not null then
    raise exception 'FAIL: team B''s data (Canada) leaked into team A''s enrichment: %', j -> 'inference';
  end if;

  -- apply: title already 'Founder' must stay; industry/country/size fill
  j := public.signals_hi_apply_enrichment(jsonb_build_array(jsonb_build_object(
         'signal_id', s_id,
         'values', jsonb_build_object('person_title', 'CEO (must not overwrite)', 'industry', 'Construction', 'country', 'United States',
                                      'state', 'TX', 'company_size', '11-50', 'seniority', 'owner'),
         'filled', jsonb_build_object('industry', 'prospects_domain', 'country', 'apollo'),
         'markets', jsonb_build_array('private_equity'), 'title', 'High intent: Ann Lee, Founder at Acme',
         'apollo_status', 'disabled')), cfg);
  if (j ->> 'signals')::int <> 1 then raise exception 'FAIL: apply %', j; end if;
  select * into r from public.signals where id = s_id;
  if r.person_title <> 'Founder' then raise exception 'FAIL: enrichment overwrote a non-empty title'; end if;
  if (r.industry, r.country, r.state, r.company_size, r.seniority) is distinct from ('Construction', 'United States', 'TX', '11-50', 'owner') then
    raise exception 'FAIL: enrichment did not fill empty fields: %', r;
  end if;
  if r.enrichment -> 'filled' ->> 'country' <> 'apollo' or r.enrichment ->> 'apollo_status' <> 'disabled' or r.enriched_at is null then
    raise exception 'FAIL: provenance %', r.enrichment;
  end if;

  -- shipped config: write-back OFF — no inference row touched
  if coalesce((cfg ->> 'inference_write_back')::boolean, false) then
    raise exception 'FAIL: inference_write_back must ship off: %', cfg;
  end if;
  if (j ->> 'inference_rows')::int <> 0 then raise exception 'FAIL: wrote back % inference rows with write-back off', j ->> 'inference_rows'; end if;
  if exists (select 1 from public.inference_events where person_key = pk
              and (industry is not null and team_id = t_a or country is not null and team_id = t_a
                   or (team_id = t_a and source = 'agent_leads' and job_title is not null))) then
    raise exception 'FAIL: an inference row was written with write-back off';
  end if;

  -- write-back ON (for Part B): re-apply with the flag; team A interested rows, empty fields only
  j := public.signals_hi_apply_enrichment(jsonb_build_array(jsonb_build_object('signal_id', s_id, 'values', '{}'::jsonb,
         'markets', jsonb_build_array('private_equity'), 'title', 'High intent: Ann Lee, Founder at Acme')),
         cfg || '{"inference_write_back": true}'::jsonb);
  if (j ->> 'inference_rows')::int <> 2 then raise exception 'FAIL: wrote back % inference rows (want 2)', j ->> 'inference_rows'; end if;
  if exists (select 1 from public.inference_events where person_key = pk and team_id = t_a and intent = 'interested'
              and (industry is distinct from 'Construction' or country is distinct from 'United States')) then
    raise exception 'FAIL: empty inference fields not filled';
  end if;
  if (select job_title from public.inference_events where person_key = pk and team_id = t_a and source = 'classify_reply') <> 'Founder' then
    raise exception 'FAIL: non-empty inference title touched';
  end if;
  if (select job_title from public.inference_events where person_key = pk and team_id = t_a and source = 'agent_leads') <> 'Founder' then
    raise exception 'FAIL: empty inference title not filled with the signal''s';
  end if;
  if exists (select 1 from public.inference_events where person_key = pk and intent = 'not_interested' and industry is not null) then
    raise exception 'FAIL: a not_interested row was written to';
  end if;
  if (select (industry, country)::text from public.inference_events where person_key = pk and team_id = t_b) <> '(Software,Canada)' then
    raise exception 'FAIL: another team''s inference row was written to';
  end if;

  -- queue after apply: not listed (team A has Apollo off)
  if exists (select 1 from public.signals_hi_enrichment_queue(5000) q where q.signal_id = s_id) then
    raise exception 'FAIL: enriched signal still queued';
  end if;
  -- a later change re-queues it (in a later transaction updated_at moves on;
  -- inside this one now() is fixed, so age the enrichment instead)
  update public.signals set score = 81, enriched_at = now() - interval '1 minute' where id = s_id;
  if not exists (select 1 from public.signals_hi_enrichment_queue(5000) q where q.signal_id = s_id) then
    raise exception 'FAIL: changed signal not re-queued';
  end if;
  perform public.signals_hi_apply_enrichment(jsonb_build_array(jsonb_build_object('signal_id', s_id, 'values', '{}'::jsonb)), cfg);
  -- Apollo on for the team + unfinished Apollo status → re-queued, but not within 6 hours
  update public.teams set signals_apollo_enrich = true where id = t_a;
  if exists (select 1 from public.signals_hi_enrichment_queue(5000) q where q.signal_id = s_id) then
    raise exception 'FAIL: Apollo retry sooner than 6 hours';
  end if;
  update public.signals set enrichment = enrichment || jsonb_build_object('apollo_at', now() - interval '7 hours'), enriched_at = now() + interval '1 second'
   where id = s_id;
  if not exists (select 1 from public.signals_hi_enrichment_queue(5000) q where q.signal_id = s_id and not q.apollo_done) then
    raise exception 'FAIL: Apollo retry not queued for a team that turned Apollo on';
  end if;

  -- team Apollo settings
  if not exists (select 1 from public.signals_hi_team_apollo(array[t_a, t_b]) x where x.team_id = t_b and x.enabled) then
    raise exception 'FAIL: team apollo flag';
  end if;

  -- the upsert never blanks an enriched value
  j := public.signals_upsert('positive_responses', jsonb_build_array(jsonb_build_object(
         'signal_type', 'positive_response', 'occurred_at', now() - interval '1 day', 'title', 'High intent: Ann Lee at Acme',
         'dedupe_key', 'hi:' || t_a || ':' || pk, 'score', 80, 'visibility', 'team', 'team_id', t_a,
         'markets', jsonb_build_array('private_equity'), 'person_name', 'Ann Lee', 'company_name', 'Acme', 'person_email', 'ann@acme.test')));
  select * into r from public.signals where id = s_id;
  if r.person_title is distinct from 'Founder' or r.industry is distinct from 'Construction' or r.country is distinct from 'United States' then
    raise exception 'FAIL: a later write blanked enriched values: %', r;
  end if;
  if r.title <> 'High intent: Ann Lee, Founder at Acme' then raise exception 'FAIL: title rebuilt without the kept title: %', r.title; end if;

  raise exception 'SIGNALS_HIGH_INTENT_PASSED' using errcode = 'P0001';
end
$t$;
