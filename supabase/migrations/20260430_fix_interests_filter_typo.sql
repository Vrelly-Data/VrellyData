-- Fix: Interests filter typo — p_person_skills[i] referenced inside the
-- IF p_person_interests block of search_prospects_results.
--
-- Symptom: Setting only Person Interest and clicking Search throws
--   "query string argument of EXECUTE is null"
--
-- Root cause: the loop that builds the ILIKE clause against p.interests
-- reads p_person_skills[i] (a different parameter) instead of
-- p_person_interests[i]. When the user has the Interests filter set but
-- no Skills filter, p_person_skills is NULL → quote_literal('%' || NULL ||
-- '%') is NULL → v_where becomes NULL → the final EXECUTE fails.
--
-- One-character fix: change p_person_skills[i] → p_person_interests[i]
-- inside the interests block. Surgical replace via pg_get_functiondef +
-- REPLACE + EXECUTE so every other filter block is left untouched.
--
-- The pattern below is unique to the (buggy) interests block: it's the
-- only line in the function that writes to p.interests, so a string
-- replace cannot accidentally hit the legitimate skills block (which
-- writes to p.skills).
--
-- Run this in the Supabase SQL Editor.

-- Step 1: Verify the typo is present in the live function
SELECT 'CURRENT INTERESTS BLOCK:' AS status,
  CASE WHEN strpos(prosrc, 'p.interests ILIKE '' || quote_literal(''%'' || p_person_skills[i]') > 0
    THEN 'Typo present — needs fix'
    ELSE 'Typo not detected — check function manually before proceeding'
  END AS result
FROM pg_proc
WHERE proname = 'search_prospects_results'
  AND pronamespace = 'public'::regnamespace;

-- Step 2: Apply the fix
DO $do$
DECLARE
  v_func_def   text;
  v_old_pattern text;
  v_new_pattern text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_func_def
  FROM pg_proc
  WHERE proname = 'search_prospects_results'
    AND pronamespace = 'public'::regnamespace;

  IF v_func_def IS NULL THEN
    RAISE EXCEPTION 'Function search_prospects_results not found';
  END IF;

  -- The buggy line, verbatim. p.interests + p_person_skills together make
  -- this match unique to the one buggy occurrence — the real skills block
  -- writes to p.skills, not p.interests.
  v_old_pattern := $$'p.interests ILIKE ' || quote_literal('%' || p_person_skills[i] || '%')$$;
  v_new_pattern := $$'p.interests ILIKE ' || quote_literal('%' || p_person_interests[i] || '%')$$;

  IF position(v_old_pattern in v_func_def) = 0 THEN
    RAISE EXCEPTION 'Buggy pattern not found — the Interests block may have a different shape than expected. Apply manually: inside the IF p_person_interests IS NOT NULL block, change p_person_skills[i] to p_person_interests[i].';
  END IF;

  v_func_def := replace(v_func_def, v_old_pattern, v_new_pattern);

  -- Sanity: the new pattern is now present, the old one is gone
  IF position(v_new_pattern in v_func_def) = 0 THEN
    RAISE EXCEPTION 'Replacement failed unexpectedly — aborting before EXECUTE';
  END IF;
  IF position(v_old_pattern in v_func_def) > 0 THEN
    RAISE EXCEPTION 'Old pattern still present after replace — aborting before EXECUTE';
  END IF;

  EXECUTE v_func_def;

  RAISE NOTICE 'SUCCESS: search_prospects_results updated — p_person_skills[i] → p_person_interests[i] inside the interests block';
END $do$;

-- Step 3: Post-fix verification
SELECT 'POST-FIX VERIFICATION:' AS status,
  CASE
    WHEN strpos(prosrc, 'p.interests ILIKE '' || quote_literal(''%'' || p_person_interests[i]') > 0
     AND strpos(prosrc, 'p.interests ILIKE '' || quote_literal(''%'' || p_person_skills[i]')    = 0
    THEN 'SUCCESS — interests block now reads p_person_interests[i]'
    ELSE 'CHECK MANUALLY — replacement may not have applied cleanly'
  END AS result
FROM pg_proc
WHERE proname = 'search_prospects_results'
  AND pronamespace = 'public'::regnamespace;

-- ============================================================================
-- MANUAL FALLBACK: If the automated replacement fails, open
-- search_prospects_results in the SQL Editor, find this line inside the
-- `IF p_person_interests IS NOT NULL` block:
--
--   v_where := v_where || 'p.interests ILIKE ' || quote_literal('%' || p_person_skills[i] || '%');
--
-- and change `p_person_skills[i]` to `p_person_interests[i]`:
--
--   v_where := v_where || 'p.interests ILIKE ' || quote_literal('%' || p_person_interests[i] || '%');
-- ============================================================================
