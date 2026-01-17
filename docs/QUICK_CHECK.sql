-- ============================================================
-- QUICK CHECK v2.3
-- Run this to verify database health and filter functionality
-- Last Updated: January 16, 2026
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
FROM free_data WHERE entity_type = 'person' AND entity_data->>'department' IS NOT NULL;

-- ============================================================
-- SECTION 4: COMPANY SIZE FILTER TEST
-- ============================================================

SELECT 
  '=== COMPANY SIZE FILTER TEST ===' as section;

SELECT 
  '1-10' as range,
  COUNT(*) as count,
  CASE WHEN COUNT(*) > 0 THEN '✅' ELSE '⚠️' END as status
FROM free_data 
WHERE entity_type = 'person'
  AND COALESCE(public.parse_employee_count_upper(entity_data->>'companySize'), 0) BETWEEN 1 AND 10
UNION ALL
SELECT '11-50', COUNT(*), CASE WHEN COUNT(*) > 0 THEN '✅' ELSE '⚠️' END
FROM free_data WHERE entity_type = 'person' AND COALESCE(public.parse_employee_count_upper(entity_data->>'companySize'), 0) BETWEEN 11 AND 50
UNION ALL
SELECT '51-200', COUNT(*), CASE WHEN COUNT(*) > 0 THEN '✅' ELSE '⚠️' END
FROM free_data WHERE entity_type = 'person' AND COALESCE(public.parse_employee_count_upper(entity_data->>'companySize'), 0) BETWEEN 51 AND 200
UNION ALL
SELECT '201-500', COUNT(*), CASE WHEN COUNT(*) > 0 THEN '✅' ELSE '⚠️' END
FROM free_data WHERE entity_type = 'person' AND COALESCE(public.parse_employee_count_upper(entity_data->>'companySize'), 0) BETWEEN 201 AND 500;

-- ============================================================
-- SECTION 5: INCOME FILTER TEST (should only count records WITH data)
-- ============================================================

SELECT 
  '=== INCOME FILTER TEST ===' as section;

SELECT 
  'Total with income data' as range,
  COUNT(*) as count,
  '(should be ~84)' as expected
FROM free_data 
WHERE entity_type = 'person'
  AND entity_data->>'incomeRange' IS NOT NULL 
  AND entity_data->>'incomeRange' != '';

SELECT 
  'Under $50K' as range,
  COUNT(*) as count
FROM free_data 
WHERE entity_type = 'person'
  AND entity_data->>'incomeRange' IS NOT NULL 
  AND entity_data->>'incomeRange' != ''
  AND COALESCE(NULLIF(REGEXP_REPLACE(entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::int, 0) < 50
UNION ALL
SELECT '$50K-$100K', COUNT(*) FROM free_data WHERE entity_type = 'person' AND entity_data->>'incomeRange' IS NOT NULL AND entity_data->>'incomeRange' != '' AND COALESCE(NULLIF(REGEXP_REPLACE(entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::int, 0) BETWEEN 50 AND 100
UNION ALL
SELECT '$100K-$200K', COUNT(*) FROM free_data WHERE entity_type = 'person' AND entity_data->>'incomeRange' IS NOT NULL AND entity_data->>'incomeRange' != '' AND COALESCE(NULLIF(REGEXP_REPLACE(entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::int, 0) BETWEEN 101 AND 200;

-- ============================================================
-- SECTION 6: NET WORTH FILTER TEST (should only count records WITH data)
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
  COUNT(*) as count
FROM free_data 
WHERE entity_type = 'person'
  AND entity_data->>'netWorth' IS NOT NULL 
  AND entity_data->>'netWorth' != ''
  AND COALESCE(
    CASE 
      WHEN entity_data->>'netWorth' LIKE '-%' THEN -1 * NULLIF(REGEXP_REPLACE(entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::int
      ELSE NULLIF(REGEXP_REPLACE(entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::int
    END, 0) < 100
UNION ALL
SELECT '$100K-$500K', COUNT(*) FROM free_data WHERE entity_type = 'person' AND entity_data->>'netWorth' IS NOT NULL AND entity_data->>'netWorth' != '' AND COALESCE(CASE WHEN entity_data->>'netWorth' LIKE '-%' THEN -1 * NULLIF(REGEXP_REPLACE(entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::int ELSE NULLIF(REGEXP_REPLACE(entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::int END, 0) BETWEEN 100 AND 500
UNION ALL
SELECT '$500K-$1M', COUNT(*) FROM free_data WHERE entity_type = 'person' AND entity_data->>'netWorth' IS NOT NULL AND entity_data->>'netWorth' != '' AND COALESCE(CASE WHEN entity_data->>'netWorth' LIKE '-%' THEN -1 * NULLIF(REGEXP_REPLACE(entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::int ELSE NULLIF(REGEXP_REPLACE(entity_data->>'netWorth', '[^0-9]', '', 'g'), '')::int END, 0) BETWEEN 501 AND 1000;

-- ============================================================
-- SECTION 7: FUNCTION VERSION CHECK
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
-- SECTION 8: SUMMARY
-- ============================================================

SELECT 
  '=== QUICK CHECK COMPLETE ===' as section,
  'v2.3 - January 16, 2026' as version,
  'Run docs/HEALTH_CHECK.sql for full audit' as next_step;
