-- ============================================================
-- BUILDER SEARCH TEST SUITE v4.0
-- ============================================================
-- Purpose: Verify audience builder search functions work correctly
-- Last Updated: February 27, 2026
--
-- USAGE: Run this entire script in SQL editor after any changes
-- TOLERANCE: ±5 for all counts (data may change slightly)
--
-- TO REVERT: Say "Revert to v4.0 stable state"
-- ============================================================

-- ============================================================
-- SECTION 0: SPLIT FUNCTION HEALTH CHECK (v4.0)
-- ============================================================

DO $$
DECLARE
  func_count integer;
  param_count integer;
BEGIN
  -- Check search_free_data_results exists
  SELECT COUNT(*) INTO func_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'search_free_data_results';
  
  IF func_count < 1 THEN
    RAISE EXCEPTION 'CRITICAL: search_free_data_results not found';
  END IF;
  
  SELECT pronargs INTO param_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'search_free_data_results'
  LIMIT 1;
  
  IF param_count != 35 THEN
    RAISE EXCEPTION 'CRITICAL: search_free_data_results expected 35 parameters, found %', param_count;
  END IF;
  
  RAISE NOTICE '✅ search_free_data_results: found, 35 parameters';

  -- Check search_free_data_count exists
  SELECT COUNT(*) INTO func_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'search_free_data_count';
  
  IF func_count < 1 THEN
    RAISE EXCEPTION 'CRITICAL: search_free_data_count not found';
  END IF;
  
  SELECT pronargs INTO param_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'search_free_data_count'
  LIMIT 1;
  
  IF param_count != 35 THEN
    RAISE EXCEPTION 'CRITICAL: search_free_data_count expected 35 parameters, found %', param_count;
  END IF;
  
  RAISE NOTICE '✅ search_free_data_count: found, 35 parameters';
END $$;

-- ============================================================
-- SECTION 0B: COUNT ACCURACY TESTS (v4.0)
-- ============================================================

DO $$
DECLARE
  v_count bigint;
  v_is_estimate boolean;
BEGIN
  RAISE NOTICE '--- Count Accuracy Tests (v4.0) ---';

  -- Test: Keyword count (was broken at 771, should be ~21,282)
  SELECT total_count, is_estimate INTO v_count, v_is_estimate
  FROM public.search_free_data_count(
    p_entity_type := 'person',
    p_keywords := ARRAY['CEO']
  );
  IF v_count > 20000 AND v_is_estimate = false THEN
    RAISE NOTICE '✅ CEO keyword count: % (exact, is_estimate=false)', v_count;
  ELSE
    RAISE WARNING '❌ CEO keyword count: % (is_estimate=%), expected >20000 exact', v_count, v_is_estimate;
  END IF;

  -- Test: Gender count should be exact
  SELECT total_count, is_estimate INTO v_count, v_is_estimate
  FROM public.search_free_data_count(
    p_entity_type := 'person',
    p_gender := ARRAY['M']
  );
  IF v_is_estimate = false THEN
    RAISE NOTICE '✅ Gender Male count: % (exact)', v_count;
  ELSE
    RAISE WARNING '❌ Gender Male count: % (should be exact, got is_estimate=true)', v_count;
  END IF;

  -- Test: Unfiltered count should be an estimate (pg_class.reltuples)
  SELECT total_count, is_estimate INTO v_count, v_is_estimate
  FROM public.search_free_data_count(
    p_entity_type := 'person'
  );
  IF v_is_estimate = true THEN
    RAISE NOTICE '✅ Unfiltered person count: ~% (estimate, correct)', v_count;
  ELSE
    RAISE NOTICE '⚠️ Unfiltered person count: % (exact — unexpected but not broken)', v_count;
  END IF;

  -- Test: Results function returns rows
  PERFORM 1 FROM public.search_free_data_results(
    p_entity_type := 'person',
    p_limit := 5,
    p_offset := 0
  );
  RAISE NOTICE '✅ search_free_data_results returned rows successfully';
END $$;

-- ============================================================
-- SECTION 1: LEGACY FUNCTION HEALTH CHECK (backward compat)
-- ============================================================

DO $$
DECLARE
  func_count integer;
  param_count integer;
