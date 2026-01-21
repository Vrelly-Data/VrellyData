-- ============================================================
-- QUICK CHECK v3.3
-- Run this to verify database health and filter functionality
-- Last Updated: January 21, 2026
-- ============================================================

-- ============================================================
-- SECTION 1: DUPLICATE FUNCTION CHECK
-- ============================================================

SELECT 
  '=== DUPLICATE CHECK ===' as section;

SELECT 
  CASE 
    WHEN COUNT(*) = 1 THEN '✅ PASS: search_free_data_builder has 1 version'
    ELSE '❌ FAIL: search_free_data_builder has ' || COUNT(*) || ' versions (DUPLICATES!)'
  END as result
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname = 'search_free_data_builder';

SELECT 
  CASE 
    WHEN COUNT(*) = 1 THEN '✅ PASS: parse_employee_count_upper has 1 version'
    ELSE '❌ FAIL: parse_employee_count_upper has ' || COUNT(*) || ' versions'
  END as result
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname = 'parse_employee_count_upper';

-- ============================================================
-- SECTION 2: FUNCTION PARAMETER CHECK
-- ============================================================

SELECT 
  '=== PARAMETER CHECK ===' as section;

SELECT 
  CASE 
    WHEN pronargs = 29 THEN '✅ PASS: search_free_data_builder has 29 parameters (correct)'
    ELSE '❌ FAIL: search_free_data_builder has ' || pronargs || ' parameters (expected 29)'
  END as result
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname = 'search_free_data_builder';

-- ============================================================
-- SECTION 3: DATA AVAILABILITY CHECK
-- ============================================================

SELECT 
  '=== DATA AVAILABILITY ===' as section;

SELECT 
  'Total Person Records' as field,
  COUNT(*) as count,
  CASE WHEN COUNT(*) > 0 THEN '✅' ELSE '⚠️' END as status
FROM free_data WHERE entity_type = 'person'
UNION ALL
SELECT 'Has companySize', COUNT(*), CASE WHEN COUNT(*) > 0 THEN '✅' ELSE '⚠️' END
FROM free_data WHERE entity_type = 'person' AND entity_data->>'companySize' IS NOT NULL
UNION ALL
SELECT 'Has incomeRange', COUNT(*), CASE WHEN COUNT(*) > 0 THEN '✅' ELSE '⚠️' END
FROM free_data WHERE entity_type = 'person' AND entity_data->>'incomeRange' IS NOT NULL
UNION ALL
SELECT 'Has netWorth', COUNT(*), CASE WHEN COUNT(*) > 0 THEN '✅' ELSE '⚠️' END
FROM free_data WHERE entity_type = 'person' AND entity_data->>'netWorth' IS NOT NULL
UNION ALL
SELECT 'Has seniority', COUNT(*), CASE WHEN COUNT(*) > 0 THEN '✅' ELSE '⚠️' END
FROM free_data WHERE entity_type = 'person' AND entity_data->>'seniority' IS NOT NULL
UNION ALL
SELECT 'Has department', COUNT(*), CASE WHEN COUNT(*) > 0 THEN '✅' ELSE '⚠️' END
FROM free_data WHERE entity_type = 'person' AND entity_data->>'department' IS NOT NULL
UNION ALL
SELECT 'Has gender (M/F)', COUNT(*), CASE WHEN COUNT(*) > 0 THEN '✅' ELSE '⚠️' END
FROM free_data WHERE entity_type = 'person' AND entity_data->>'gender' IS NOT NULL;

-- ============================================================
-- SECTION 4: COMPANY SIZE FILTER TEST (v3.3 baseline)
-- ============================================================

SELECT 
  '=== COMPANY SIZE FILTER TEST ===' as section;

SELECT 
  '1-10' as range,
  COUNT(*) as count,
  15 as expected,
  CASE WHEN ABS(COUNT(*) - 15) <= 5 THEN '✅' ELSE '⚠️' END as status
FROM free_data 
WHERE entity_type = 'person'
  AND COALESCE(public.parse_employee_count_upper(entity_data->>'companySize'), 0) BETWEEN 1 AND 10
UNION ALL
SELECT '11-50', COUNT(*), 96, CASE WHEN ABS(COUNT(*) - 96) <= 5 THEN '✅' ELSE '⚠️' END
FROM free_data WHERE entity_type = 'person' AND COALESCE(public.parse_employee_count_upper(entity_data->>'companySize'), 0) BETWEEN 11 AND 50
UNION ALL
SELECT '51-200', COUNT(*), 81, CASE WHEN ABS(COUNT(*) - 81) <= 5 THEN '✅' ELSE '⚠️' END
FROM free_data WHERE entity_type = 'person' AND COALESCE(public.parse_employee_count_upper(entity_data->>'companySize'), 0) BETWEEN 51 AND 200
UNION ALL
SELECT '201-500', COUNT(*), 78, CASE WHEN ABS(COUNT(*) - 78) <= 5 THEN '✅' ELSE '⚠️' END
FROM free_data WHERE entity_type = 'person' AND COALESCE(public.parse_employee_count_upper(entity_data->>'companySize'), 0) BETWEEN 201 AND 500;

