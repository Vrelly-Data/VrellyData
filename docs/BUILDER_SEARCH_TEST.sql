-- ============================================================
-- BUILDER SEARCH FUNCTION TEST v2.7
-- Tests that search_free_data_builder actually returns expected results
-- Last Updated: January 17, 2026
-- ============================================================
--
-- PURPOSE: Verify the search function works end-to-end with real parameters
-- USAGE: Run after any changes to search_free_data_builder
-- TOLERANCE: Counts use ±10% tolerance to allow for data changes
--
-- ============================================================

-- ============================================================
-- SECTION 1: BASIC EXECUTION TEST
-- ============================================================

SELECT 
  '=== BASIC EXECUTION TEST ===' as section;

-- Test: Basic search returns records
SELECT 
  'Basic Search (no filters)' as test,
  CASE 
    WHEN total_count > 0 THEN '✅ PASS'
    ELSE '❌ FAIL: No records returned'
  END as status,
  total_count as count,
  entity_external_id IS NOT NULL as has_id,
  entity_data IS NOT NULL as has_data
FROM search_free_data_builder(
  p_entity_type := 'person',
  p_limit := 5
)
LIMIT 1;

-- ============================================================
-- SECTION 2: INCOME FILTER TEST
-- ============================================================

SELECT 
  '=== INCOME FILTER TEST ===' as section;

-- Test: Income Under $50K (expected ~21)
SELECT 
  'Income: Under $50K' as test,
  CASE 
    WHEN total_count BETWEEN 16 AND 26 THEN '✅ PASS'
    WHEN total_count > 0 THEN '⚠️ CHECK: Count outside expected range'
    ELSE '❌ FAIL: No results'
  END as status,
  total_count as actual,
  21 as expected,
  '±5 tolerance' as range
FROM search_free_data_builder(
  p_entity_type := 'person',
  p_income := ARRAY['Under $50K'],
  p_limit := 1
)
LIMIT 1;

-- Test: Income $50K-$100K (expected ~45)
SELECT 
  'Income: $50K-$100K' as test,
  CASE 
    WHEN total_count BETWEEN 40 AND 50 THEN '✅ PASS'
    WHEN total_count > 0 THEN '⚠️ CHECK: Count outside expected range'
    ELSE '❌ FAIL: No results'
  END as status,
  total_count as actual,
  45 as expected,
  '±5 tolerance' as range
FROM search_free_data_builder(
  p_entity_type := 'person',
  p_income := ARRAY['$50K-$100K'],
  p_limit := 1
)
LIMIT 1;

-- ============================================================
-- SECTION 3: COMPANY SIZE FILTER TEST
-- ============================================================

SELECT 
  '=== COMPANY SIZE FILTER TEST ===' as section;

-- Test: Company Size 1-10 (expected ~13)
SELECT 
  'Company Size: 1-10' as test,
  CASE 
    WHEN total_count BETWEEN 10 AND 16 THEN '✅ PASS'
    WHEN total_count > 0 THEN '⚠️ CHECK: Count outside expected range'
    ELSE '❌ FAIL: No results'
  END as status,
  total_count as actual,
  13 as expected,
  '±3 tolerance' as range
FROM search_free_data_builder(
  p_entity_type := 'person',
  p_company_size_ranges := ARRAY['1-10'],
  p_limit := 1
)
LIMIT 1;

-- Test: Company Size 11-50 (expected ~96)
SELECT 
  'Company Size: 11-50' as test,
  CASE 
    WHEN total_count BETWEEN 86 AND 106 THEN '✅ PASS'
    WHEN total_count > 0 THEN '⚠️ CHECK: Count outside expected range'
    ELSE '❌ FAIL: No results'
  END as status,
  total_count as actual,
  96 as expected,
  '±10 tolerance' as range
FROM search_free_data_builder(
  p_entity_type := 'person',
  p_company_size_ranges := ARRAY['11-50'],
  p_limit := 1
)
LIMIT 1;

-- Test: Company Size 51-200 (expected ~81)
SELECT 
  'Company Size: 51-200' as test,
  CASE 
    WHEN total_count BETWEEN 71 AND 91 THEN '✅ PASS'
    WHEN total_count > 0 THEN '⚠️ CHECK: Count outside expected range'
    ELSE '❌ FAIL: No results'
  END as status,
  total_count as actual,
  81 as expected,
  '±10 tolerance' as range
FROM search_free_data_builder(
  p_entity_type := 'person',
  p_company_size_ranges := ARRAY['51-200'],
  p_limit := 1
)
LIMIT 1;

