-- Verification for 20260816120000_agent_audiences.sql, post trigger fix.
--
-- Run in the SAME project AFTER applying the corrected
-- agent_audiences_guard_activation(). Self-contained, ends in ROLLBACK.
--
-- Results go to a TEMP TABLE and are SELECTed at the end, because the Supabase
-- Studio SQL editor does not reliably display RAISE NOTICE output.
--
-- Every blocked-activation check asserts BOTH that an exception was raised AND
-- that is_active is still false. The first harness asserted only the exception,
-- which is the weaker property, and that is exactly what let the trigger bug
-- hide: the row was never activated, but no error was raised either.

BEGIN;

CREATE TEMP TABLE _verify_results (
  step INT, check_name TEXT, result TEXT
) ON COMMIT DROP;

DO $$
DECLARE
  v_user   UUID;
  v_config UUID;
  v_aud    UUID;
  v_run    UUID;
  v_camp   UUID;
  v_raised BOOLEAN;
  v_active BOOLEAN;
  v_total  INT;
  v_hr_blocked BOOLEAN;
BEGIN
  SELECT c.user_id, c.id INTO v_user, v_config
  FROM public.agent_configs c ORDER BY c.created_at LIMIT 1;

  IF v_user IS NULL THEN
    INSERT INTO _verify_results VALUES
      (0, 'prerequisite: an agent_configs row exists',
          'ABORTED — none found. Seed one and re-run. Data prerequisite, not a schema failure.');
    RETURN;
  END IF;

  SELECT id INTO v_camp FROM public.synced_campaigns LIMIT 1;

  -- 1. create lands inactive
  INSERT INTO public.agent_audiences
    (user_id, agent_config_id, name, platform, max_per_run, filters)
  VALUES (v_user, v_config, '__verify__ CEOs in healthcare', 'smartlead', 25,
          '{"person_titles":["CEO"],"q_keywords":"healthcare"}'::jsonb)
  RETURNING id INTO v_aud;
  INSERT INTO _verify_results VALUES (1, 'create audience', 'PASS');

  SELECT NOT is_active INTO v_active FROM public.agent_audiences WHERE id = v_aud;
  INSERT INTO _verify_results VALUES
    (2, 'defaults to is_active=false', CASE WHEN v_active THEN 'PASS' ELSE 'FAIL' END);

  -- 3. no campaign, no successful run -> must RAISE and stay inactive
  v_raised := false;
  BEGIN
    UPDATE public.agent_audiences SET is_active = true WHERE id = v_aud;
  EXCEPTION WHEN check_violation THEN v_raised := true;
  END;
  SELECT is_active INTO v_active FROM public.agent_audiences WHERE id = v_aud;
  INSERT INTO _verify_results VALUES (3,
    'activation blocked, no successful run (no campaign)',
    CASE WHEN v_raised AND NOT v_active THEN 'PASS'
         ELSE 'FAIL — raised=' || v_raised::text || ' is_active=' || v_active::text END);

  -- 4. a FAILED run does not unlock -> must RAISE and stay inactive
  INSERT INTO public.agent_audience_runs (audience_id, user_id, trigger, status, finished_at)
  VALUES (v_aud, v_user, 'manual', 'failed', now());
  v_raised := false;
  BEGIN
    UPDATE public.agent_audiences SET is_active = true WHERE id = v_aud;
  EXCEPTION WHEN check_violation THEN v_raised := true;
  END;
  SELECT is_active INTO v_active FROM public.agent_audiences WHERE id = v_aud;
  INSERT INTO _verify_results VALUES (4,
    'a failed run does not unlock activation',
    CASE WHEN v_raised AND NOT v_active THEN 'PASS'
         ELSE 'FAIL — raised=' || v_raised::text || ' is_active=' || v_active::text END);

  -- 5. THE UNCONFOUNDED CASE: campaign linked, still only a failed run.
  IF v_camp IS NULL THEN
    INSERT INTO _verify_results VALUES (5,
      'activation blocked WITH campaign linked, no successful run',
      'SKIPPED — no synced_campaigns row in this project');
  ELSE
    UPDATE public.agent_audiences SET synced_campaign_id = v_camp WHERE id = v_aud;
    v_raised := false;
    BEGIN
      UPDATE public.agent_audiences SET is_active = true WHERE id = v_aud;
    EXCEPTION WHEN check_violation THEN v_raised := true;
    END;
    SELECT is_active INTO v_active FROM public.agent_audiences WHERE id = v_aud;
    INSERT INTO _verify_results VALUES (5,
      'activation blocked WITH campaign linked, no successful run',
      CASE WHEN v_raised AND NOT v_active THEN 'PASS'
           ELSE 'FAIL — raised=' || v_raised::text || ' is_active=' || v_active::text END);
  END IF;

  -- 6. a SUCCESSFUL run unlocks (campaign required)
  INSERT INTO public.agent_audience_runs (audience_id, user_id, trigger, status, finished_at)
  VALUES (v_aud, v_user, 'manual', 'success', now())
  RETURNING id INTO v_run;

  IF v_camp IS NULL THEN
    INSERT INTO _verify_results VALUES (6,
      'a successful run unlocks activation', 'SKIPPED — no synced_campaigns row');
  ELSE
    UPDATE public.agent_audiences
       SET is_active = true, synced_campaign_id = v_camp WHERE id = v_aud;
    SELECT is_active INTO v_active FROM public.agent_audiences WHERE id = v_aud;
    INSERT INTO _verify_results VALUES (6,
      'a successful run unlocks activation',
      CASE WHEN v_active THEN 'PASS' ELSE 'FAIL — did not activate' END);
  END IF;

  -- 7. an already-active row losing its campaign deactivates SILENTLY (no raise)
  IF v_camp IS NULL THEN
    INSERT INTO _verify_results VALUES (7,
      'losing the campaign auto-deactivates without raising', 'SKIPPED — no synced_campaigns row');
  ELSE
    v_raised := false;
    BEGIN
      UPDATE public.agent_audiences SET synced_campaign_id = NULL WHERE id = v_aud;
    EXCEPTION WHEN check_violation THEN v_raised := true;
    END;
    SELECT is_active INTO v_active FROM public.agent_audiences WHERE id = v_aud;
    INSERT INTO _verify_results VALUES (7,
      'losing the campaign auto-deactivates without raising',
      CASE WHEN NOT v_raised AND NOT v_active THEN 'PASS'
           ELSE 'FAIL — raised=' || v_raised::text || ' is_active=' || v_active::text END);
  END IF;

  -- 8. activation with a successful run but NO campaign must RAISE
  --    (this is the silent no-op the first version produced)
  v_raised := false;
  BEGIN
    UPDATE public.agent_audiences
       SET is_active = true, synced_campaign_id = NULL WHERE id = v_aud;
  EXCEPTION WHEN check_violation THEN v_raised := true;
  END;
  SELECT is_active INTO v_active FROM public.agent_audiences WHERE id = v_aud;
  INSERT INTO _verify_results VALUES (8,
    'activation without a campaign link raises (no longer a silent no-op)',
    CASE WHEN v_raised AND NOT v_active THEN 'PASS'
         ELSE 'FAIL — raised=' || v_raised::text || ' is_active=' || v_active::text END);

  -- 9. duplicate apollo_person_id blocked
  INSERT INTO public.agent_audience_pushes
    (audience_id, user_id, run_id, apollo_person_id, email_key)
  VALUES (v_aud, v_user, v_run, 'apollo_person_1', 'someone@example.com');
  BEGIN
    INSERT INTO public.agent_audience_pushes
      (audience_id, user_id, run_id, apollo_person_id, email_key)
    VALUES (v_aud, v_user, v_run, 'apollo_person_1', 'other@example.com');
    INSERT INTO _verify_results VALUES (9, 'duplicate apollo_person_id blocked', 'FAIL — it allowed it');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO _verify_results VALUES (9, 'duplicate apollo_person_id blocked', 'PASS');
  END;

  -- 10. duplicate email_key blocked even with a different person id
  BEGIN
    INSERT INTO public.agent_audience_pushes
      (audience_id, user_id, run_id, apollo_person_id, email_key)
    VALUES (v_aud, v_user, v_run, 'apollo_person_2', 'someone@example.com');
    INSERT INTO _verify_results VALUES (10, 'duplicate email_key blocked', 'FAIL — it allowed it');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO _verify_results VALUES (10, 'duplicate email_key blocked', 'PASS');
  END;

  -- 11. partial index still allows many NULL email_keys; total_pushed tracks
  INSERT INTO public.agent_audience_pushes
    (audience_id, user_id, apollo_person_id, email_key, linkedin_key)
  VALUES (v_aud, v_user, 'apollo_person_3', NULL, 'linkedin.com/in/a');
  INSERT INTO public.agent_audience_pushes
    (audience_id, user_id, apollo_person_id, email_key, linkedin_key)
  VALUES (v_aud, v_user, 'apollo_person_4', NULL, 'linkedin.com/in/b');
  SELECT total_pushed INTO v_total FROM public.agent_audiences WHERE id = v_aud;
  INSERT INTO _verify_results VALUES (11,
    'multiple NULL email_keys allowed; total_pushed auto-incremented to 3',
    CASE WHEN v_total = 3 THEN 'PASS' ELSE 'FAIL — total_pushed=' || v_total::text END);

  -- 12. platform CHECK excludes heyreach; max_per_run upper bound enforced
  v_hr_blocked := false;
  BEGIN
    INSERT INTO public.agent_audiences (user_id, agent_config_id, name, platform, max_per_run)
    VALUES (v_user, v_config, '__verify__ heyreach', 'heyreach', 10);
  EXCEPTION WHEN check_violation THEN v_hr_blocked := true;
  END;
  v_raised := false;
  BEGIN
    INSERT INTO public.agent_audiences (user_id, agent_config_id, name, platform, max_per_run)
    VALUES (v_user, v_config, '__verify__ toobig', 'smartlead', 5000);
  EXCEPTION WHEN check_violation THEN v_raised := true;
  END;
  INSERT INTO _verify_results VALUES (12,
    'heyreach rejected (v1) and max_per_run bound enforced',
    CASE WHEN v_hr_blocked AND v_raised THEN 'PASS'
         ELSE 'FAIL — heyreach_blocked=' || v_hr_blocked::text
              || ' maxrun_blocked=' || v_raised::text END);
END $$;

-- === READ THIS GRID FIRST ===
SELECT step, check_name, result FROM _verify_results ORDER BY step;

SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('agent_audiences','agent_audience_runs','agent_audience_pushes')
ORDER BY table_name, ordinal_position;

SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('agent_audiences','agent_audience_runs','agent_audience_pushes')
ORDER BY tablename, indexname;

SELECT tablename, policyname, cmd, qual::text AS using_expr, with_check::text AS with_check_expr
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('agent_audiences','agent_audience_runs','agent_audience_pushes')
ORDER BY tablename;

SELECT c.relname AS table_name, t.tgname AS trigger_name, p.proname AS function_name
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_proc  p ON p.oid = t.tgfoid
WHERE NOT t.tgisinternal
  AND c.relname IN ('agent_audiences','agent_audience_runs','agent_audience_pushes')
ORDER BY c.relname, t.tgname;

ROLLBACK;