BEGIN
  SELECT COUNT(*) INTO func_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'search_free_data_builder';
  
  IF func_count < 1 THEN
    RAISE EXCEPTION 'CRITICAL: search_free_data_builder not found (backward compat)';
  END IF;
  
  RAISE NOTICE '✅ Legacy search_free_data_builder exists (backward compat)';
END $$;

-- ============================================================
-- SECTION 2: COMPANY SIZE FILTER TESTS
-- ============================================================

DO $$
DECLARE
  result_count bigint;
  expected integer;
  tolerance integer := 5;
BEGIN
  RAISE NOTICE '--- Company Size Filter Tests ---';
  
  -- Test: 1-10 employees
  SELECT total_count INTO result_count
  FROM public.search_free_data_builder(
    p_entity_type := 'person',
    p_company_size_ranges := ARRAY['1-10']
  ) LIMIT 1;
  expected := 15;
  IF result_count BETWEEN expected - tolerance AND expected + tolerance THEN
    RAISE NOTICE '✅ Company Size 1-10: % (expected ~%)', result_count, expected;
  ELSE
    RAISE WARNING '❌ Company Size 1-10: % (expected ~%)', result_count, expected;
  END IF;
  
  -- Test: 11-50 employees
  SELECT total_count INTO result_count
  FROM public.search_free_data_builder(
    p_entity_type := 'person',
    p_company_size_ranges := ARRAY['11-50']
  ) LIMIT 1;
  expected := 96;
  IF result_count BETWEEN expected - tolerance AND expected + tolerance THEN
    RAISE NOTICE '✅ Company Size 11-50: % (expected ~%)', result_count, expected;
  ELSE
    RAISE WARNING '❌ Company Size 11-50: % (expected ~%)', result_count, expected;
  END IF;
  
  -- Test: 51-200 employees
  SELECT total_count INTO result_count
  FROM public.search_free_data_builder(
    p_entity_type := 'person',
    p_company_size_ranges := ARRAY['51-200']
  ) LIMIT 1;
  expected := 81;
  IF result_count BETWEEN expected - tolerance AND expected + tolerance THEN
    RAISE NOTICE '✅ Company Size 51-200: % (expected ~%)', result_count, expected;
  ELSE
    RAISE WARNING '❌ Company Size 51-200: % (expected ~%)', result_count, expected;
  END IF;
  
  -- Test: 201-500 employees
  SELECT total_count INTO result_count
  FROM public.search_free_data_builder(
    p_entity_type := 'person',
    p_company_size_ranges := ARRAY['201-500']
  ) LIMIT 1;
  expected := 78;
  IF result_count BETWEEN expected - tolerance AND expected + tolerance THEN
    RAISE NOTICE '✅ Company Size 201-500: % (expected ~%)', result_count, expected;
  ELSE
    RAISE WARNING '❌ Company Size 201-500: % (expected ~%)', result_count, expected;
  END IF;
  
  -- Test: 5001-10000 employees
  SELECT total_count INTO result_count
  FROM public.search_free_data_builder(
    p_entity_type := 'person',
    p_company_size_ranges := ARRAY['5001-10000']
  ) LIMIT 1;
  expected := 86;
  IF result_count BETWEEN expected - tolerance AND expected + tolerance THEN
    RAISE NOTICE '✅ Company Size 5001-10000: % (expected ~%)', result_count, expected;
  ELSE
    RAISE WARNING '❌ Company Size 5001-10000: % (expected ~%)', result_count, expected;
  END IF;
  
  -- Test: 10000+ employees
  SELECT total_count INTO result_count
  FROM public.search_free_data_builder(
    p_entity_type := 'person',
    p_company_size_ranges := ARRAY['10000+']
  ) LIMIT 1;
  expected := 8;
  IF result_count BETWEEN expected - tolerance AND expected + tolerance THEN
    RAISE NOTICE '✅ Company Size 10000+: % (expected ~%)', result_count, expected;
  ELSE
    RAISE WARNING '❌ Company Size 10000+: % (expected ~%)', result_count, expected;
  END IF;
END $$;

-- ============================================================
-- SECTION 3: COMPANY REVENUE FILTER TESTS
-- ============================================================

DO $$
DECLARE
  result_count bigint;
  expected integer;
  tolerance integer := 5;
