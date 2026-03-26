-- Fix: Replace to_tsquery with plainto_tsquery for keywords filter
-- in search_prospects_results function.
--
-- Problem: to_tsquery times out on single keyword-only searches but works
-- with keyword + other filter combinations. plainto_tsquery handles plain
-- text input better and produces better query plans for simple searches.
--
-- Run this in the Supabase SQL Editor.

-- Step 1: Verify the current function uses to_tsquery for keywords
SELECT 'CURRENT KEYWORD IMPLEMENTATION:' AS status,
  CASE WHEN prosrc LIKE '%to_tsquery%'
    THEN 'Uses to_tsquery - needs fix'
    ELSE 'Already using plainto_tsquery or other - check manually'
  END AS result
FROM pg_proc
WHERE proname = 'search_prospects_results'
  AND pronamespace = 'public'::regnamespace;

-- Step 2: Apply the fix via dynamic replacement on the function body
DO $do$
DECLARE
  v_src text;
  v_new_src text;
  v_func_def text;
  v_old_pattern text;
  v_new_pattern text;
BEGIN
  -- Get the raw function body
  SELECT prosrc INTO v_src
  FROM pg_proc
  WHERE proname = 'search_prospects_results'
    AND pronamespace = 'public'::regnamespace;

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'Function search_prospects_results not found';
  END IF;

  IF v_src NOT LIKE '%to_tsquery%' THEN
    RAISE EXCEPTION 'Function does not contain to_tsquery - may already be fixed';
  END IF;

  -- Get the full function definition (includes CREATE OR REPLACE, params, settings)
  SELECT pg_get_functiondef(oid) INTO v_func_def
  FROM pg_proc
  WHERE proname = 'search_prospects_results'
    AND pronamespace = 'public'::regnamespace;

  -- The old keyword block (single to_tsquery with | joined keywords):
  v_old_pattern := $$v_where := v_where || ' AND to_tsvector(''english'', coalesce(p.job_title,'''') || '' '' || coalesce(p.company_name,'''') || '' '' || coalesce(p.company_industry,'''') || '' '' || coalesce(p.company_description,'''')) @@ to_tsquery(''english'', ' || quote_literal(array_to_string(p_keywords, ' | ')) || ')';$$;

  -- The new keyword block (loop with OR'd plainto_tsquery per keyword):
  v_new_pattern := $$v_where := v_where || ' AND (';
    FOR i IN 1..array_length(p_keywords, 1) LOOP
      IF i > 1 THEN v_where := v_where || ' OR '; END IF;
      v_where := v_where || 'to_tsvector(''english'', coalesce(p.job_title,'''') || '' '' || coalesce(p.company_name,'''') || '' '' || coalesce(p.company_industry,'''') || '' '' || coalesce(p.company_description,'''')) @@ plainto_tsquery(''english'', ' || quote_literal(p_keywords[i]) || ')';
    END LOOP;
    v_where := v_where || ')';$$;

  -- Do the replacement on the full function definition
  v_func_def := replace(v_func_def, v_old_pattern, v_new_pattern);

  -- Verify replacement happened
  IF v_func_def LIKE '%to_tsquery%' AND v_func_def NOT LIKE '%plainto_tsquery%' THEN
    RAISE EXCEPTION 'Replacement pattern did not match. The function source may have different formatting. Please apply the change manually using the instructions in the comments below.';
  END IF;

  -- Execute the modified function definition
  EXECUTE v_func_def;

  RAISE NOTICE 'SUCCESS: search_prospects_results updated - to_tsquery replaced with plainto_tsquery for keywords filter';
END $do$;

-- Step 3: Verify the fix was applied
SELECT 'POST-FIX VERIFICATION:' AS status,
  CASE
    WHEN prosrc LIKE '%plainto_tsquery%' AND prosrc NOT LIKE '%to_tsquery(''english'', '' || quote_literal(array_to_string%'
      THEN 'SUCCESS - now using plainto_tsquery'
    WHEN prosrc LIKE '%to_tsquery%' AND prosrc NOT LIKE '%plainto_tsquery%'
      THEN 'FAILED - still using to_tsquery'
    ELSE 'PARTIAL - check function manually'
  END AS result
FROM pg_proc
WHERE proname = 'search_prospects_results'
  AND pronamespace = 'public'::regnamespace;

-- ============================================================================
-- MANUAL FALLBACK: If the automated replacement fails, find this line in
-- search_prospects_results (in the KEYWORDS section):
--
--   v_where := v_where || ' AND to_tsvector(''english'', ...) @@ to_tsquery(''english'', ' || quote_literal(array_to_string(p_keywords, ' | ')) || ')';
--
-- And replace it with:
--
--   v_where := v_where || ' AND (';
--   FOR i IN 1..array_length(p_keywords, 1) LOOP
--     IF i > 1 THEN v_where := v_where || ' OR '; END IF;
--     v_where := v_where || 'to_tsvector(''english'', coalesce(p.job_title,'''') || '' '' || coalesce(p.company_name,'''') || '' '' || coalesce(p.company_industry,'''') || '' '' || coalesce(p.company_description,'''')) @@ plainto_tsquery(''english'', ' || quote_literal(p_keywords[i]) || ')';
--   END LOOP;
--   v_where := v_where || ')';
-- ============================================================================
