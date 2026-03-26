-- Fix: Seniority filter performance + work_mem + company_city index
--
-- Three changes to fix multi-filter query timeouts:
--
-- 1. Seniority filter: changed from ILIKE to lower() = ANY() to use
--    the new btree index (idx_prospects_seniority_btree) instead of
--    the trigram GIN index. Seniority values are exact matches (no wildcards),
--    so btree produces precise bitmaps with zero false positives.
--
-- 2. work_mem = 256MB: set inside the function to prevent lossy bitmap blocks.
--    Default 5MB caused BitmapAnd results to go lossy (page-level instead of
--    row-level), requiring 400K+ row rechecks. With 256MB, bitmaps stay exact.
--
-- 3. company_city trigram index: enables BitmapOr for city filter's OR condition
--    (p.city ILIKE ... OR p.company_city ILIKE ...). Without it, the OR forced
--    sequential scanning of company_city.
--
-- Results: job_titles+seniority went from timeout to 278ms,
--          seniority+department+city went from timeout to 1951ms.

-- Step 1: Create btree index on lower(seniority) for exact match queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_prospects_seniority_btree
  ON prospects (lower(seniority));

-- Step 2: Create trigram index on company_city for city OR conditions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_prospects_company_city_trgm
  ON prospects USING gin (company_city gin_trgm_ops);

-- Step 3: Update search_prospects_results function
-- Changes:
--   a) Add SET LOCAL work_mem = '256MB' at start of function body
--   b) Change seniority filter from ILIKE to lower() = ANY()
--
-- Apply via pg_get_functiondef replacement (same pattern as previous migrations):
DO $do$
DECLARE
  v_func_def text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_func_def
  FROM pg_proc
  WHERE proname = 'search_prospects_results'
    AND pronamespace = 'public'::regnamespace;

  IF v_func_def IS NULL THEN
    RAISE EXCEPTION 'Function search_prospects_results not found';
  END IF;

  -- a) Add work_mem if not already present
  IF v_func_def NOT LIKE '%SET LOCAL work_mem%' THEN
    v_func_def := replace(v_func_def,
      'BEGIN' || chr(10) || '  IF p_job_titles',
      'BEGIN' || chr(10) || '  -- Increase work_mem to prevent lossy bitmap blocks in multi-filter queries' || chr(10) || '  EXECUTE ''SET LOCAL work_mem = ''''256MB'''''';' || chr(10) || chr(10) || '  IF p_job_titles'
    );
    RAISE NOTICE 'Added work_mem setting';
  END IF;

  -- b) Change seniority ILIKE to lower() = ANY() if still using ILIKE
  IF v_func_def LIKE '%p.seniority ILIKE%' THEN
    v_func_def := replace(v_func_def,
      $$v_where := v_where || ' AND (';
    FOR i IN 1..array_length(p_seniority_levels, 1) LOOP
      IF i > 1 THEN v_where := v_where || ' OR '; END IF;
      v_where := v_where || 'p.seniority ILIKE ' || quote_literal(p_seniority_levels[i]);
    END LOOP;
    v_where := v_where || ')';$$,
      $$v_where := v_where || ' AND lower(p.seniority) = ANY(ARRAY[' ||
      array_to_string(ARRAY(SELECT quote_literal(lower(x)) FROM unnest(p_seniority_levels) x), ',') || '])';$$
    );
    RAISE NOTICE 'Changed seniority filter to lower() = ANY()';
  END IF;

  EXECUTE v_func_def;
  RAISE NOTICE 'Function updated successfully';
END $do$;

-- Step 4: Also add work_mem to search_prospects_count if not present
DO $do$
DECLARE
  v_func_def text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_func_def
  FROM pg_proc
  WHERE proname = 'search_prospects_count'
    AND pronamespace = 'public'::regnamespace;

  IF v_func_def IS NULL THEN
    RAISE NOTICE 'search_prospects_count not found, skipping';
    RETURN;
  END IF;

  IF v_func_def NOT LIKE '%SET LOCAL work_mem%' THEN
    v_func_def := regexp_replace(v_func_def,
      'BEGIN\n  IF p_job_titles',
      E'BEGIN\n  EXECUTE ''SET LOCAL work_mem = ''''256MB'''''';\\n\\n  IF p_job_titles'
    );
    EXECUTE v_func_def;
    RAISE NOTICE 'Added work_mem to search_prospects_count';
  END IF;
END $do$;

-- Step 5: Verify
SELECT 'VERIFICATION' AS status,
  CASE WHEN prosrc LIKE '%lower(p.seniority) = ANY%' THEN 'OK' ELSE 'MISSING' END AS seniority_btree,
  CASE WHEN prosrc LIKE '%SET LOCAL work_mem%' THEN 'OK' ELSE 'MISSING' END AS work_mem
FROM pg_proc
WHERE proname = 'search_prospects_results'
  AND pronamespace = 'public'::regnamespace;
