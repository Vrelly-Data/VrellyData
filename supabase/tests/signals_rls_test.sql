-- Signals visibility (RLS) test. Run on dev after the 3 signals migrations.
-- Everything happens inside one block that ends by raising SIGNALS_RLS_PASSED,
-- so all test users, teams and signals are rolled back. Any other error = FAIL.
--
-- Proves, as real 'authenticated' sessions (auth.uid() from request.jwt.claims):
--   a client reads a 510(k) signal (all_clients)
--   a client does NOT read a PE signal (admin), even by id, feed or overview
--   a client does NOT read another team's website visitor (team)
--   a client reads its own team's visitor
--   a platform admin reads all three
--   anon reads nothing; clients can't write signals directly
--   an admin-only source can't write a wider row (guard trigger)
--   status is per team and can't be set on a signal the caller can't see

do $t$
declare
  u_client uuid := gen_random_uuid();
  u_other  uuid := gen_random_uuid();
  u_admin  uuid := gen_random_uuid();
  t_client uuid := gen_random_uuid();
  t_other  uuid := gen_random_uuid();
  t_admin  uuid := gen_random_uuid();
  s_510k uuid; s_pe uuid; s_visit_client uuid; s_visit_other uuid;
  n int; j jsonb; ok boolean;
begin
  -- fixtures (as the migration owner)
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
  insert into public.teams (id, name) values (t_client, 'rls client team'), (t_other, 'rls other team'), (t_admin, 'rls admin team');
  insert into public.team_memberships (user_id, team_id, role) values (u_client, t_client, 'member'), (u_other, t_other, 'member'), (u_admin, t_admin, 'member');

  insert into public.signals (source_key, vertical, signal_type, occurred_at, title, dedupe_key, visibility)
  values ('openfda_510k', 'x', '510k_cleared', now(), 'rls 510k', 'rlstest:510k', 'all_clients') returning id into s_510k;
  insert into public.signals (source_key, vertical, signal_type, occurred_at, title, dedupe_key, visibility)
  values ('pe_seller_intent', 'x', 'seller_intent', now(), 'rls pe', 'rlstest:pe', 'admin') returning id into s_pe;
  insert into public.signals (source_key, vertical, signal_type, occurred_at, title, dedupe_key, visibility, team_id)
  values ('web_visitors', 'x', 'site_visit', now(), 'rls visit client', 'rlstest:visit:client', 'team', t_client) returning id into s_visit_client;
  insert into public.signals (source_key, vertical, signal_type, occurred_at, title, dedupe_key, visibility, team_id)
  values ('web_visitors', 'x', 'site_visit', now(), 'rls visit other', 'rlstest:visit:other', 'team', t_other) returning id into s_visit_other;

  -- guard: vertical always from the source
  if (select vertical from public.signals where id = s_510k) <> 'medical_device' then
    raise exception 'FAIL: vertical not taken from the source';
  end if;
  -- guard: an admin-only source cannot write a wider row
  begin
    insert into public.signals (source_key, vertical, signal_type, occurred_at, title, dedupe_key, visibility)
    values ('pe_seller_intent', 'x', 'seller_intent', now(), 'leak', 'rlstest:pe-leak', 'all_clients');
    raise exception 'FAIL: PE row with all_clients was accepted';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  -- and signals_upsert forces admin for an admin-only source
  j := public.signals_upsert('pe_seller_intent', jsonb_build_array(jsonb_build_object(
         'signal_type', 'seller_intent', 'occurred_at', now(), 'title', 'via upsert', 'dedupe_key', 'rlstest:pe-upsert', 'score', 50, 'visibility', 'all_clients')));
  if (select visibility from public.signals where dedupe_key = 'rlstest:pe-upsert') <> 'admin' then
    raise exception 'FAIL: signals_upsert widened a PE row';
  end if;
  -- upsert again: unchanged → deduped, changed → updated
  j := public.signals_upsert('pe_seller_intent', jsonb_build_array(jsonb_build_object(
         'signal_type', 'seller_intent', 'occurred_at', (select occurred_at from public.signals where dedupe_key = 'rlstest:pe-upsert'),
         'title', 'via upsert', 'dedupe_key', 'rlstest:pe-upsert', 'score', 50)));
  if (j->>'inserted')::int <> 0 or (j->>'updated')::int <> 0 or (j->>'deduped')::int <> 1 then
    raise exception 'FAIL: identical upsert should be deduped: %', j;
  end if;

  -- ---------------------------------------------------- client session ---
  perform set_config('request.jwt.claims', json_build_object('sub', u_client, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.signals where id = s_510k;
  if n <> 1 then raise exception 'FAIL: client cannot read the 510(k) signal'; end if;
  select count(*) into n from public.signals where id = s_pe;
  if n <> 0 then raise exception 'FAIL: client can read the PE signal'; end if;
  select count(*) into n from public.signals where id = s_visit_other;
  if n <> 0 then raise exception 'FAIL: client can read another team''s visitor'; end if;
  select count(*) into n from public.signals where id = s_visit_client;
  if n <> 1 then raise exception 'FAIL: client cannot read its own team''s visitor'; end if;
  select count(*) into n from public.signals where visibility = 'admin';
  if n <> 0 then raise exception 'FAIL: client sees % admin rows', n; end if;

  j := public.signals_feed('private_equity');
  if (j->>'total')::int <> 0 then raise exception 'FAIL: client feed shows PE rows: %', j->'total'; end if;
  j := public.signals_feed('medical_device', p_search => 'rls 510k');
  if (j->>'total')::int <> 1 then raise exception 'FAIL: client feed misses the 510(k) row'; end if;
  j := public.signals_overview();
  if exists (select 1 from jsonb_array_elements(j) e where e->>'vertical' = 'private_equity') then
    raise exception 'FAIL: client overview lists the private_equity vertical';
  end if;
  select count(*) into n from public.signal_sources;
  if n <> 0 then raise exception 'FAIL: client can read signal_sources (config)'; end if;
  select count(*) into n from public.signal_runs;
  if n <> 0 then raise exception 'FAIL: client can read signal_runs'; end if;

  -- status: per team; nothing happens on a signal the client can't see
  n := public.signals_set_status(array[s_510k, s_pe, s_visit_other], 'reviewed');
  if n <> 1 then raise exception 'FAIL: set_status touched % rows (want 1: the 510k only)', n; end if;
  j := public.signals_feed('medical_device', p_search => 'rls 510k', p_status => 'reviewed');
  if (j->>'total')::int <> 1 then raise exception 'FAIL: reviewed status not visible to its team'; end if;

  -- no direct writes
  begin
    insert into public.signals (source_key, vertical, signal_type, occurred_at, title, dedupe_key, visibility)
    values ('openfda_510k', 'x', 'x_test', now(), 'client write', 'rlstest:client-write', 'all_clients');
    raise exception 'FAIL: client inserted a signal';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.signals_upsert('openfda_510k', '[]'::jsonb);
    raise exception 'FAIL: client can call signals_upsert';
  exception when insufficient_privilege then null;
  end;

  -- ----------------------------------------------- other team's session ---
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', u_other, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.signals where id in (s_visit_client, s_pe);
  if n <> 0 then raise exception 'FAIL: other team sees the client''s visitor or PE'; end if;
  j := public.signals_feed('medical_device', p_search => 'rls 510k', p_status => 'reviewed');
  if (j->>'total')::int <> 0 then raise exception 'FAIL: the client''s reviewed status leaked to another team'; end if;

  -- ----------------------------------------------------- admin session ---
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.signals where id in (s_510k, s_pe, s_visit_client, s_visit_other);
  if n <> 4 then raise exception 'FAIL: admin sees % of 4', n; end if;
  select count(*) into n from public.signal_sources;
  if n < 5 then raise exception 'FAIL: admin sees % sources', n; end if;
  j := public.signals_admin_source_stats();
  if jsonb_array_length(j) < 5 then raise exception 'FAIL: admin source stats %', j; end if;

  -- ------------------------------------------------------ anon session ---
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  begin
    select count(*) into n from public.signals;
    raise exception 'FAIL: anon can select signals (% rows)', n;
  exception when insufficient_privilege then null;
  end;

  execute 'reset role';
  raise exception 'SIGNALS_RLS_PASSED' using errcode = 'P0001';
end
$t$;
