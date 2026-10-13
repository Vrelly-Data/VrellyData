-- Signals phase 2 (audiences from signals) — SQL test.
--
-- Run after 20261013120000_signal_audiences.sql, inside a transaction that is
-- rolled back. The block ends by raising SIGNAL_AUDIENCES_PASSED, so every test
-- user, team, signal, audience and push below disappears; any other error =
-- FAIL. Reads real public.prospects (read-only) to prove the company match on
-- live data; writes nothing outside the rolled-back transaction.
--
-- Proves:
--   visibility — a client's candidates include 510(k) and its own team's
--     visitor; never a PE (admin-only) signal or another team's visitor, not
--     even when named by id; an admin's include PE; the resolver drops
--     (and counts as refused) every signal the user may not see;
--   candidates — per-vertical filters, min score, recency; signals already
--     used by THIS audience and signals the team dismissed are left out;
--   resolver a) — Vrelly prospects at the signal's domain, every one with an
--     email at that domain (#107), persona applied, per-company limit;
--     name + state match derives a domain for a domain-less signal;
--   resolver b) — the signal's own named person is used first when their title
--     matches the persona, and not when it does not;
--   dedupe — someone this user already pushed is not offered again;
--   marking — consumed signals are recorded per audience; pushed ones become
--     'pushed' for the team; another user's audience or an invisible signal
--     cannot be marked;
--   schema — source 'signals' requires filters_version 3; clients cannot call
--     the service-only functions; RLS shows a user only their own rows.

do $t$
declare
  u_client uuid := gen_random_uuid();
  u_other  uuid := gen_random_uuid();
  u_admin  uuid := gen_random_uuid();
  t_client uuid := gen_random_uuid();
  t_other  uuid := gen_random_uuid();
  t_admin  uuid := gen_random_uuid();
  cfg uuid;
  aud uuid; aud2 uuid; aud_other uuid;
  s_dom uuid; s_name uuid; s_pe uuid; s_visit_client uuid; s_visit_other uuid; s_named uuid; s_named_bad uuid; s_old uuid; s_code uuid;
  v_domain text; v_title text; v_cname text; v_cstate text;
  q jsonb := jsonb_build_object('verticals', jsonb_build_array('medical_device', 'web_visitors', 'private_equity'),
                                'since', now() - interval '30 days', 'min_score', 0);
  persona_ceo jsonb := jsonb_build_object('title_regexes', jsonb_build_array('\mCEO\M'));
  j jsonb; ids uuid[]; n int; e text;
