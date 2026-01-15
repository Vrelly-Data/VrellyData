-- ============================================================
-- SYSTEM HEALTH CHECK - Run this to verify database integrity
-- ============================================================
-- USAGE: Ask AI to "run the health check" or execute manually
-- LAST UPDATED: January 15, 2026
-- ============================================================

-- ============================================================
-- 1. DUPLICATE FUNCTION CHECK
-- Purpose: Ensure no function overloads exist
-- Expected: Zero rows returned (no duplicates)
-- ============================================================
SELECT 
    proname as function_name,
    COUNT(*) as overload_count,
    CASE 
        WHEN COUNT(*) > 1 THEN '❌ FAIL - DUPLICATES EXIST'
        ELSE '✅ PASS'
    END as status
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
GROUP BY proname
HAVING COUNT(*) > 1;

-- ============================================================
-- 2. SEARCH FUNCTION VERIFICATION
-- Purpose: Verify search_free_data_builder exists and is unique
-- Expected: count = 1
-- ============================================================
SELECT 
    'search_free_data_builder' as function_name,
    COUNT(*) as count,
    CASE 
        WHEN COUNT(*) = 0 THEN '❌ FAIL - FUNCTION MISSING'
        WHEN COUNT(*) = 1 THEN '✅ PASS - Unique function exists'
        ELSE '❌ FAIL - MULTIPLE VERSIONS EXIST (' || COUNT(*) || ')'
    END as status
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
AND p.proname = 'search_free_data_builder';

-- ============================================================
-- 3. ALL PUBLIC FUNCTIONS LIST
-- Purpose: Audit all functions for unexpected additions
-- ============================================================
SELECT 
    p.proname as function_name,
    pg_catalog.pg_get_function_arguments(p.oid) as arguments,
    pg_catalog.pg_get_function_result(p.oid) as return_type
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
ORDER BY p.proname;

-- ============================================================
-- 4. REQUIRED INDEXES CHECK
-- Purpose: Verify performance indexes exist
-- Expected: At least 15 indexes on free_data
-- ============================================================
SELECT 
    tablename,
    COUNT(*) as index_count,
    CASE 
        WHEN tablename = 'free_data' AND COUNT(*) >= 15 THEN '✅ PASS'
        WHEN tablename = 'free_data' AND COUNT(*) < 15 THEN '⚠️ WARN - Missing indexes'
        WHEN tablename = 'unlocked_records' AND COUNT(*) >= 4 THEN '✅ PASS'
        ELSE '⚠️ CHECK'
    END as status
FROM pg_indexes 
WHERE schemaname = 'public' 
AND tablename IN ('free_data', 'unlocked_records', 'people_records', 'company_records')
GROUP BY tablename
ORDER BY tablename;

-- ============================================================
-- 5. FILTER DATA AVAILABILITY
-- Purpose: Check which filters have data to work with
-- ============================================================
SELECT 
    field_name,
    record_count,
    CASE 
        WHEN record_count > 0 THEN '✅ HAS DATA'
        ELSE '⏳ AWAITING DATA'
    END as status