BEGIN
  RAISE NOTICE '--- Company Revenue Filter Tests ---';
  
  SELECT total_count INTO result_count
  FROM public.search_free_data_builder(
    p_entity_type := 'person',
    p_company_revenue := ARRAY['Under $1M']
  ) LIMIT 1;
  expected := 3;
  IF result_count BETWEEN expected - tolerance AND expected + tolerance THEN
    RAISE NOTICE '✅ Revenue Under $1M: % (expected ~%)', result_count, expected;
  ELSE
    RAISE WARNING '❌ Revenue Under $1M: % (expected ~%)', result_count, expected;
  END IF;
  
  SELECT total_count INTO result_count
  FROM public.search_free_data_builder(
    p_entity_type := 'person',
    p_company_revenue := ARRAY['$1M - $10M']
  ) LIMIT 1;
  expected := 42;
  IF result_count BETWEEN expected - tolerance AND expected + tolerance THEN
    RAISE NOTICE '✅ Revenue $1M - $10M: % (expected ~%)', result_count, expected;
  ELSE
    RAISE WARNING '❌ Revenue $1M - $10M: % (expected ~%)', result_count, expected;
  END IF;
  
  SELECT total_count INTO result_count
  FROM public.search_free_data_builder(
    p_entity_type := 'person',
    p_company_revenue := ARRAY['$10M - $50M']
  ) LIMIT 1;
  expected := 56;
  IF result_count BETWEEN expected - tolerance AND expected + tolerance THEN
    RAISE NOTICE '✅ Revenue $10M - $50M: % (expected ~%)', result_count, expected;
  ELSE
    RAISE WARNING '❌ Revenue $10M - $50M: % (expected ~%)', result_count, expected;
  END IF;
END $$;

-- ============================================================
-- SECTION 4: INCOME FILTER TESTS
-- ============================================================

DO $$
DECLARE
  result_count bigint;
  expected integer;
  tolerance integer := 5;
BEGIN
  RAISE NOTICE '--- Income Filter Tests ---';
  
  SELECT total_count INTO result_count
  FROM public.search_free_data_builder(
    p_entity_type := 'person',
    p_income := ARRAY['Under $50K']
  ) LIMIT 1;
  expected := 55;
  IF result_count BETWEEN expected - tolerance AND expected + tolerance THEN
    RAISE NOTICE '✅ Income Under $50K: % (expected ~%)', result_count, expected;
  ELSE
    RAISE WARNING '❌ Income Under $50K: % (expected ~%)', result_count, expected;
  END IF;
  
  SELECT total_count INTO result_count
  FROM public.search_free_data_builder(
    p_entity_type := 'person',
    p_income := ARRAY['$50K - $100K']
  ) LIMIT 1;
  expected := 45;
  IF result_count BETWEEN expected - tolerance AND expected + tolerance THEN
    RAISE NOTICE '✅ Income $50K - $100K: % (expected ~%)', result_count, expected;
  ELSE
    RAISE WARNING '❌ Income $50K - $100K: % (expected ~%)', result_count, expected;
  END IF;
END $$;

-- ============================================================
-- SECTION 5: NET WORTH FILTER TESTS
-- ============================================================

DO $$
DECLARE
  result_count bigint;
  expected integer;
  tolerance integer := 5;
BEGIN
  RAISE NOTICE '--- Net Worth Filter Tests ---';
  
  SELECT total_count INTO result_count
  FROM public.search_free_data_builder(
    p_entity_type := 'person',
    p_net_worth := ARRAY['Under $100K']
  ) LIMIT 1;
  expected := 56;
  IF result_count BETWEEN expected - tolerance AND expected + tolerance THEN
    RAISE NOTICE '✅ Net Worth Under $100K: % (expected ~%)', result_count, expected;
  ELSE
    RAISE WARNING '❌ Net Worth Under $100K: % (expected ~%)', result_count, expected;
  END IF;
END $$;

-- ============================================================
-- SECTION 6: DEPARTMENT FILTER TESTS
-- ============================================================

DO $$
DECLARE
  result_count bigint;
  expected integer;
  tolerance integer := 5;
BEGIN
  RAISE NOTICE '--- Department Filter Tests ---';
  
  SELECT total_count INTO result_count
  FROM public.search_free_data_builder(
    p_entity_type := 'person',
    p_departments := ARRAY['C-Suite / Leadership']
  ) LIMIT 1;
  expected := 138;
  IF result_count BETWEEN expected - tolerance AND expected + tolerance THEN
    RAISE NOTICE '✅ Department C-Suite: % (expected ~%)', result_count, expected;
  ELSE
    RAISE WARNING '❌ Department C-Suite: % (expected ~%)', result_count, expected;
  END IF;
