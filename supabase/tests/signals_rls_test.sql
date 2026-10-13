-- Signals visibility + naming test. Run after the signals migrations through
-- 20261014120000_signals_types_markets.sql, inside a transaction. The block
-- ends by raising SIGNALS_RLS_PASSED, so all test users, teams and signals are
-- rolled back. Any other error = FAIL.
--
-- Proves, as real 'authenticated' sessions (auth.uid() from request.jwt.claims):
--   clients cannot SELECT public.signals directly (reads go through the RPCs)
--   a client reads FDA clearances (all_clients) and its OWN team's High Intent
--     and website visits — never another team's, never admin-only High Intent,
--     not by feed, overview, breakdown, audience candidates or status writes
--   NAMING: a client-facing response for High Intent says 'high_intent', and
--     carries no reply text, campaign, platform, channel, internal type or
--     source key; admins see the source detail
--   a platform admin reads everything, with breakdowns by platform/campaign
--   anon reads nothing; clients can't write signals or read admin detail
--   the guard stamps the source's type and default markets, and an admin-only
--     source can't write a wider row

do $t$
declare
  u_client uuid := gen_random_uuid();
  u_other  uuid := gen_random_uuid();
  u_admin  uuid := gen_random_uuid();
  t_client uuid := gen_random_uuid();
  t_other  uuid := gen_random_uuid();
  t_admin  uuid := gen_random_uuid();
  s_fda uuid; s_hi_client uuid; s_hi_other uuid; s_hi_admin uuid; s_visit_client uuid; s_visit_other uuid;
  n int; j jsonb; txt text; ok_ids uuid[];
  hi_row jsonb;
  -- anything that would tell a client a High Intent signal came from an outbound reply
  revealing text := '\mrepl(y|ied|ies)\M|\minterested\M|positive_response|positive response|campaign|platform|channel|smartlead|heyreach|reply\.io|excerpt|inference|admin_detail|source_key|SECRET';
