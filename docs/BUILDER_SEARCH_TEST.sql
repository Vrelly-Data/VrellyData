-- ============================================================
-- BUILDER SEARCH TEST SUITE v3.2
-- ============================================================
-- Purpose: Verify search_free_data_builder function works correctly
-- Last Updated: January 17, 2026
-- Stable Migration: 20260117175524_38595ba8-3317-4946-8c7a-25ee0c6d6037.sql
--
-- USAGE: Run this entire script in SQL editor after any changes
-- TOLERANCE: ±5 for all counts (data may change slightly)
--
-- TO REVERT: Say "Revert to v3.2 stable state"
-- ============================================================

-- ============================================================
-- SECTION 1: FUNCTION HEALTH CHECK
-- ============================================================

DO $$
DECLARE
  func_count integer;
  param_count integer;
BEGIN
  -- Check exactly 1 function exists
  SELECT COUNT(*) INTO func_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'search_free_data_builder';
  
  IF func_count != 1 THEN
    RAISE EXCEPTION 'CRITICAL: Expected 1 search_free_data_builder, found %', func_count;
  END IF;
  
  -- Check 29 parameters
  SELECT pronargs INTO param_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'search_free_data_builder';
  
  IF param_count != 29 THEN
    RAISE EXCEPTION 'CRITICAL: Expected 29 parameters, found %', param_count;
  END IF;
  
  RAISE NOTICE '✅ Function health check passed: 1 function, 29 parameters';
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
  
  -- Test: 5001-10000 employees (NEW in v3.1)
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
  
  -- Test: 10000+ employees (NEW in v3.1)
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
  
  -- Test: Under $1M
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
  
  -- Test: $1M - $10M
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
  
  -- Test: $10M - $50M
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
  
  -- Test: Under $50K (UPDATED in v3.2)
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
  
  -- Test: $50K - $100K (with spaces)
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
  
  -- Test: Under $100K
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
  
  -- Test: C-Suite / Leadership
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
  
  -- Test: Individual Contributor (NEW in v3.1)
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
  RAISE NOTICE '--- Gender Filter Tests ---';
  
  -- Test: Male
  SELECT total_count INTO result_count
  FROM public.search_free_data_builder(
    p_entity_type := 'person',
    p_gender := ARRAY['male']
  ) LIMIT 1;
  expected := 74;
  IF result_count BETWEEN expected - tolerance AND expected + tolerance THEN
    RAISE NOTICE '✅ Gender Male: % (expected ~%)', result_count, expected;
  ELSE
    RAISE WARNING '❌ Gender Male: % (expected ~%)', result_count, expected;
  END IF;
  
  -- Test: Female
  SELECT total_count INTO result_count
  FROM public.search_free_data_builder(
    p_entity_type := 'person',
    p_gender := ARRAY['female']
  ) LIMIT 1;
  expected := 18;
  IF result_count BETWEEN expected - tolerance AND expected + tolerance THEN
    RAISE NOTICE '✅ Gender Female: % (expected ~%)', result_count, expected;
  ELSE
    RAISE WARNING '❌ Gender Female: % (expected ~%)', result_count, expected;
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
  
  -- Test: Has Personal Facebook
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
  
  -- Test: Has Personal Twitter
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
  
  -- Test: Has Company Facebook
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
  
  -- Test: Has Company Twitter
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
  
  -- Test: Has Company LinkedIn
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
  
  -- Get single filter count for comparison
  SELECT total_count INTO single_filter_count
  FROM public.search_free_data_builder(
    p_entity_type := 'person',
    p_gender := ARRAY['male']
  ) LIMIT 1;
  
  -- Test: Gender + Income (should be less than single filter)
  SELECT total_count INTO result_count
  FROM public.search_free_data_builder(
    p_entity_type := 'person',
    p_gender := ARRAY['male'],
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
  
  -- Get first page
  SELECT total_count, entity_external_id INTO count_page1, id_page1
  FROM public.search_free_data_builder(
    p_entity_type := 'person',
    p_limit := 10,
    p_offset := 0
  ) LIMIT 1;
  
  -- Get second page
  SELECT total_count, entity_external_id INTO count_page2, id_page2
  FROM public.search_free_data_builder(
    p_entity_type := 'person',
    p_limit := 10,
    p_offset := 10
  ) LIMIT 1;
  
  -- Total count should be same across pages
  IF count_page1 = count_page2 THEN
    RAISE NOTICE '✅ Pagination total count consistent: %', count_page1;
  ELSE
    RAISE WARNING '❌ Pagination total count mismatch: % vs %', count_page1, count_page2;
  END IF;
  
  -- IDs should be different
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
  
  -- Test person entity type (should be ~400)
  SELECT total_count INTO person_count
  FROM public.search_free_data_builder(
    p_entity_type := 'person'
  ) LIMIT 1;
  
  -- Test company entity type (should be ~324)
  SELECT total_count INTO company_count
  FROM public.search_free_data_builder(
    p_entity_type := 'company'
  ) LIMIT 1;
  
  RAISE NOTICE '✅ Person records: % (expected ~400)', COALESCE(person_count, 0);
  RAISE NOTICE '✅ Company records: % (expected ~324)', COALESCE(company_count, 0);
  
  IF person_count BETWEEN 395 AND 405 THEN
    RAISE NOTICE '✅ Person count in expected range';
  ELSE
    RAISE WARNING '❌ Person count outside expected range (395-405)';
  END IF;
  
  IF company_count BETWEEN 319 AND 329 THEN
    RAISE NOTICE '✅ Company count in expected range';
  ELSE
    RAISE WARNING '❌ Company count outside expected range (319-329)';
  END IF;
END $$;

-- ============================================================
-- TEST COMPLETE
-- ============================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'BUILDER SEARCH TEST SUITE v3.2 COMPLETE';
  RAISE NOTICE 'Total Records: 724 (400 person, 324 company)';
  RAISE NOTICE 'Stable Migration: 20260117175524_38595ba8-3317-4946-8c7a-25ee0c6d6037.sql';
  RAISE NOTICE 'To revert: Say "Revert to v3.2 stable state"';
  RAISE NOTICE '============================================================';
END $$;