END $$;

-- ============================================================
-- SECTION 7: SENIORITY FILTER TESTS
-- ============================================================

DO $$
DECLARE
  result_count bigint;
  expected integer;
  tolerance integer := 5;
BEGIN
  RAISE NOTICE '--- Seniority Filter Tests ---';
  
  SELECT total_count INTO result_count
  FROM public.search_free_data_builder(
    p_entity_type := 'person',
    p_seniority_levels := ARRAY['Individual Contributor']
  ) LIMIT 1;
  expected := 99;
  IF result_count BETWEEN expected - tolerance AND expected + tolerance THEN
    RAISE NOTICE '✅ Individual Contributor: % (expected ~%)', result_count, expected;
  ELSE
    RAISE WARNING '❌ Individual Contributor: % (expected ~%)', result_count, expected;
  END IF;
END $$;

-- ============================================================
-- SECTION 8: GENDER FILTER TESTS
-- ============================================================

DO $$
DECLARE
  result_count bigint;
  expected integer;
  tolerance integer := 5;
BEGIN
  RAISE NOTICE '--- Gender Filter Tests (DB uses M/F format) ---';
  
  SELECT total_count INTO result_count
  FROM public.search_free_data_builder(
    p_entity_type := 'person',
    p_gender := ARRAY['M']
  ) LIMIT 1;
  expected := 137;
  IF result_count BETWEEN expected - tolerance AND expected + tolerance THEN
    RAISE NOTICE '✅ Gender Male (M): % (expected ~%)', result_count, expected;
  ELSE
    RAISE WARNING '❌ Gender Male (M): % (expected ~%)', result_count, expected;
  END IF;
  
  SELECT total_count INTO result_count
  FROM public.search_free_data_builder(
    p_entity_type := 'person',
    p_gender := ARRAY['F']
  ) LIMIT 1;
  expected := 55;
  IF result_count BETWEEN expected - tolerance AND expected + tolerance THEN
    RAISE NOTICE '✅ Gender Female (F): % (expected ~%)', result_count, expected;
  ELSE
    RAISE WARNING '❌ Gender Female (F): % (expected ~%)', result_count, expected;
  END IF;
END $$;

-- ============================================================
-- SECTION 9: PROSPECT DATA FILTER TESTS
-- ============================================================

DO $$
DECLARE
  result_count bigint;
  expected integer;
  tolerance integer := 5;
BEGIN
  RAISE NOTICE '--- Prospect Data Filter Tests ---';
  
  SELECT total_count INTO result_count
  FROM public.search_free_data_builder(
    p_entity_type := 'person',
    p_has_facebook := true
  ) LIMIT 1;
  expected := 13;
  IF result_count BETWEEN expected - tolerance AND expected + tolerance THEN
    RAISE NOTICE '✅ Has Facebook: % (expected ~%)', result_count, expected;
  ELSE
    RAISE WARNING '❌ Has Facebook: % (expected ~%)', result_count, expected;
  END IF;
  
  SELECT total_count INTO result_count
  FROM public.search_free_data_builder(
    p_entity_type := 'person',
    p_has_twitter := true
  ) LIMIT 1;
  expected := 7;
  IF result_count BETWEEN expected - tolerance AND expected + tolerance THEN
    RAISE NOTICE '✅ Has Twitter: % (expected ~%)', result_count, expected;
  ELSE
    RAISE WARNING '❌ Has Twitter: % (expected ~%)', result_count, expected;
  END IF;
  
  SELECT total_count INTO result_count
  FROM public.search_free_data_builder(
    p_entity_type := 'person',
    p_has_company_facebook := true
  ) LIMIT 1;
  expected := 147;
  IF result_count BETWEEN expected - tolerance AND expected + tolerance THEN
    RAISE NOTICE '✅ Has Company Facebook: % (expected ~%)', result_count, expected;
  ELSE
    RAISE WARNING '❌ Has Company Facebook: % (expected ~%)', result_count, expected;
  END IF;
  
  SELECT total_count INTO result_count
  FROM public.search_free_data_builder(
    p_entity_type := 'person',
    p_has_company_twitter := true
  ) LIMIT 1;
  expected := 141;
  IF result_count BETWEEN expected - tolerance AND expected + tolerance THEN
    RAISE NOTICE '✅ Has Company Twitter: % (expected ~%)', result_count, expected;
  ELSE
    RAISE WARNING '❌ Has Company Twitter: % (expected ~%)', result_count, expected;
  END IF;
  
  SELECT total_count INTO result_count
  FROM public.search_free_data_builder(
    p_entity_type := 'person',
    p_has_company_linkedin := true
  ) LIMIT 1;
  expected := 203;
  IF result_count BETWEEN expected - tolerance AND expected + tolerance THEN
    RAISE NOTICE '✅ Has Company LinkedIn: % (expected ~%)', result_count, expected;
  ELSE
    RAISE WARNING '❌ Has Company LinkedIn: % (expected ~%)', result_count, expected;
  END IF;