begin
  -- ---------------------------------------------------------- fixtures ---
  insert into auth.users (id, instance_id, aud, role, email)
  values (u_client, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sa-client@signals.test'),
         (u_other,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sa-other@signals.test'),
         (u_admin,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sa-admin@signals.test');
  insert into public.profiles (id) values (u_client), (u_other), (u_admin) on conflict (id) do nothing;
  execute 'set local role service_role';
  update public.profiles set is_platform_admin = (id = u_admin) where id in (u_client, u_other, u_admin);
  execute 'reset role';
  delete from public.team_memberships where user_id in (u_client, u_other, u_admin);
  insert into public.teams (id, name) values (t_client, 'sa client team'), (t_other, 'sa other team'), (t_admin, 'sa admin team');
  insert into public.team_memberships (user_id, team_id, role)
  values (u_client, t_client, 'member'), (u_other, t_other, 'member'), (u_admin, t_admin, 'member');

  insert into public.agent_configs (user_id, company_name, sender_name, offer_description)
  values (u_client, 'sa co', 'sa sender', 'sa offer') returning id into cfg;
  insert into public.agent_audiences (user_id, agent_config_id, name, source, filters_version, filters, max_per_run)
  values (u_client, cfg, 'sa audience', 'signals', 3, '{}', 10) returning id into aud;
  insert into public.agent_audiences (user_id, agent_config_id, name, source, filters_version, filters, max_per_run)
  values (u_client, cfg, 'sa audience 2', 'signals', 3, '{}', 10) returning id into aud2;
  insert into public.agent_audiences (user_id, agent_config_id, name, source, filters_version, filters, max_per_run)
  values (u_other, cfg, 'sa other', 'signals', 3, '{}', 10) returning id into aud_other;

  -- schema: source 'signals' requires filters_version 3
  begin
    insert into public.agent_audiences (user_id, agent_config_id, name, source, filters_version, filters, max_per_run)
    values (u_client, cfg, 'sa bad version', 'signals', 2, '{}', 10);
    raise exception 'FAIL: signals audience with filters_version 2 accepted';
  exception when check_violation then null;
  end;

  -- A real US prospect with a CEO title and a company domain (read-only).
  select public.signals_domain_key(p.company_domain), p.job_title
    into v_domain, v_title
    from public.prospect_audience_search s join public.prospects p on p.id = s.id
   where s.country_l in ('us', 'united states') and s.email_foreign_cctld is null
     and public.signals_domain_key(p.company_domain) is not null
     and split_part(s.email_key, '@', 2) = public.signals_domain_key(p.company_domain)
     and s.job_title ~* '\mCEO\M'
   limit 1;
  if v_domain is null then raise exception 'FAIL: no real CEO prospect found to test against'; end if;
  -- And a real company with a name + company state, for the derived domain.
  select p.company_name, p.company_state into v_cname, v_cstate
    from public.prospect_audience_search s join public.prospects p on p.id = s.id
   where public.signals_company_name_key(p.company_name) is not null and public.audience_is_us_state(p.company_state)
     and public.signals_domain_key(p.company_domain) is not null
   offset 1000 limit 1;

  insert into public.signals (source_key, vertical, signal_type, occurred_at, title, dedupe_key, visibility, company_domain, score, payload)
  values ('openfda_510k', 'x', '510k_cleared', now() - interval '2 days', 'sa domain', 'satest:dom', 'all_clients', v_domain, 80,
          '{"product_code":"LLZ","device_name":"Cardiac Catheter System"}') returning id into s_dom;
  insert into public.signals (source_key, vertical, signal_type, occurred_at, title, dedupe_key, visibility, company_name, state, score, payload)
  values ('openfda_510k', 'x', '510k_cleared', now() - interval '3 days', 'sa name', 'satest:name', 'all_clients', v_cname || ', Inc.', v_cstate, 70,
          '{"product_code":"QAS"}') returning id into s_name;
  insert into public.signals (source_key, vertical, signal_type, occurred_at, title, dedupe_key, visibility, company_domain, score)
  values ('pe_seller_intent', 'x', 'seller_intent', now() - interval '1 day', 'sa pe', 'satest:pe', 'admin', v_domain, 99) returning id into s_pe;
  insert into public.signals (source_key, vertical, signal_type, occurred_at, title, dedupe_key, visibility, team_id, company_domain, score)
  values ('web_visitors', 'x', 'site_visit', now(), 'sa visit client', 'satest:visit:c', 'team', t_client, v_domain, 50) returning id into s_visit_client;
  insert into public.signals (source_key, vertical, signal_type, occurred_at, title, dedupe_key, visibility, team_id, company_domain, score)
  values ('web_visitors', 'x', 'site_visit', now(), 'sa visit other', 'satest:visit:o', 'team', t_other, v_domain, 50) returning id into s_visit_other;
  insert into public.signals (source_key, vertical, signal_type, occurred_at, title, dedupe_key, visibility, team_id, company_domain,
                              person_name, person_title, person_email, score)
  values ('web_visitors', 'x', 'site_visit', now(), 'sa named', 'satest:named', 'team', t_client, 'satest-example.com',
          'Pat Q Example', 'Founder & CEO', 'pat@satest-example.com', 60) returning id into s_named;
  insert into public.signals (source_key, vertical, signal_type, occurred_at, title, dedupe_key, visibility, team_id, company_domain,
                              person_name, person_title, person_email, score)
  values ('web_visitors', 'x', 'site_visit', now(), 'sa named intern', 'satest:named2', 'team', t_client, 'satest-example2.com',
          'Sam Example', 'Marketing Intern', 'sam@satest-example2.com', 60) returning id into s_named_bad;
  insert into public.signals (source_key, vertical, signal_type, occurred_at, title, dedupe_key, visibility, company_domain, score)
  values ('openfda_510k', 'x', '510k_cleared', now() - interval '90 days', 'sa old', 'satest:old', 'all_clients', v_domain, 90) returning id into s_old;
  insert into public.signals (source_key, vertical, signal_type, occurred_at, title, dedupe_key, visibility, company_domain, score, payload)
  values ('openfda_510k', 'x', '510k_cleared', now() - interval '1 days', 'sa low', 'satest:low', 'all_clients', v_domain, 10,
          '{"product_code":"ZZZ"}') returning id into s_code;

  -- ------------------------------------------------------- visibility ---
  j := public.signals_audience_candidates(u_client, q, null, null, 500, 0, true);
  select array_agg((x ->> 'id')::uuid) into ids from jsonb_array_elements(j -> 'signals') x;
  if not (s_dom = any(ids)) then raise exception 'FAIL: client does not get the 510(k) candidate'; end if;
  if not (s_visit_client = any(ids)) then raise exception 'FAIL: client does not get its own visitor'; end if;
  if s_pe = any(ids) then raise exception 'FAIL: client got the PE signal as a candidate'; end if;
  if s_visit_other = any(ids) then raise exception 'FAIL: client got another team''s visitor'; end if;
  if (j ->> 'total')::int <> jsonb_array_length(j -> 'signals') then raise exception 'FAIL: total % <> rows', j ->> 'total'; end if;

  j := public.signals_audience_candidates(u_client, q, null, array[s_pe, s_visit_other], 50, 0, true);
  if jsonb_array_length(j -> 'signals') <> 0 then raise exception 'FAIL: client got invisible signals by id: %', j; end if;

  j := public.signals_audience_candidates(u_admin, q, null, array[s_pe], 50, 0, false);
  if jsonb_array_length(j -> 'signals') <> 1 then raise exception 'FAIL: admin cannot use the PE signal'; end if;

  j := public.signals_resolve_people(u_client, array[s_pe, s_visit_other, s_dom], persona_ceo, 2, true);
  if (j ->> 'refused')::int <> 2 then raise exception 'FAIL: resolver did not refuse 2 invisible signals: %', j ->> 'refused'; end if;
  if jsonb_array_length(j -> 'signals') <> 1 or (j -> 'signals' -> 0 ->> 'signal_id')::uuid <> s_dom then
    raise exception 'FAIL: resolver returned an invisible signal';
  end if;

  -- ------------------------------------------------------- candidates ---
  j := public.signals_audience_candidates(u_client, q || '{"fda_product_codes":["LLZ"]}', null, null, 500, 0, false);
  select array_agg((x ->> 'id')::uuid) into ids from jsonb_array_elements(j -> 'signals') x;
  if not (s_dom = any(ids)) or s_name = any(ids) or s_code = any(ids) then raise exception 'FAIL: product-code filter'; end if;
  if not (s_visit_client = any(ids)) then raise exception 'FAIL: an FDA filter must not drop other verticals'; end if;

  j := public.signals_audience_candidates(u_client, q || '{"fda_device_regexes":["\\mcatheter\\M"]}', null, null, 500, 0, false);
  select array_agg((x ->> 'id')::uuid) into ids from jsonb_array_elements(j -> 'signals') x;
  if not (s_dom = any(ids)) or s_name = any(ids) then raise exception 'FAIL: device keyword filter'; end if;

  j := public.signals_audience_candidates(u_client, q || '{"min_score":60}', null, null, 500, 0, false);
  select array_agg((x ->> 'id')::uuid) into ids from jsonb_array_elements(j -> 'signals') x;
  if s_code = any(ids) or s_visit_client = any(ids) then raise exception 'FAIL: min_score'; end if;
  if s_old = any(ids) then raise exception 'FAIL: recency (90-day-old signal in a 30-day window)'; end if;

  -- ------------------------------------------------ resolver a) Vrelly ---
  j := public.signals_resolve_people(u_client, array[s_dom], persona_ceo, 1, true);
  if jsonb_array_length(j -> 'signals' -> 0 -> 'people') <> 1 then
    raise exception 'FAIL: no Vrelly CEO resolved at % (or per_company ignored): %', v_domain, j;
  end if;
  e := j -> 'signals' -> 0 -> 'people' -> 0 ->> 'email';
  if j -> 'signals' -> 0 -> 'people' -> 0 ->> 'source' <> 'vrelly' then raise exception 'FAIL: source not vrelly'; end if;
  if split_part(e, '@', 2) <> v_domain and split_part(e, '@', 2) not like '%.' || v_domain then
    raise exception 'FAIL: email % not at the company domain %', e, v_domain;
  end if;
  if (j -> 'signals' -> 0 -> 'people' -> 0 ->> 'title') !~* '\mCEO\M' then raise exception 'FAIL: persona not applied'; end if;
  if j -> 'signals' -> 0 ->> 'company_key' <> 'd:' || v_domain then raise exception 'FAIL: company_key'; end if;

  -- persona required
  begin
    perform public.signals_resolve_people(u_client, array[s_dom], '{}'::jsonb, 2, true);
    raise exception 'FAIL: empty persona accepted';
  exception when invalid_parameter_value then null;
  end;

  -- name + state -> derived domain
  j := public.signals_resolve_people(u_client, array[s_name], '{"department_patterns":["%"]}'::jsonb, 2, false);
  if j -> 'signals' -> 0 ->> 'derived_domain' is null then
    raise exception 'FAIL: no derived domain for "%, Inc." in %: %', v_cname, v_cstate, j;
  end if;

  -- dedupe: push the resolved person, they are not offered again
  insert into public.agent_audience_pushes (audience_id, user_id, apollo_person_id, email_key, platform)
  values (aud, u_client, 'email:' || e, e, 'reply.io');
  j := public.signals_resolve_people(u_client, array[s_dom], persona_ceo, 10, true);
  if exists (select 1 from jsonb_array_elements(j -> 'signals' -> 0 -> 'people') p where p ->> 'email' = e) then
    raise exception 'FAIL: an already-pushed person was offered again';
  end if;
  j := public.audience_known_contacts(u_client, array[upper(e), 'nobody@satest-example.com'], null);
  if j -> 'emails' <> jsonb_build_array(lower(e)) then raise exception 'FAIL: audience_known_contacts: %', j; end if;

  -- --------------------------------------------- resolver b) named person ---
  j := public.signals_resolve_people(u_client, array[s_named, s_named_bad], persona_ceo, 2, true);
  select x into j from jsonb_array_elements(j -> 'signals') x where (x ->> 'signal_id')::uuid = s_named;
  if j -> 'people' -> 0 ->> 'source' <> 'signal' or j -> 'people' -> 0 ->> 'email' <> 'pat@satest-example.com' then
    raise exception 'FAIL: named person not used: %', j;
  end if;
  j := public.signals_resolve_people(u_client, array[s_named_bad], persona_ceo, 2, true);
  if jsonb_array_length(j -> 'signals' -> 0 -> 'people') <> 0 then
    raise exception 'FAIL: named person with a non-matching title was used: %', j;
  end if;

  -- --------------------------------------------------------- marking ---
  n := public.signals_mark_audience_used(u_client, aud, null, jsonb_build_array(
         jsonb_build_object('signal_id', s_dom, 'outcome', 'pushed', 'people_found', 1, 'people_pushed', 1),
         jsonb_build_object('signal_id', s_name, 'outcome', 'no_people', 'people_found', 0, 'people_pushed', 0),
         jsonb_build_object('signal_id', s_pe, 'outcome', 'pushed', 'people_found', 1, 'people_pushed', 1),
         jsonb_build_object('signal_id', s_visit_other, 'outcome', 'pushed', 'people_found', 1, 'people_pushed', 1)));
  if n <> 2 then raise exception 'FAIL: marked % rows, expected 2 (invisible ignored)', n; end if;
  if (select status from public.signal_team_status where signal_id = s_dom and team_id = t_client) <> 'pushed' then
    raise exception 'FAIL: pushed signal not marked pushed for the team';
  end if;
  if exists (select 1 from public.signal_team_status where signal_id = s_name and team_id = t_client) then
    raise exception 'FAIL: a no_people signal was marked pushed';
  end if;
  if exists (select 1 from public.signal_team_status where signal_id in (s_pe, s_visit_other)) then
    raise exception 'FAIL: an invisible signal got a team status';
  end if;
  begin
    perform public.signals_mark_audience_used(u_client, aud_other, null, '[]'::jsonb);
    raise exception 'FAIL: marked another user''s audience';
  exception when insufficient_privilege then null;
  end;

  -- used by THIS audience -> gone from its candidates, still there for another
  j := public.signals_audience_candidates(u_client, q, aud, null, 500, 0, false);
  if exists (select 1 from jsonb_array_elements(j -> 'signals') x where (x ->> 'id')::uuid in (s_dom, s_name)) then
    raise exception 'FAIL: used signals offered to the same audience again';
  end if;
  j := public.signals_audience_candidates(u_client, q, aud2, null, 500, 0, false);
  if not exists (select 1 from jsonb_array_elements(j -> 'signals') x where (x ->> 'id')::uuid = s_dom) then
    raise exception 'FAIL: a signal used by one audience was hidden from another';
  end if;

  -- dismissed by the team -> left out
  insert into public.signal_team_status (signal_id, team_id, status) values (s_visit_client, t_client, 'dismissed');
  j := public.signals_audience_candidates(u_client, q, aud2, null, 500, 0, false);
  if exists (select 1 from jsonb_array_elements(j -> 'signals') x where (x ->> 'id')::uuid = s_visit_client) then
    raise exception 'FAIL: a dismissed signal was offered';
  end if;

  -- ----------------------------------------------- grants and RLS ---
  if has_function_privilege('authenticated', 'public.signals_resolve_people(uuid, uuid[], jsonb, integer, boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.signals_audience_candidates(uuid, jsonb, uuid, uuid[], integer, integer, boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.signals_mark_audience_used(uuid, uuid, uuid, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.audience_known_contacts(uuid, text[], text[])', 'execute') then
    raise exception 'FAIL: a client can call a service-only signals audience function';
  end if;

  insert into public.signal_contacts (user_id, company_key, source, email) values (u_client, 'd:satest-example.com', 'signal', 'pat@satest-example.com');
  insert into public.signal_contacts (user_id, company_key, source, email) values (u_other, 'd:satest-example.com', 'signal', 'pat@satest-example.com');

  perform set_config('request.jwt.claims', json_build_object('sub', u_other, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.agent_audience_signals where audience_id = aud;
  if n <> 0 then raise exception 'FAIL: another user reads this audience''s signal usage'; end if;
  select count(*) into n from public.signal_contacts where user_id = u_client;
  if n <> 0 then raise exception 'FAIL: another user reads this user''s signal contacts'; end if;
  select count(*) into n from public.signal_contacts;
  if n <> 1 then raise exception 'FAIL: a user should read exactly their own signal contact (got %)', n; end if;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', u_client, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.agent_audience_signals where audience_id = aud;
  if n <> 2 then raise exception 'FAIL: the owner reads % usage rows, expected 2', n; end if;
  begin
    insert into public.signal_contacts (user_id, company_key, source, email) values (u_client, 'd:x.com', 'signal', 'a@x.com');
    raise exception 'FAIL: a client wrote signal_contacts';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';

  raise exception 'SIGNAL_AUDIENCES_PASSED';
end
$t$;