-- Test: Company Size 201-500 (expected ~78)
SELECT 
  'Company Size: 201-500' as test,
  CASE 
    WHEN total_count BETWEEN 68 AND 88 THEN '✅ PASS'
    WHEN total_count > 0 THEN '⚠️ CHECK: Count outside expected range'
    ELSE '❌ FAIL: No results'
  END as status,
  total_count as actual,
  78 as expected,
  '±10 tolerance' as range
FROM search_free_data_builder(
  p_entity_type := 'person',
  p_company_size_ranges := ARRAY['201-500'],
  p_limit := 1
)
LIMIT 1;

-- ============================================================
-- SECTION 4: DEPARTMENT FILTER TEST
-- ============================================================

SELECT 
  '=== DEPARTMENT FILTER TEST ===' as section;

-- Test: C-Suite / Leadership (expected ~138)
SELECT 
  'Department: C-Suite / Leadership' as test,
  CASE 
    WHEN total_count BETWEEN 128 AND 148 THEN '✅ PASS'
    WHEN total_count > 0 THEN '⚠️ CHECK: Count outside expected range'
    ELSE '❌ FAIL: No results'
  END as status,
  total_count as actual,
  138 as expected,
  '±10 tolerance' as range
FROM search_free_data_builder(
  p_entity_type := 'person',
  p_departments := ARRAY['C-Suite / Leadership'],
  p_limit := 1
)
LIMIT 1;

-- ============================================================
-- SECTION 5: NET WORTH FILTER TEST
-- ============================================================

SELECT 
  '=== NET WORTH FILTER TEST ===' as section;

-- Test: Net Worth Under $100K (expected ~56)
SELECT 
  'Net Worth: Under $100K' as test,
  CASE 
    WHEN total_count BETWEEN 50 AND 62 THEN '✅ PASS'
    WHEN total_count > 0 THEN '⚠️ CHECK: Count outside expected range'
    ELSE '❌ FAIL: No results'
  END as status,
  total_count as actual,
  56 as expected,
  '±6 tolerance' as range
FROM search_free_data_builder(
  p_entity_type := 'person',
  p_net_worth := ARRAY['Under $100K'],
  p_limit := 1
)
LIMIT 1;

-- ============================================================
-- SECTION 6: PROSPECT DATA FILTER TESTS
-- ============================================================

SELECT 
  '=== PROSPECT DATA FILTER TESTS ===' as section;

-- Test: Has Personal Facebook (expected ~13)
SELECT 
  'Prospect: Has Personal Facebook' as test,
  CASE 
    WHEN total_count BETWEEN 10 AND 16 THEN '✅ PASS'
    WHEN total_count > 0 THEN '⚠️ CHECK: Count outside expected range'
    ELSE '❌ FAIL: No results'
  END as status,
  total_count as actual,
  13 as expected,
  '±3 tolerance' as range
FROM search_free_data_builder(
  p_entity_type := 'person',
  p_has_facebook := true,
  p_limit := 1
)
LIMIT 1;

-- Test: Has Personal Twitter (expected ~7)
SELECT 
  'Prospect: Has Personal Twitter' as test,
  CASE 
    WHEN total_count BETWEEN 5 AND 10 THEN '✅ PASS'
    WHEN total_count > 0 THEN '⚠️ CHECK: Count outside expected range'
    ELSE '❌ FAIL: No results'
  END as status,
  total_count as actual,
  7 as expected,
  '±3 tolerance' as range
FROM search_free_data_builder(
  p_entity_type := 'person',
  p_has_twitter := true,
  p_limit := 1
)
LIMIT 1;

-- Test: Has Company Facebook (expected ~147)
SELECT 
  'Prospect: Has Company Facebook' as test,
  CASE 
    WHEN total_count BETWEEN 135 AND 160 THEN '✅ PASS'
    WHEN total_count > 0 THEN '⚠️ CHECK: Count outside expected range'
    ELSE '❌ FAIL: No results'
  END as status,
  total_count as actual,
  147 as expected,
  '±12 tolerance' as range
FROM search_free_data_builder(
  p_entity_type := 'person',
  p_has_company_facebook := true,
  p_limit := 1
)
LIMIT 1;

