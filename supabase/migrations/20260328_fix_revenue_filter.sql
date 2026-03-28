-- Fix: Revenue filter uses parse_revenue_to_numeric() which never matches
-- the plain English format stored in prospects.company_revenue
-- (e.g. "Under 1 Million", "1 Million To 5 Million", "1 Billion And Over").
--
-- Replace the numeric-parsing CASE block with direct string matching
-- in both search_prospects_results and search_prospects_count.

-- ============================================================
-- Step 1: Fix search_prospects_results
-- ============================================================
DO $do$
DECLARE
  v_func_def text;
  v_before text;
  v_after text;
  v_start int;
  v_end_pos int;
  v_search_from int;
  v_new_block text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_func_def
  FROM pg_proc
  WHERE proname = 'search_prospects_results'
    AND pronamespace = 'public'::regnamespace;

  IF v_func_def IS NULL THEN
    RAISE EXCEPTION 'Function search_prospects_results not found';
  END IF;

  IF v_func_def NOT LIKE '%parse_revenue_to_numeric%' THEN
    RAISE NOTICE 'search_prospects_results: no parse_revenue_to_numeric found — already fixed or different structure';
    RETURN;
  END IF;

  -- Locate the revenue IF block
  v_start := strpos(v_func_def, 'IF p_company_revenue IS NOT NULL');
  IF v_start = 0 THEN
    RAISE EXCEPTION 'Could not find revenue IF block in search_prospects_results';
  END IF;

  -- Find the END IF; that closes this block (first one after the start)
  v_search_from := v_start;
  v_end_pos := strpos(substring(v_func_def FROM v_search_from), 'END IF;');
  IF v_end_pos = 0 THEN
    RAISE EXCEPTION 'Could not find END IF for revenue block in search_prospects_results';
  END IF;
  -- Convert to absolute position; include 'END IF;' (7 chars)
  v_end_pos := v_search_from + v_end_pos + 6;

  v_before := substring(v_func_def FROM 1 FOR v_start - 1);
  v_after  := substring(v_func_def FROM v_end_pos + 1);

  v_new_block := $$IF p_company_revenue IS NOT NULL AND array_length(p_company_revenue, 1) > 0 THEN
    v_where := v_where || ' AND p.company_revenue = ANY(ARRAY[' ||
      array_to_string(ARRAY(
        SELECT quote_literal(val) FROM (
          SELECT unnest(
            CASE LOWER(x)
              WHEN 'under $1m' THEN ARRAY['Under 1 Million']
              WHEN '$1m - $10m' THEN ARRAY['1 Million To 5 Million', '5 Million To 10 Million']
              WHEN '$10m - $50m' THEN ARRAY['10 Million To 25 Million', '25 Million To 50 Million']
              WHEN '$50m - $100m' THEN ARRAY['50 Million To 100 Million']
              WHEN '$100m - $500m' THEN ARRAY['100 Million To 250 Million', '250 Million To 500 Million']
              WHEN '$500m - $1b' THEN ARRAY['500 Million To 1 Billion']
              WHEN '$1b+' THEN ARRAY['1 Billion And Over']
              ELSE ARRAY[]::text[]
            END
          ) AS val
          FROM unnest(p_company_revenue) x
        ) sub
      ), ',') || '])';
  END IF;$$;

  v_func_def := v_before || v_new_block || v_after;

  -- Sanity check: parse_revenue_to_numeric should be gone
  IF v_func_def LIKE '%parse_revenue_to_numeric%' THEN
    RAISE EXCEPTION 'Replacement failed — parse_revenue_to_numeric still present in search_prospects_results';
  END IF;

  EXECUTE v_func_def;
  RAISE NOTICE 'SUCCESS: search_prospects_results revenue filter updated to direct string matching';
END $do$;


-- ============================================================
-- Step 2: Fix search_prospects_count
-- ============================================================
DO $do$
DECLARE
  v_func_def text;
  v_before text;
  v_after text;
  v_start int;
  v_end_pos int;
  v_search_from int;
  v_new_block text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_func_def
  FROM pg_proc
  WHERE proname = 'search_prospects_count'
    AND pronamespace = 'public'::regnamespace;

  IF v_func_def IS NULL THEN
    RAISE EXCEPTION 'Function search_prospects_count not found';
  END IF;

  IF v_func_def NOT LIKE '%parse_revenue_to_numeric%' THEN
    RAISE NOTICE 'search_prospects_count: no parse_revenue_to_numeric found — already fixed or different structure';
    RETURN;
  END IF;

  -- Locate the revenue IF block
  v_start := strpos(v_func_def, 'IF p_company_revenue IS NOT NULL');
  IF v_start = 0 THEN
    RAISE EXCEPTION 'Could not find revenue IF block in search_prospects_count';
  END IF;

  -- Find the END IF; that closes this block
  v_search_from := v_start;
  v_end_pos := strpos(substring(v_func_def FROM v_search_from), 'END IF;');
  IF v_end_pos = 0 THEN
    RAISE EXCEPTION 'Could not find END IF for revenue block in search_prospects_count';
  END IF;
  v_end_pos := v_search_from + v_end_pos + 6;

  v_before := substring(v_func_def FROM 1 FOR v_start - 1);
  v_after  := substring(v_func_def FROM v_end_pos + 1);

  v_new_block := $$IF p_company_revenue IS NOT NULL AND array_length(p_company_revenue, 1) > 0 THEN
    v_where := v_where || ' AND p.company_revenue = ANY(ARRAY[' ||
      array_to_string(ARRAY(
        SELECT quote_literal(val) FROM (
          SELECT unnest(
            CASE LOWER(x)
              WHEN 'under $1m' THEN ARRAY['Under 1 Million']
              WHEN '$1m - $10m' THEN ARRAY['1 Million To 5 Million', '5 Million To 10 Million']
              WHEN '$10m - $50m' THEN ARRAY['10 Million To 25 Million', '25 Million To 50 Million']
              WHEN '$50m - $100m' THEN ARRAY['50 Million To 100 Million']
              WHEN '$100m - $500m' THEN ARRAY['100 Million To 250 Million', '250 Million To 500 Million']
              WHEN '$500m - $1b' THEN ARRAY['500 Million To 1 Billion']
              WHEN '$1b+' THEN ARRAY['1 Billion And Over']
              ELSE ARRAY[]::text[]
            END
          ) AS val
          FROM unnest(p_company_revenue) x
        ) sub
      ), ',') || '])';
  END IF;$$;

  v_func_def := v_before || v_new_block || v_after;

  IF v_func_def LIKE '%parse_revenue_to_numeric%' THEN
    RAISE EXCEPTION 'Replacement failed — parse_revenue_to_numeric still present in search_prospects_count';
  END IF;

  EXECUTE v_func_def;
  RAISE NOTICE 'SUCCESS: search_prospects_count revenue filter updated to direct string matching';
END $do$;


-- ============================================================
-- Step 3: Verify both functions
-- ============================================================
SELECT
  proname AS function_name,
  CASE
    WHEN prosrc LIKE '%parse_revenue_to_numeric%' THEN 'FAILED — still uses parse_revenue_to_numeric'
    WHEN prosrc LIKE '%Under 1 Million%' THEN 'OK — uses direct string matching'
    ELSE 'UNKNOWN — check manually'
  END AS revenue_filter_status
FROM pg_proc
WHERE proname IN ('search_prospects_results', 'search_prospects_count')
  AND pronamespace = 'public'::regnamespace;
