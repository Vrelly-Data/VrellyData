-- ============================================
-- QUICK CHECK VERIFICATION SCRIPT
-- Run this anytime to verify database health
-- ============================================

-- 1. CHECK FOR DUPLICATE/OVERLOADED FUNCTIONS
SELECT '=== DUPLICATE FUNCTION CHECK ===' AS section;

SELECT 
  routine_name,
  COUNT(*) as version_count,
  CASE 
    WHEN COUNT(*) = 1 THEN '✅ PASS - Unique'
    ELSE '❌ FAIL - DUPLICATE DETECTED'
  END as status
FROM information_schema.routines 
WHERE routine_schema = 'public' 
  AND routine_type = 'FUNCTION'
  AND routine_name IN (
    'search_free_data_builder',
    'title_matches_seniority',
    'deduct_credits',
    'get_filter_suggestions'
  )
GROUP BY routine_name
ORDER BY routine_name;

-- 2. VERIFY search_free_data_builder SIGNATURE (28 parameters)
SELECT '=== FUNCTION SIGNATURE CHECK ===' AS section;

SELECT 
  p.proname as function_name,
  p.pronargs as parameter_count,
  CASE 
    WHEN p.pronargs = 28 THEN '✅ PASS - 28 parameters'
    ELSE '❌ FAIL - Expected 28, got ' || p.pronargs
  END as status
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
  AND p.proname = 'search_free_data_builder';

-- 3. DATA AVAILABILITY CHECK
SELECT '=== DATA AVAILABILITY CHECK ===' AS section;

SELECT 
  'Total Records' as field,
  COUNT(*)::text as count,
  '✅' as status
FROM free_data
WHERE entity_type = 'person'

UNION ALL

SELECT 
  'Has Email' as field,
  COUNT(*)::text,
  CASE WHEN COUNT(*) > 0 THEN '✅' ELSE '⚠️ No data' END
FROM free_data
WHERE entity_type = 'person'
  AND (entity_data->>'email' IS NOT NULL OR entity_data->>'businessEmail' IS NOT NULL)

UNION ALL

SELECT 
  'Has LinkedIn' as field,
  COUNT(*)::text,
  CASE WHEN COUNT(*) > 0 THEN '✅' ELSE '⚠️ No data' END
FROM free_data
WHERE entity_type = 'person'
  AND (entity_data->>'linkedin' IS NOT NULL OR entity_data->>'linkedinUrl' IS NOT NULL)

UNION ALL

SELECT 
  'Has Seniority' as field,
  COUNT(*)::text,
  CASE WHEN COUNT(*) > 0 THEN '✅' ELSE '⚠️ No data' END
FROM free_data
WHERE entity_type = 'person'
  AND entity_data->>'seniority' IS NOT NULL

UNION ALL

SELECT 
  'Has Department' as field,
  COUNT(*)::text,
  CASE WHEN COUNT(*) > 0 THEN '✅' ELSE '⚠️ No data' END
FROM free_data
WHERE entity_type = 'person'
  AND entity_data->>'department' IS NOT NULL

UNION ALL

SELECT 
  'Has Income' as field,
  COUNT(*)::text,
  CASE WHEN COUNT(*) > 0 THEN '✅' ELSE '⚠️ No data' END
FROM free_data
WHERE entity_type = 'person'
  AND entity_data->>'incomeRange' IS NOT NULL

UNION ALL

SELECT 
  'Has Net Worth' as field,
  COUNT(*)::text,
  CASE WHEN COUNT(*) > 0 THEN '✅' ELSE '⚠️ No data' END
FROM free_data
WHERE entity_type = 'person'
  AND entity_data->>'netWorth' IS NOT NULL

UNION ALL

SELECT 
  'Has Gender' as field,
  COUNT(*)::text,
  CASE WHEN COUNT(*) > 0 THEN '✅' ELSE '⚠️ No data' END
FROM free_data
WHERE entity_type = 'person'
  AND entity_data->>'gender' IS NOT NULL

UNION ALL

SELECT 
  'Has Skills' as field,
  COUNT(*)::text,
  CASE WHEN COUNT(*) > 0 THEN '✅' ELSE '⚠️ No data' END
FROM free_data
WHERE entity_type = 'person'
  AND entity_data->>'skills' IS NOT NULL

UNION ALL

SELECT 
  'Has Interests' as field,
  COUNT(*)::text,
  CASE WHEN COUNT(*) > 0 THEN '✅' ELSE '⚠️ No data' END
FROM free_data
WHERE entity_type = 'person'
  AND entity_data->>'interests' IS NOT NULL;

-- 4. FILTER TEST QUERIES
SELECT '=== FILTER TEST QUERIES ===' AS section;

-- Test Seniority Filter (C-Level should return 138+)
SELECT 
  'Seniority: C-Level' as filter_test,
  COUNT(*)::text as result_count,
  CASE WHEN COUNT(*) >= 100 THEN '✅ PASS' ELSE '⚠️ Check logic' END as status
FROM free_data
WHERE entity_type = 'person'
  AND (
    LOWER(entity_data->>'seniority') ~* '(c-level|c-suite|csuite|c level|c suite|cxo|chief|founder)'
    OR LOWER(entity_data->>'title') ~* '^(ceo|cfo|cto|coo|cmo|cio|cpo|chief)'
  )

UNION ALL

-- Test Department Filter (C-Suite should return records)
SELECT 
  'Department: C-Suite' as filter_test,
  COUNT(*)::text,
  CASE WHEN COUNT(*) > 0 THEN '✅ PASS' ELSE '⚠️ Check logic' END
FROM free_data
WHERE entity_type = 'person'
  AND LOWER(entity_data->>'department') ~* '(c-suite|c suite|csuite|executive|leadership|founder)'

UNION ALL

-- Test Income Filter
SELECT 
  'Income: Has Data' as filter_test,
  COUNT(*)::text,
  CASE WHEN COUNT(*) >= 80 THEN '✅ PASS (84 expected)' ELSE '⚠️ Check logic' END
FROM free_data
WHERE entity_type = 'person'
  AND entity_data->>'incomeRange' IS NOT NULL

UNION ALL

-- Test Net Worth Filter
SELECT 
  'Net Worth: Has Data' as filter_test,
  COUNT(*)::text,
  CASE WHEN COUNT(*) >= 80 THEN '✅ PASS (87 expected)' ELSE '⚠️ Check logic' END
FROM free_data
WHERE entity_type = 'person'
  AND entity_data->>'netWorth' IS NOT NULL;

-- 5. SAMPLE DATA VALUES (for debugging)
SELECT '=== SAMPLE DATA VALUES ===' AS section;

-- Seniority values
SELECT 'Seniority Values' as field, 
       LOWER(entity_data->>'seniority') as value, 
       COUNT(*) as count
FROM free_data 
WHERE entity_type = 'person' 
  AND entity_data->>'seniority' IS NOT NULL
GROUP BY LOWER(entity_data->>'seniority')
ORDER BY count DESC
LIMIT 10;

-- Department values
SELECT 'Department Values' as field,
       entity_data->>'department' as value, 
       COUNT(*) as count
FROM free_data 
WHERE entity_type = 'person' 
  AND entity_data->>'department' IS NOT NULL
GROUP BY entity_data->>'department'
ORDER BY count DESC
LIMIT 10;

-- 6. FINAL SUMMARY
SELECT '=== QUICK CHECK COMPLETE ===' AS section;
SELECT 'Run docs/HEALTH_CHECK.sql for full audit' AS note;