begin
  -- -------------------------------------------------------------- fixtures ---
  insert into auth.users (id, instance_id, aud, role, email)
  values (u_client, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-client@signals.test'),
         (u_other,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-other@signals.test'),
         (u_admin,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-admin@signals.test');
  insert into public.profiles (id) values (u_client), (u_other), (u_admin) on conflict (id) do nothing;
  -- prevent_platform_admin_self_promotion only lets service_role set the flag
  execute 'set local role service_role';
  update public.profiles set is_platform_admin = (id = u_admin) where id in (u_client, u_other, u_admin);
  execute 'reset role';
  delete from public.team_memberships where user_id in (u_client, u_other, u_admin);
  insert into public.teams (id, name, signals_default_market) values
    (t_client, 'rls client team', 'private_equity'), (t_other, 'rls other team', null), (t_admin, 'rls admin team', null);
  insert into public.team_memberships (user_id, team_id, role) values (u_client, t_client, 'member'), (u_other, t_other, 'member'), (u_admin, t_admin, 'member');

  -- FDA (all_clients) through the upsert; the guard stamps type + market.
  j := public.signals_upsert('openfda_510k', jsonb_build_array(jsonb_build_object(
         'signal_type', 'something_else', 'occurred_at', now(), 'title', 'rls fda',
         'dedupe_key', 'rlstest:fda', 'score', 60)));
  select id into s_fda from public.signals where dedupe_key = 'rlstest:fda';
  if (select signal_type from public.signals where id = s_fda) <> 'fda_clearance' then raise exception 'FAIL: type not taken from the source'; end if;
  if (select markets from public.signals where id = s_fda) <> array['medical_device'] then raise exception 'FAIL: default market not applied'; end if;

  -- High Intent for each team + one with no team (admin-only), with source detail.
  j := public.signals_upsert('positive_responses', jsonb_build_array(
    jsonb_build_object('signal_type', 'positive_response', 'occurred_at', now(), 'title', 'High intent: Ann Lee, CEO at Acme',
      'dedupe_key', 'rlstest:hi:client', 'score', 90, 'visibility', 'team', 'team_id', t_client, 'markets', jsonb_build_array('private_equity'),
      'person_name', 'Ann Lee', 'person_title', 'CEO', 'company_name', 'Acme', 'industry', 'Construction', 'country', 'United States',
      'seniority', 'c_suite', 'company_size', '11-50', 'payload', '{}'::jsonb,
      'admin_detail', jsonb_build_object('person_key', 'email:ann@acme.test', 'reply_excerpt', 'SECRET REPLY yes interested',
                                         'campaign_name', 'SECRET CAMPAIGN', 'platform', 'Smartlead', 'channel', 'email')),
    jsonb_build_object('signal_type', 'positive_response', 'occurred_at', now(), 'title', 'High intent: Bo Kim, Owner at Beta',
      'dedupe_key', 'rlstest:hi:other', 'score', 90, 'visibility', 'team', 'team_id', t_other, 'markets', jsonb_build_array('saas'),
      'admin_detail', jsonb_build_object('person_key', 'email:bo@beta.test', 'reply_excerpt', 'SECRET other', 'campaign_name', 'SECRET B', 'platform', 'Reply.io')),
    jsonb_build_object('signal_type', 'positive_response', 'occurred_at', now(), 'title', 'High intent: Cy Doe at Gamma',
      'dedupe_key', 'rlstest:hi:admin', 'score', 90, 'visibility', 'admin',
      'admin_detail', jsonb_build_object('person_key', 'email:cy@gamma.test', 'reply_excerpt', 'SECRET admin', 'platform', 'Reply.io'))));
  if (j ->> 'inserted')::int <> 3 then raise exception 'FAIL: High Intent upsert %', j; end if;
  select id into s_hi_client from public.signals where dedupe_key = 'rlstest:hi:client';
  select id into s_hi_other from public.signals where dedupe_key = 'rlstest:hi:other';
  select id into s_hi_admin from public.signals where dedupe_key = 'rlstest:hi:admin';
  if (select count(*) from public.signal_admin_details where signal_id in (s_hi_client, s_hi_other, s_hi_admin)) <> 3 then
    raise exception 'FAIL: admin detail not stored';
  end if;
  if (select markets from public.signals where id = s_hi_admin) <> array['other'] then raise exception 'FAIL: empty markets → other'; end if;

  insert into public.signals (source_key, signal_type, occurred_at, title, dedupe_key, visibility, team_id)
  values ('web_visitors', 'x', now(), 'rls visit client', 'rlstest:visit:client', 'team', t_client) returning id into s_visit_client;
  insert into public.signals (source_key, signal_type, occurred_at, title, dedupe_key, visibility, team_id)
  values ('web_visitors', 'x', now(), 'rls visit other', 'rlstest:visit:other', 'team', t_other) returning id into s_visit_other;

  -- guard: an admin-only source cannot write a wider row
  insert into public.signal_sources (key, signal_type, name, kind, cadence, default_visibility, function_name)
  values ('rlstest_admin_src', 'positive_response', 'rls admin-only', 'internal', 'daily', 'admin', 'none');
  begin
    insert into public.signals (source_key, signal_type, occurred_at, title, dedupe_key, visibility)
    values ('rlstest_admin_src', 'x', now(), 'leak', 'rlstest:admin-leak', 'all_clients');
    raise exception 'FAIL: admin-only source wrote an all_clients row';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  j := public.signals_upsert('rlstest_admin_src', jsonb_build_array(jsonb_build_object(
         'signal_type', 'xx', 'occurred_at', now(), 'title', 'via upsert', 'dedupe_key', 'rlstest:admin-upsert', 'score', 50, 'visibility', 'all_clients')));
  if (select visibility from public.signals where dedupe_key = 'rlstest:admin-upsert') is distinct from 'admin' then
    raise exception 'FAIL: signals_upsert widened an admin-only row';
  end if;
  -- identical upsert → deduped
  j := public.signals_upsert('rlstest_admin_src', jsonb_build_array(jsonb_build_object(
         'signal_type', 'xx', 'occurred_at', (select occurred_at from public.signals where dedupe_key = 'rlstest:admin-upsert'),
         'title', 'via upsert', 'dedupe_key', 'rlstest:admin-upsert', 'score', 50)));
  if (j->>'inserted')::int <> 0 or (j->>'updated')::int <> 0 or (j->>'deduped')::int <> 1 then
    raise exception 'FAIL: identical upsert should be deduped: %', j;
  end if;
  -- invalid market refused (rejected, not written)
  j := public.signals_upsert('openfda_510k', jsonb_build_array(jsonb_build_object(
         'signal_type', 'xx', 'occurred_at', now(), 'title', 'bad market', 'dedupe_key', 'rlstest:badmarket', 'score', 1,
         'markets', jsonb_build_array('crypto'))));
  if (j->>'rejected')::int <> 1 then raise exception 'FAIL: unknown market accepted: %', j; end if;

  -- ------------------------------------------------------ client session ---
  perform set_config('request.jwt.claims', json_build_object('sub', u_client, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  begin
    select count(*) into n from public.signals;
    raise exception 'FAIL: client can SELECT signals directly (% rows)', n;
  exception when insufficient_privilege then null;
  end;
  begin
    select count(*) into n from public.signal_admin_details;
    raise exception 'FAIL: client can read admin detail (% rows)', n;
  exception when insufficient_privilege then null;
  end;

  -- High Intent: exactly its own team's one
  j := public.signals_feed(jsonb_build_object('type', 'high_intent'), 200, 0);
  select array_agg((x ->> 'id')::uuid) into ok_ids from jsonb_array_elements(j -> 'rows') x;
  if not (s_hi_client = any(ok_ids)) then raise exception 'FAIL: client misses its own High Intent'; end if;
  if s_hi_other = any(ok_ids) then raise exception 'FAIL: client sees ANOTHER TEAM''s High Intent'; end if;
  if s_hi_admin = any(ok_ids) then raise exception 'FAIL: client sees admin-only High Intent'; end if;
  -- the same by internal key
  j := public.signals_feed(jsonb_build_object('type', 'positive_response'), 200, 0);
  if exists (select 1 from jsonb_array_elements(j -> 'rows') x where (x ->> 'id')::uuid in (s_hi_other, s_hi_admin)) then
    raise exception 'FAIL: internal type key widened the client feed';
  end if;
  -- everything else: own visitor + FDA, never the other team's
  j := public.signals_feed(jsonb_build_object('search', 'rls'), 200, 0);
  select array_agg((x ->> 'id')::uuid) into ok_ids from jsonb_array_elements(j -> 'rows') x;
  if not (s_fda = any(ok_ids) and s_visit_client = any(ok_ids)) then raise exception 'FAIL: client misses FDA / own visitor'; end if;
  if s_visit_other = any(ok_ids) or s_hi_other = any(ok_ids) or s_hi_admin = any(ok_ids) then
    raise exception 'FAIL: client feed leaks another team / admin rows';
  end if;

  -- NAMING: the client's High Intent row
  j := public.signals_feed(jsonb_build_object('type', 'high_intent'), 200, 0);
  select x into hi_row from jsonb_array_elements(j -> 'rows') x where (x ->> 'id')::uuid = s_hi_client;
  if hi_row ->> 'type' <> 'high_intent' then raise exception 'FAIL: client type is %', hi_row ->> 'type'; end if;
  txt := hi_row::text;
  if txt ~* revealing then raise exception 'FAIL: client High Intent row reveals its source: %', txt; end if;
  if hi_row ? 'signal_type' or hi_row ? 'source_key' or hi_row ? 'admin_detail' or hi_row ? 'visibility' or hi_row ? 'enrichment' then
    raise exception 'FAIL: client row has internal keys: %', txt;
  end if;
  if hi_row ->> 'url' is not null or hi_row -> 'payload' <> '{}'::jsonb then raise exception 'FAIL: High Intent url/payload: %', txt; end if;
  if hi_row ->> 'title' <> 'High intent: Ann Lee, CEO at Acme' then raise exception 'FAIL: title %', hi_row ->> 'title'; end if;

  -- overview / breakdown / candidates: own team only, no source fields
  j := public.signals_overview('{}'::jsonb);
  if (select (x ->> 'total')::int from jsonb_array_elements(j) x where x ->> 'type' = 'high_intent') < 1 then
    raise exception 'FAIL: overview misses High Intent';
  end if;
  if j::text ~* 'positive_response' then raise exception 'FAIL: overview uses the internal key: %', j; end if;
  j := public.signals_breakdown(jsonb_build_object('type', 'high_intent'));
  if j ? 'platform' or j ? 'campaign' or j::text ~* 'SECRET|smartlead' then raise exception 'FAIL: client breakdown has source dims: %', j; end if;
  if not exists (select 1 from jsonb_array_elements(j -> 'industry') x where x ->> 'value' = 'Construction') then
    raise exception 'FAIL: breakdown by industry: %', j;
  end if;
  j := public.signals_feed(jsonb_build_object('type', 'high_intent', 'industry', 'Construction'), 50, 0);
  if not exists (select 1 from jsonb_array_elements(j -> 'rows') x where (x ->> 'id')::uuid = s_hi_client) then
    raise exception 'FAIL: breakdown click (industry) does not filter';
  end if;
  j := public.signals_feed(jsonb_build_object('type', 'high_intent', 'platform', 'Reply.io'), 50, 0);
  if (j ->> 'total')::int < 1 then raise exception 'FAIL: admin-only platform filter must be ignored for clients, not used'; end if;

  -- market chips + country filter
  j := public.signals_feed(jsonb_build_object('markets', jsonb_build_array('medical_device'), 'search', 'rls'), 50, 0);
  if exists (select 1 from jsonb_array_elements(j -> 'rows') x where (x ->> 'id')::uuid = s_hi_client) then
    raise exception 'FAIL: market filter';
  end if;
  j := public.signals_feed(jsonb_build_object('type', 'high_intent', 'country', 'CA', 'include_unknown_country', false), 50, 0);
  if (j ->> 'total')::int <> 0 then raise exception 'FAIL: country filter'; end if;
  j := public.signals_feed(jsonb_build_object('type', 'high_intent', 'country', 'US', 'include_unknown_country', false), 50, 0);
  if (j ->> 'total')::int < 1 then raise exception 'FAIL: country US (United States → US)'; end if;

  -- status: per team; nothing happens on a signal the client can't see
  n := public.signals_set_status(array[s_fda, s_hi_other, s_hi_admin, s_visit_other], 'reviewed');
  if n <> 1 then raise exception 'FAIL: set_status touched % rows (want 1: the FDA one only)', n; end if;

  -- no direct writes, no service functions
  begin
    insert into public.signals (source_key, signal_type, occurred_at, title, dedupe_key, visibility)
    values ('openfda_510k', 'x', now(), 'client write', 'rlstest:client-write', 'all_clients');
    raise exception 'FAIL: client inserted a signal';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.signals_upsert('openfda_510k', '[]'::jsonb);
    raise exception 'FAIL: client can call signals_upsert';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.signals_audience_candidates(u_client, '{}'::jsonb);
    raise exception 'FAIL: client can call signals_audience_candidates';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.signals_admin_teams();
    raise exception 'FAIL: client can list team settings';
  exception when insufficient_privilege then null;
  end;
  select count(*) into n from public.signal_sources;
  if n <> 0 then raise exception 'FAIL: client can read signal_sources (config)'; end if;
  select count(*) into n from public.signal_runs;
  if n <> 0 then raise exception 'FAIL: client can read signal_runs'; end if;
  j := public.signals_my_settings();
  if j ->> 'country' <> 'US' or (j ->> 'team_id')::uuid <> t_client then raise exception 'FAIL: my settings %', j; end if;

  -- ------------------------------------------- audience candidates (service) ---
  execute 'reset role';
  j := public.signals_audience_candidates(u_client, jsonb_build_object('signal_types', jsonb_build_array('high_intent'),
         'since', now() - interval '1 day'), null, null, 500, 0, true);
  if not exists (select 1 from jsonb_array_elements(j -> 'signals') x where (x ->> 'id')::uuid = s_hi_client) then
    raise exception 'FAIL: candidates miss own High Intent';
  end if;
  if exists (select 1 from jsonb_array_elements(j -> 'signals') x where (x ->> 'id')::uuid in (s_hi_other, s_hi_admin)) then
    raise exception 'FAIL: candidates include another team''s / admin High Intent';
  end if;
  j := public.signals_audience_candidates(u_client, '{}'::jsonb, null, array[s_hi_client, s_hi_other, s_hi_admin], 50, 0, false);
  if jsonb_array_length(j -> 'signals') <> 1 then raise exception 'FAIL: candidates by id leak: %', j; end if;
  txt := (j -> 'signals' -> 0)::text;
  if txt ~* revealing or j -> 'signals' -> 0 ->> 'type' <> 'high_intent' then
    raise exception 'FAIL: audience candidate reveals its source: %', txt;
  end if;

  -- ----------------------------------------------- other team's session ---
  perform set_config('request.jwt.claims', json_build_object('sub', u_other, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.signals_feed(jsonb_build_object('type', 'high_intent'), 200, 0);
  if exists (select 1 from jsonb_array_elements(j -> 'rows') x where (x ->> 'id')::uuid in (s_hi_client, s_hi_admin)) then
    raise exception 'FAIL: other team sees the client''s / admin High Intent';
  end if;
  if not exists (select 1 from jsonb_array_elements(j -> 'rows') x where (x ->> 'id')::uuid = s_hi_other) then
    raise exception 'FAIL: other team misses its own High Intent';
  end if;
  j := public.signals_feed(jsonb_build_object('search', 'rls', 'status', 'reviewed'), 50, 0);
  if (j->>'total')::int <> 0 then raise exception 'FAIL: the client''s reviewed status leaked to another team'; end if;

  -- ----------------------------------------------------- admin session ---
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.signals_feed(jsonb_build_object('type', 'high_intent'), 200, 0);
  select count(*) into n from jsonb_array_elements(j -> 'rows') x where (x ->> 'id')::uuid in (s_hi_client, s_hi_other, s_hi_admin);
  if n <> 3 then raise exception 'FAIL: admin sees % of 3 High Intent', n; end if;
  select x into hi_row from jsonb_array_elements(j -> 'rows') x where (x ->> 'id')::uuid = s_hi_client;
  if hi_row -> 'admin_detail' ->> 'reply_excerpt' <> 'SECRET REPLY yes interested' or hi_row ->> 'signal_type' <> 'positive_response' then
    raise exception 'FAIL: admin does not get the source detail: %', hi_row;
  end if;
  j := public.signals_breakdown(jsonb_build_object('type', 'high_intent', 'search', 'Acme'));
  if not exists (select 1 from jsonb_array_elements(j -> 'platform') x where x ->> 'value' = 'Smartlead')
     or not exists (select 1 from jsonb_array_elements(j -> 'campaign') x where x ->> 'value' = 'SECRET CAMPAIGN') then
    raise exception 'FAIL: admin breakdown by platform/campaign: %', j;
  end if;
  j := public.signals_feed(jsonb_build_object('type', 'high_intent', 'campaign', 'SECRET CAMPAIGN'), 50, 0);
  if (j ->> 'total')::int <> 1 then raise exception 'FAIL: admin campaign filter'; end if;
  select count(*) into n from public.signal_sources;
  if n < 5 then raise exception 'FAIL: admin sees % sources', n; end if;
  j := public.signals_admin_teams();
  if not exists (select 1 from jsonb_array_elements(j) x where (x ->> 'team_id')::uuid = t_client and x ->> 'default_market' = 'private_equity') then
    raise exception 'FAIL: admin team settings';
  end if;
  perform public.signals_admin_set_team(t_other, 'saas', 'gb', true);
  execute 'reset role';
  if (select (signals_default_market, signals_country, signals_apollo_enrich)::text from public.teams where id = t_other) <> '(saas,GB,t)' then
    raise exception 'FAIL: admin set team';
  end if;

  -- ------------------------------------------------------ anon session ---
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  begin
    perform public.signals_feed('{}'::jsonb, 10, 0);
    raise exception 'FAIL: anon can call signals_feed';
  exception when insufficient_privilege then null;
  end;
  begin
    select count(*) into n from public.signals;
    raise exception 'FAIL: anon can select signals (% rows)', n;
  exception when insufficient_privilege then null;
  end;

  execute 'reset role';
  raise exception 'SIGNALS_RLS_PASSED' using errcode = 'P0001';
end
$t$;