-- ============================================================
-- SECTION 5: GENDER FILTER TEST (v3.3 baseline - M/F format)
-- ============================================================

SELECT 
  '=== GENDER FILTER TEST (M/F format) ===' as section;

SELECT 
  'Male (M)' as gender,
  COUNT(*) as count,
  137 as expected,
  CASE WHEN ABS(COUNT(*) - 137) <= 5 THEN '✅' ELSE '⚠️' END as status
FROM free_data 
WHERE entity_type = 'person' AND UPPER(entity_data->>'gender') = 'M'
UNION ALL
SELECT 'Female (F)', COUNT(*), 55, CASE WHEN ABS(COUNT(*) - 55) <= 5 THEN '✅' ELSE '⚠️' END
FROM free_data WHERE entity_type = 'person' AND UPPER(entity_data->>'gender') = 'F';

-- ============================================================
-- SECTION 6: INCOME FILTER TEST
-- ============================================================

SELECT 
  '=== INCOME FILTER TEST ===' as section;

SELECT 
  'Total with income data' as range,
  COUNT(*) as count,
  '(should be ~100)' as expected
FROM free_data 
WHERE entity_type = 'person'
  AND entity_data->>'incomeRange' IS NOT NULL 
  AND entity_data->>'incomeRange' != '';

SELECT 
  'Under $50K' as range,
  COUNT(*) as count,
  55 as expected