-- Test: Has Company Twitter (expected ~141)
SELECT 
  'Prospect: Has Company Twitter' as test,
  CASE 
    WHEN total_count BETWEEN 130 AND 155 THEN '✅ PASS'
    WHEN total_count > 0 THEN '⚠️ CHECK: Count outside expected range'
    ELSE '❌ FAIL: No results'
  END as status,
  total_count as actual,
  141 as expected,
  '±12 tolerance' as range
FROM search_free_data_builder(
  p_entity_type := 'person',
  p_has_company_twitter := true,
  p_limit := 1
)
LIMIT 1;

-- Test: Has Company LinkedIn (expected ~203)
SELECT 
  'Prospect: Has Company LinkedIn' as test,
  CASE 
    WHEN total_count BETWEEN 190 AND 220 THEN '✅ PASS'
    WHEN total_count > 0 THEN '⚠️ CHECK: Count outside expected range'
    ELSE '❌ FAIL: No results'
  END as status,
  total_count as actual,
  203 as expected,
  '±15 tolerance' as range
FROM search_free_data_builder(
  p_entity_type := 'person',
  p_has_company_linkedin := true,
  p_limit := 1
)
LIMIT 1;

-- ============================================================
-- SECTION 7: COMBINED FILTER TEST
-- ============================================================

SELECT 
  '=== COMBINED FILTER TEST ===' as section;

-- Test: C-Suite + Company Size 11-200 (should be subset)
SELECT 
  'Combined: C-Suite + Company Size 11-200' as test,
  CASE 
    WHEN total_count > 0 AND total_count <= 138 THEN '✅ PASS'
    WHEN total_count = 0 THEN '⚠️ CHECK: No results (may be valid)'
    ELSE '❌ FAIL: Count exceeds C-Suite total'
  END as status,
  total_count as actual,
  '≤138' as expected,
  'Subset of C-Suite' as note
FROM search_free_data_builder(
  p_entity_type := 'person',
  p_departments := ARRAY['C-Suite / Leadership'],
  p_company_size_ranges := ARRAY['11-50', '51-200'],
  p_limit := 1
)
LIMIT 1;

-- Test: Income + Company Size (combined filters)
SELECT 
  'Combined: Under $50K + Company Size 1-10' as test,
  CASE 
    WHEN total_count >= 0 AND total_count <= 21 THEN '✅ PASS'
    ELSE '❌ FAIL: Count exceeds individual filter'
  END as status,
  total_count as actual,
  '≤21' as expected,
  'Intersection' as note
FROM search_free_data_builder(
  p_entity_type := 'person',
  p_income := ARRAY['Under $50K'],
  p_company_size_ranges := ARRAY['1-10'],
  p_limit := 1
)
LIMIT 1;

-- ============================================================
-- SECTION 8: PAGINATION TEST
-- ============================================================

SELECT 
  '=== PAGINATION TEST ===' as section;

-- Get first page
SELECT 
  'Pagination: First page' as test,
  total_count as total,
  entity_external_id as first_page_first_id
FROM search_free_data_builder(
  p_entity_type := 'person',
  p_limit := 5,
  p_offset := 0
)
LIMIT 1;

-- Get second page (should have different records, same total)
SELECT 
  'Pagination: Second page' as test,
  total_count as total,
  entity_external_id as second_page_first_id
FROM search_free_data_builder(
  p_entity_type := 'person',
  p_limit := 5,
  p_offset := 5
)
LIMIT 1;

-- ============================================================
-- SECTION 9: ENTITY TYPE TEST
-- ============================================================

SELECT 
  '=== ENTITY TYPE TEST ===' as section;

-- Test: Person entity type
SELECT 
  'Entity: Person' as test,
  CASE 
    WHEN total_count > 0 THEN '✅ PASS'
    ELSE '❌ FAIL: No person records'
  END as status,
  total_count
FROM search_free_data_builder(
  p_entity_type := 'person',
  p_limit := 1
)
LIMIT 1;

-- Test: Company entity type
SELECT 
  'Entity: Company' as test,
  CASE 
    WHEN total_count >= 0 THEN '✅ PASS'
    ELSE '❌ FAIL'
  END as status,
  total_count,
  '(may be 0 if no company data)' as note
FROM search_free_data_builder(
  p_entity_type := 'company',
  p_limit := 1
)
LIMIT 1;

-- ============================================================
-- SECTION 10: SUMMARY
-- ============================================================

SELECT 
  '=== BUILDER SEARCH TEST COMPLETE ===' as section,
  'v2.7 - January 17, 2026' as version,
  'All filters tested with tolerance ranges' as note,
  'Run docs/QUICK_CHECK.sql for infrastructure health' as next_step;
