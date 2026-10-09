-- vrelly_audience_search + push dedup — database test, run against DEV.
--
-- Dev's prospects are 30 synthetic @example.com rows (see
-- docs/SEARCH_PROSPECTS_REFERENCE.md §4), so this checks behaviour, not
-- prod performance. Everything runs in one DO block that ALWAYS ends by raising,
-- so nothing it writes survives: the final message is either
-- 'VRELLY_SEARCH_TESTS_PASSED (n checks)' or the first failed check.
--
-- Run: paste into the dev SQL editor (or execute_sql) as-is.
do $t$
declare
  dup_ok boolean;
  u uuid := (select user_id from public.agent_configs where is_active order by created_at limit 1);
  cfg uuid := (select id from public.agent_configs where user_id = u and is_active limit 1);
  aud uuid;
  r jsonb;
  emails text[];
  n int := 0;
  q jsonb;
begin
  if u is null then raise exception 'no active agent_config on this database to test with'; end if;
  -- Start from an empty push ledger for this user so earlier dev runs (the
  -- end-to-end script pushes real dev prospects) cannot change the counts.
  -- Safe: the whole block is rolled back.
  delete from public.agent_audience_pushes where user_id = u;

  -- 1. contains-match on title, ordered by id, with count
  r := public.vrelly_audience_search(u, '{"title_regexes":["\\mchief\\M"]}', 25, 0, true);
  select array_agg(x->>'email' order by x->>'prospect_id') into emails from jsonb_array_elements(r->'people') x;
  if coalesce(array_length(emails, 1), 0) <> 3 or (r->>'total')::int <> 3 then
    raise exception 'check 1 (title contains) failed: %', r; end if;
  n := n + 1;

  -- 2. AND across filters, OR within: VP in Texas (state given as code AND name)
  r := public.vrelly_audience_search(u, '{"seniorities":["vp"],"person_states":["tx","texas"]}', 25, 0, true);
  if (r->>'total')::int <> 2 then raise exception 'check 2 (seniority AND state) failed: %', r; end if;
  n := n + 1;

  -- 3. an escaped underscore is literal: "vp\_of" matches nothing, "vp of" matches 5
  r := public.vrelly_audience_search(u, '{"title_regexes":["\\mvp_of\\M"]}', 25, 0, true);
  if (r->>'total')::int <> 0 then raise exception 'check 3a (regex _ is literal) failed: %', r; end if;
  r := public.vrelly_audience_search(u, '{"title_regexes":["\\mvp\\s+of\\M"]}', 25, 0, true);
  if (r->>'total')::int <> 5 then raise exception 'check 3b (vp of) failed: %', r; end if;
  n := n + 1;

  -- 3c. excluded titles drop out ("VP of Product" here); NULL titles survive
  r := public.vrelly_audience_search(u, '{"title_regexes":["\\mvp\\s+of\\M"],"exclude_title_regexes":["\\mproduct\\M"]}', 25, 0, true);
  if (r->>'total')::int <> 4 or r::text ilike '%VP of Product%' then
    raise exception 'check 3c (exclude titles) failed: %', r; end if;
  n := n + 1;

  -- 4. paging walks the id order without overlap
  q := '{"title_regexes":["\\mvp\\s+of\\M"]}';
  r := public.vrelly_audience_search(u, q, 2, 0);
  emails := array(select x->>'prospect_id' from jsonb_array_elements(r->'people') x);
  r := public.vrelly_audience_search(u, q, 2, 2);
  if emails && array(select x->>'prospect_id' from jsonb_array_elements(r->'people') x)
     or emails[1] >= emails[2] then
    raise exception 'check 4 (paging) failed'; end if;
  n := n + 1;

  -- 5. rows come back complete: email, names, title, company, location
  r := public.vrelly_audience_search(u, '{"title_regexes":["\\mchief\\s+executive\\M"]}', 1, 0);
  if r->'people'->0->>'email' is null or r->'people'->0->>'first_name' is null
     or r->'people'->0->>'title' is null or r->'people'->0->>'company_name' is null then
    raise exception 'check 5 (complete rows) failed: %', r; end if;
  n := n + 1;

  -- 6. DEDUP. Push two of the three "chief" people: one recorded by EMAIL only,
  --    one by LINKEDIN only (under a different email). Both must drop out.
  insert into public.agent_audiences (user_id, agent_config_id, name, source, filters_version, filters, max_per_run)
  values (u, cfg, 'vrelly search test ' || gen_random_uuid(), 'vrelly', 2, '{"job_titles":["chief"]}', 10)
  returning id into aud;

  insert into public.agent_audience_pushes (audience_id, user_id, prospect_id, email_key, linkedin_key, platform)
  select aud, u, s.id, s.email_key, null, 'reply.io'
  from public.prospect_audience_search s where s.job_title = 'Chief Financial Officer';
  -- A push must carry apollo_person_id or prospect_id (CHECK).
  begin
    insert into public.agent_audience_pushes (audience_id, user_id, email_key, platform)
    values (aud, u, 'nobody@example.org', 'reply.io');
    raise exception 'check 6a (person key CHECK) failed: a push with neither key was accepted';
  exception when check_violation then null;
  end;
  n := n + 1;
  insert into public.agent_audience_pushes (audience_id, user_id, prospect_id, email_key, linkedin_key, platform)
  select aud, u, gen_random_uuid(), 'someone-else@example.org', s.linkedin_key, 'reply.io'
  from public.prospect_audience_search s where s.job_title = 'Chief Marketing Officer';

  r := public.vrelly_audience_search(u, '{"title_regexes":["\\mchief\\M"]}', 25, 0, true);
  if (r->>'total')::int <> 1 or r->'people'->0->>'title' <> 'Chief Executive Officer' then
    raise exception 'check 6b (exclude by email AND by linkedin) failed: %', r; end if;
  n := n + 1;

  -- 7. the database refuses a second push of the same email or the same LinkedIn
  dup_ok := false;
  begin
    insert into public.agent_audience_pushes (audience_id, user_id, prospect_id, email_key, platform)
    select aud, u, gen_random_uuid(), s.email_key, 'reply.io'
    from public.prospect_audience_search s where s.job_title = 'Chief Financial Officer';
  exception when unique_violation then dup_ok := true;
  end;
  if not dup_ok then raise exception 'check 7a (unique email) failed'; end if;
  dup_ok := false;
  begin
    insert into public.agent_audience_pushes (audience_id, user_id, prospect_id, email_key, linkedin_key, platform)
    select aud, u, gen_random_uuid(), 'third@example.org', s.linkedin_key, 'reply.io'
    from public.prospect_audience_search s where s.job_title = 'Chief Marketing Officer';
  exception when unique_violation then dup_ok := true;
  end;
  if not dup_ok then raise exception 'check 7b (unique linkedin) failed'; end if;
  n := n + 1;

  -- 8. explicit prospect ids are still subject to the exclusions
  r := public.vrelly_audience_search(u, '{"title_regexes":["\\mchief\\M"]}', 25, 0, false,
         100000, array(select id from public.prospect_audience_search where job_title like 'Chief%'));
  if jsonb_array_length(r->'people') <> 1 then raise exception 'check 8 (explicit ids excluded) failed: %', r; end if;
  n := n + 1;

  -- 9. refusals: no filter at all; a keyword made only of stop words
  begin
    perform public.vrelly_audience_search(u, '{}', 25, 0);
    raise exception 'check 9a (no filter) failed';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.vrelly_audience_search(u, '{"keywords":["the and of"]}', 25, 0);
    raise exception 'check 9b (stop-word keyword) failed';
  exception when invalid_parameter_value then null;
  end;
  n := n + 1;

  -- 10. LinkedIn key normalization matches _shared/lead-dedup.ts
  if public.audience_linkedin_key('HTTPS://www.LinkedIn.com/in/Jane-Doe/?trk=x#y') <> 'linkedin.com/in/jane-doe'
     or public.audience_linkedin_key('  ') is not null then
    raise exception 'check 10 (linkedin key) failed'; end if;
  n := n + 1;

  -- 11. KEYWORDS (dev's prospects have no descriptions, so add three, then
  --     rebuild the views inside this rolled-back block).
  --     Terms are OR-ed; the words of one term must all appear, in any order.
  insert into public.prospects (source, first_name, last_name, business_email, job_title, company_name, company_description, country)
  values ('vrelly_search_test', 'Kw', 'One', 'kw1@example.com', 'Partner', 'A', 'A private firm investing growth equity in software.', 'US'),
         ('vrelly_search_test', 'Kw', 'Two', 'kw2@example.com', 'Partner', 'B', 'Consumer lending and loans for small businesses.', 'US'),
         ('vrelly_search_test', 'Kw', 'Three', 'kw3@example.com', 'Partner', 'C', 'Public equity research.', 'US');
  refresh materialized view public.prospect_audience_search;
  refresh materialized view public.prospect_audience_keywords;
  r := public.vrelly_audience_search(u, '{"title_regexes":["\\mpartner\\M"],"keywords":["private equity"]}', 25, 0, true);
  if (r->>'total')::int <> 1 or r->'people'->0->>'email' <> 'kw1@example.com' or (r->>'total_is_estimate')::boolean then
    raise exception 'check 11a (words of a term AND-ed, any order; exact when few candidates) failed: %', r; end if;
  r := public.vrelly_audience_search(u, '{"title_regexes":["\\mpartner\\M"],"keywords":["loan","private equity"]}', 25, 0, true);
  if (r->>'total')::int <> 2 then raise exception 'check 11b (terms OR-ed, stemmed loan~loans) failed: %', r; end if;
  n := n + 1;

  -- 12. DATA QUALITY (20261008210000): first valid email only; a "US" row whose
  --     state is not a US state is country-unknown; "Owner" is a whole word.
  insert into public.prospects (source, first_name, business_email, job_title, country, state)
  values ('vrelly_search_test', 'Multi', 'Multi@X.example.com, other@y.example.com', 'Zeta Owner', 'US', 'TX'),
         ('vrelly_search_test', 'Uk', 'uk@x.example.com', 'Zeta Owner', 'US', 'ENG'),
         ('vrelly_search_test', 'Bad', 'not-an-email', 'Zeta Owner', 'US', 'TX'),
         ('vrelly_search_test', 'Home', 'home@x.example.com', 'Zeta Homeownership Lead', 'US', 'TX');
  refresh materialized view public.prospect_audience_search;
  r := public.vrelly_audience_search(u, '{"title_regexes":["\\mzeta\\M"],"person_countries":["us"]}', 25, 0, true);
  if (r->>'total')::int <> 2 then raise exception 'check 12a (bad email row left out; ENG row not US) failed: %', r; end if;
  if not (r::text ilike '%multi@x.example.com%' and r::text not ilike '%other@y%') then
    raise exception 'check 12b (first address only, lower-cased) failed: %', r; end if;
  r := public.vrelly_audience_search(u, '{"title_regexes":["\\mzeta\\M"],"person_states":["eng"]}', 25, 0, true);
  if (r->>'total')::int <> 1 then raise exception 'check 12c (ENG row still searchable by state) failed: %', r; end if;
  r := public.vrelly_audience_search(u, '{"title_regexes":["\\mowner\\M"],"person_states":["tx"]}', 25, 0, true);
  if r::text ilike '%Homeownership%' or (r->>'total')::int < 1 then
    raise exception 'check 12d (Owner is a whole word) failed: %', r; end if;
  n := n + 1;

  -- 13. EMAIL GUARDS (20261008210000): with a company_domain the email must be on
  --     it or a subdomain; without one anything goes. A US-only country filter
  --     drops emails on foreign ccTLDs; a UK filter does not.
  insert into public.prospects (source, first_name, business_email, company_domain, job_title, country, state)
  values ('vrelly_search_test', 'Match', 'a@acme.example.com', 'https://www.acme.example.com/about', 'Yeta Owner', 'US', 'TX'),
         ('vrelly_search_test', 'Sub', 'b@mail.acme.example.com', 'acme.example.com', 'Yeta Owner', 'US', 'TX'),
         ('vrelly_search_test', 'Other', 'c@oldjob.example.com', 'acme.example.com', 'Yeta Owner', 'US', 'TX'),
         ('vrelly_search_test', 'NoDom', 'd@whatever.example.com', null, 'Yeta Owner', 'US', 'TX'),
         ('vrelly_search_test', 'Uk', 'e@firm.co.uk', null, 'Yeta Owner', 'US', null),
         ('vrelly_search_test', 'Io', 'f@startup.io', null, 'Yeta Owner', 'US', null);
  refresh materialized view public.prospect_audience_search;
  r := public.vrelly_audience_search(u, '{"title_regexes":["\\myeta\\M"]}', 25, 0, true);
  if (r->>'total')::int <> 5 or r::text ilike '%oldjob%' then
    raise exception 'check 13a (email must be on the company domain or a subdomain; none = allowed) failed: %', r; end if;
  r := public.vrelly_audience_search(u, '{"title_regexes":["\\myeta\\M"],"person_countries":["united states","us","usa"]}', 25, 0, true);
  if (r->>'total')::int <> 4 or r::text ilike '%firm.co.uk%' then
    raise exception 'check 13b (US filter drops .co.uk, keeps .io) failed: %', r; end if;
  r := public.vrelly_audience_search(u, '{"title_regexes":["\\myeta\\M"],"person_countries":["us","united kingdom"]}', 25, 0, true);
  if (r->>'total')::int <> 5 then raise exception 'check 13c (mixed-country filter keeps .co.uk) failed: %', r; end if;
  n := n + 1;

raise exception 'VRELLY_SEARCH_TESTS_PASSED (% checks) — rolled back', n using errcode = 'P0001';
end
$t$;