FROM free_data 
WHERE entity_type = 'person'
  AND entity_data->>'incomeRange' IS NOT NULL 
  AND entity_data->>'incomeRange' != ''
  AND COALESCE(NULLIF(REGEXP_REPLACE(entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::int, 0) < 50
UNION ALL
SELECT '$50K-$100K', COUNT(*), 45 FROM free_data WHERE entity_type = 'person' AND entity_data->>'incomeRange' IS NOT NULL AND entity_data->>'incomeRange' != '' AND COALESCE(NULLIF(REGEXP_REPLACE(entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::int, 0) BETWEEN 50 AND 100;

-- ============================================================
-- SECTION 7: NET WORTH FILTER TEST
-- ============================================================

SELECT 
  '=== NET WORTH FILTER TEST ===' as section;

SELECT 
  'Total with net worth data' as range,
  COUNT(*) as count,
  '(should be ~87)' as expected
FROM free_data 
WHERE entity_type = 'person'
  AND entity_data->>'netWorth' IS NOT NULL 
  AND entity_data->>'netWorth' != '';

SELECT 
  'Under $100K (includes negatives)' as range,
  COUNT(*) as count,
  56 as expected
FROM free_data 
WHERE entity_type = 'person'
  AND entity_data->>'netWorth' IS NOT NULL 
  AND entity_data->>'netWorth' != ''
  AND COALESCE(
    CASE 
      WHEN entity_data->>'netWorth' LIKE '-%' THEN -1 * NULLIF(REGEXP_REPLACE(entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::int
      ELSE NULLIF(REGEXP_REPLACE(entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::int
    END, 0) < 100;

-- ============================================================
-- SECTION 8: PROSPECT DATA FILTER TEST (v3.3 baseline)
-- ============================================================

SELECT 
  '=== PROSPECT DATA FILTER TEST ===' as section;

SELECT 
  'Personal Facebook' as filter,
  COUNT(*) as count,
  13 as expected,
  CASE WHEN ABS(COUNT(*) - 13) <= 5 THEN '✅' ELSE '⚠️' END as status
FROM free_data 
WHERE entity_data->>'facebookUrl' IS NOT NULL
UNION ALL
SELECT 'Personal Twitter', COUNT(*), 7, CASE WHEN ABS(COUNT(*) - 7) <= 5 THEN '✅' ELSE '⚠️' END
FROM free_data WHERE entity_data->>'twitterUrl' IS NOT NULL
UNION ALL
SELECT 'Company Facebook', COUNT(*), 147, CASE WHEN ABS(COUNT(*) - 147) <= 5 THEN '✅' ELSE '⚠️' END
FROM free_data WHERE entity_data->>'companyFacebookUrl' IS NOT NULL
UNION ALL
SELECT 'Company Twitter', COUNT(*), 141, CASE WHEN ABS(COUNT(*) - 141) <= 5 THEN '✅' ELSE '⚠️' END
FROM free_data WHERE entity_data->>'companyTwitterUrl' IS NOT NULL
UNION ALL
SELECT 'Company LinkedIn', COUNT(*), 203, CASE WHEN ABS(COUNT(*) - 203) <= 5 THEN '✅' ELSE '⚠️' END
FROM free_data WHERE entity_data->>'companyLinkedin' IS NOT NULL;

-- ============================================================
-- SECTION 9: FUNCTION VERSION CHECK
-- ============================================================

SELECT 
  '=== FUNCTION VERSION ===' as section;

SELECT 
  obj_description(p.oid, 'pg_proc') as function_comment
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname = 'search_free_data_builder';

-- ============================================================
-- SECTION 10: BUILDER SEARCH SMOKE TEST
-- ============================================================

SELECT 
  '=== BUILDER SEARCH SMOKE TEST ===' as section;

-- Smoke Test 1: Basic execution works
SELECT 
  'Basic Search' as test,
  CASE WHEN total_count > 0 THEN '✅ PASS' ELSE '❌ FAIL' END as status,
  total_count
FROM search_free_data_builder(p_entity_type := 'person', p_limit := 1)
LIMIT 1;

-- Smoke Test 2: Gender filter works (M format)
SELECT 
  'Gender Filter (Male/M)' as test,
  CASE 
    WHEN total_count BETWEEN 132 AND 142 THEN '✅ PASS' 
    WHEN total_count > 0 THEN '⚠️ CHECK' 
    ELSE '❌ FAIL' 
  END as status,
  total_count as actual,
  137 as expected
FROM search_free_data_builder(p_entity_type := 'person', p_gender := ARRAY['M'], p_limit := 1)
LIMIT 1;

-- Smoke Test 3: Income filter works
SELECT 
  'Income Filter (Under $50K)' as test,
  CASE 
    WHEN total_count BETWEEN 50 AND 60 THEN '✅ PASS' 
    WHEN total_count > 0 THEN '⚠️ CHECK' 
    ELSE '❌ FAIL' 
  END as status,
  total_count as actual,
  55 as expected
FROM search_free_data_builder(p_entity_type := 'person', p_income := ARRAY['Under $50K'], p_limit := 1)
LIMIT 1;

-- Smoke Test 4: Company Size filter works
SELECT 
  'Company Size Filter (1-10)' as test,
  CASE 
    WHEN total_count BETWEEN 10 AND 20 THEN '✅ PASS' 
    WHEN total_count > 0 THEN '⚠️ CHECK' 
    ELSE '❌ FAIL' 
  END as status,
  total_count as actual,
  15 as expected
FROM search_free_data_builder(p_entity_type := 'person', p_company_size_ranges := ARRAY['1-10'], p_limit := 1)
LIMIT 1;

-- Smoke Test 5: Department filter works
SELECT 
  'Department Filter (C-Suite)' as test,
  CASE 
    WHEN total_count BETWEEN 133 AND 143 THEN '✅ PASS' 
    WHEN total_count > 0 THEN '⚠️ CHECK' 
    ELSE '❌ FAIL' 
  END as status,
  total_count as actual,
  138 as expected
FROM search_free_data_builder(p_entity_type := 'person', p_departments := ARRAY['C-Suite / Leadership'], p_limit := 1)
LIMIT 1;

-- Smoke Test 6: Prospect Data filter works
SELECT 
  'Prospect Filter (Personal Facebook)' as test,
  CASE 
    WHEN total_count BETWEEN 8 AND 18 THEN '✅ PASS' 
    WHEN total_count > 0 THEN '⚠️ CHECK' 
    ELSE '❌ FAIL' 
  END as status,
  total_count as actual,
  13 as expected
FROM search_free_data_builder(p_entity_type := 'person', p_has_facebook := true, p_limit := 1)
LIMIT 1;

-- Smoke Test 7: Company LinkedIn filter works
SELECT 
  'Prospect Filter (Company LinkedIn)' as test,
  CASE 
    WHEN total_count BETWEEN 198 AND 208 THEN '✅ PASS' 
    WHEN total_count > 0 THEN '⚠️ CHECK' 
    ELSE '❌ FAIL' 
  END as status,
  total_count as actual,
  203 as expected
FROM search_free_data_builder(p_entity_type := 'person', p_has_company_linkedin := true, p_limit := 1)
LIMIT 1;

-- ============================================================
-- SECTION 11: SUMMARY
-- ============================================================

SELECT 
  '=== QUICK CHECK COMPLETE ===' as section,
  'v3.3 - January 21, 2026' as version,
  'Gender: M/F format (137 Male, 55 Female)' as gender_note,
  'Run docs/BUILDER_SEARCH_TEST.sql for comprehensive filter testing' as next_step,
  'Run docs/HEALTH_CHECK.sql for full infrastructure audit' as alt_step;