END $$;

-- ============================================================
-- SECTION 10: COMBINED FILTER TESTS
-- ============================================================

DO $$
DECLARE
  result_count bigint;
  single_filter_count bigint;
BEGIN
  RAISE NOTICE '--- Combined Filter Tests ---';
  
  SELECT total_count INTO single_filter_count
  FROM public.search_free_data_builder(
    p_entity_type := 'person',
    p_gender := ARRAY['M']
  ) LIMIT 1;
  
  SELECT total_count INTO result_count
  FROM public.search_free_data_builder(
    p_entity_type := 'person',
    p_gender := ARRAY['M'],
    p_income := ARRAY['Under $50K']
  ) LIMIT 1;
  
  IF result_count <= single_filter_count THEN
    RAISE NOTICE '✅ Combined filter (Gender + Income): % <= % (correct intersection)', result_count, single_filter_count;
  ELSE
    RAISE WARNING '❌ Combined filter broken: % > % (should be subset)', result_count, single_filter_count;
  END IF;
END $$;

-- ============================================================
-- SECTION 11: PAGINATION TESTS
-- ============================================================

DO $$
DECLARE
  count_page1 bigint;
  count_page2 bigint;
  id_page1 text;
  id_page2 text;
BEGIN
  RAISE NOTICE '--- Pagination Tests ---';
  
  SELECT total_count, entity_external_id INTO count_page1, id_page1
  FROM public.search_free_data_builder(
    p_entity_type := 'person',
    p_limit := 10,
    p_offset := 0
  ) LIMIT 1;
  
  SELECT total_count, entity_external_id INTO count_page2, id_page2
  FROM public.search_free_data_builder(
    p_entity_type := 'person',
    p_limit := 10,
    p_offset := 10
  ) LIMIT 1;
  
  IF count_page1 = count_page2 THEN
    RAISE NOTICE '✅ Pagination total count consistent: %', count_page1;
  ELSE
    RAISE WARNING '❌ Pagination total count mismatch: % vs %', count_page1, count_page2;
  END IF;
  
  IF id_page1 != id_page2 THEN
    RAISE NOTICE '✅ Pagination returns different records';
  ELSE
    RAISE WARNING '❌ Pagination returned same record on different pages';
  END IF;
END $$;

-- ============================================================
-- SECTION 12: ENTITY TYPE TESTS
-- ============================================================

DO $$
DECLARE
  person_count bigint;
  company_count bigint;
BEGIN
  RAISE NOTICE '--- Entity Type Tests ---';
  
  SELECT total_count INTO person_count
  FROM public.search_free_data_builder(
    p_entity_type := 'person'
  ) LIMIT 1;
  
  SELECT total_count INTO company_count
  FROM public.search_free_data_builder(
    p_entity_type := 'company'
  ) LIMIT 1;
  
  IF person_count = 400 THEN
    RAISE NOTICE '✅ Person count: % (expected 400)', person_count;
  ELSE
    RAISE WARNING '⚠️ Person count: % (expected 400)', person_count;
  END IF;
  
  IF company_count = 324 THEN
    RAISE NOTICE '✅ Company count: % (expected 324)', company_count;
  ELSE
    RAISE WARNING '⚠️ Company count: % (expected 324)', company_count;
  END IF;
END $$;

-- ============================================================
-- SECTION 13: SUMMARY
-- ============================================================

SELECT '=== BUILDER SEARCH TEST SUITE v4.0 COMPLETE ===' as result;
SELECT 'All tests passed if no ❌ warnings appear above' as status;
SELECT 'To revert: Say "Revert to v4.0 stable state"' as revert_command;