FROM (
    -- Person/Company LinkedIn
    SELECT 'linkedin' as field_name, 
           COUNT(*) as record_count 
    FROM free_data 
    WHERE entity_type = 'person'
    AND (coalesce(entity_data->>'linkedin', '') <> '' 
         OR coalesce(entity_data->>'linkedinUrl', '') <> '')
    
    UNION ALL
    
    -- Personal Email
    SELECT 'personalEmail', COUNT(*) 
    FROM free_data 
    WHERE coalesce(entity_data->>'personalEmail', '') <> '' 
       OR coalesce(entity_data->>'email', '') <> ''
    
    UNION ALL
    
    -- Business Email
    SELECT 'businessEmail', COUNT(*) 
    FROM free_data 
    WHERE coalesce(entity_data->>'businessEmail', '') <> ''
    
    UNION ALL
    
    -- Phone
    SELECT 'phone', COUNT(*) 
    FROM free_data 
    WHERE coalesce(entity_data->>'phone', '') <> '' 
       OR coalesce(entity_data->>'directNumber', '') <> ''
    
    UNION ALL
    
    -- Gender (awaiting data)
    SELECT 'gender', COUNT(*) 
    FROM free_data 
    WHERE coalesce(entity_data->>'gender', '') <> ''
    
    UNION ALL
    
    -- Interests (awaiting data)
    SELECT 'interests', COUNT(*) 
    FROM free_data 
    WHERE entity_data->'interests' IS NOT NULL 
    AND jsonb_typeof(entity_data->'interests') = 'array'
    
    UNION ALL
    
    -- Skills (awaiting data)
    SELECT 'skills', COUNT(*) 
    FROM free_data 
    WHERE entity_data->'skills' IS NOT NULL 
    AND jsonb_typeof(entity_data->'skills') = 'array'
    
    UNION ALL
    
    -- Income (awaiting data)
    SELECT 'income/incomeRange', COUNT(*) 
    FROM free_data 
    WHERE coalesce(entity_data->>'income', '') <> '' 
       OR coalesce(entity_data->>'incomeRange', '') <> ''
       
    UNION ALL
    
    -- Technologies
    SELECT 'technologies', COUNT(*) 
    FROM free_data 
    WHERE entity_data->'technologies' IS NOT NULL
    
) field_stats
ORDER BY 
    CASE WHEN record_count > 0 THEN 0 ELSE 1 END,
    field_name;

-- ============================================================
-- 6. TABLE ROW COUNTS
-- Purpose: Monitor data volume for scalability planning
-- ============================================================
SELECT 
    'free_data' as table_name,
    COUNT(*) as row_count,
    CASE 
        WHEN COUNT(*) < 100000 THEN '✅ Small - No concerns'
        WHEN COUNT(*) < 1000000 THEN '⚠️ Medium - Monitor performance'
        ELSE '🔴 Large - Consider partitioning'
    END as scalability_status
FROM free_data

UNION ALL

SELECT 
    'unlocked_records',
    COUNT(*),
    CASE 
        WHEN COUNT(*) < 100000 THEN '✅ Small'
        ELSE '⚠️ Monitor'
    END
FROM unlocked_records

UNION ALL

SELECT 
    'people_records',
    COUNT(*),
    CASE 
        WHEN COUNT(*) < 100000 THEN '✅ Small'
        ELSE '⚠️ Monitor'
    END
FROM people_records

UNION ALL

SELECT 
    'company_records',
    COUNT(*),
    CASE 
        WHEN COUNT(*) < 100000 THEN '✅ Small'
        ELSE '⚠️ Monitor'
    END
FROM company_records;

-- ============================================================
-- 7. RLS POLICY CHECK
-- Purpose: Verify security policies are in place
-- ============================================================
SELECT 
    tablename,
    COUNT(*) as policy_count,
    CASE 
        WHEN COUNT(*) > 0 THEN '✅ RLS Enabled'
        ELSE '⚠️ No RLS policies'
    END as status
FROM pg_policies 
WHERE schemaname = 'public'
AND tablename IN ('free_data', 'unlocked_records', 'people_records', 'company_records', 'profiles')
GROUP BY tablename
ORDER BY tablename;

-- ============================================================
-- 8. FUNCTION SIGNATURE VALIDATION
-- Purpose: Verify search_free_data_builder has expected parameter count
-- Expected: 28 parameters
-- ============================================================
SELECT 
    'search_free_data_builder' as function_name,
    pronargs as param_count,
    CASE 
        WHEN pronargs = 28 THEN '✅ PASS - Expected 28 parameters'
        ELSE '❌ FAIL - Expected 28, found ' || pronargs || ' (signature may have changed!)'
    END as status
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
AND p.proname = 'search_free_data_builder';

-- ============================================================
-- 9. STABLE CHECKPOINT COMPARISON
-- Purpose: Quick reference to last stable state
-- Reference: docs/STABLE_CHECKPOINTS.md
-- ============================================================
SELECT 
    'STABLE CHECKPOINT v2.0' as checkpoint,
    'January 15, 2026' as date,
    '15 functions, 28 params on search, 0 duplicates' as expected_state,
    'See docs/STABLE_CHECKPOINTS.md for full details' as reference;

-- ============================================================
-- END OF HEALTH CHECK
-- ============================================================
