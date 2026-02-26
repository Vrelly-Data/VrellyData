

# Rewrite Search Function for 1M+ Scale

## The Problem
The current `search_free_data_builder` function uses static SQL with 37 `IS NULL OR ...` checks. PostgreSQL sees all 37 conditions every time, even when you only use 1 filter. At 52k rows this causes timeouts; at 1M rows it's completely unusable.

## The Fix: Dynamic SQL Rewrite

Replace the static SQL function body with **dynamic SQL** that only includes WHERE clauses for filters you actually provide. This means when you search by city alone, PostgreSQL sees a simple `WHERE entity_type = 'person' AND city = 'Miami'` -- and uses the B-tree index directly.

### What changes

**One database migration** that does `CREATE OR REPLACE FUNCTION search_free_data_builder(...)` -- same 37 parameters, same return type, same name. Only the internal implementation changes from static to dynamic SQL.

### What stays the same
- All 37 parameters (exact same signature)
- All 18 filters + 8 DNC exclusions (same logic, same matching rules)
- Return type (`entity_external_id`, `entity_data`, `total_count`)
- Frontend code (zero changes)
- Result counts for identical inputs

### How Dynamic SQL Works

Instead of:
```text
WHERE entity_type = $1
  AND (p_cities IS NULL OR city = ANY(p_cities))    -- always evaluated
  AND (p_keywords IS NULL OR title ILIKE ...)        -- always evaluated
  AND (p_gender IS NULL OR gender = ANY(p_gender))   -- always evaluated
  ... 34 more conditions always evaluated ...
```

It becomes:
```text
-- Only the filters you actually use get added:
WHERE entity_type = $1
  AND city = ANY($2)      -- only if p_cities is provided
```

This lets PostgreSQL pick the right index for each specific query.

### Implementation Details

1. **Dynamic SQL construction**: Build the WHERE clause string conditionally, appending each filter block only when the parameter is non-null and non-empty
2. **Parameterized execution**: Use `EXECUTE ... USING` with numbered parameters to prevent SQL injection
3. **Same filter logic**: Every CASE/ILIKE/regex block is preserved exactly -- just wrapped in conditional string concatenation
4. **Counting strategy**: Keep `count(*) OVER()` (works fine when the planner can use indexes, which dynamic SQL enables)
5. **force_custom_plan**: Also set `plan_cache_mode = force_custom_plan` on the function as extra insurance

### Performance Expectations

| Scenario | Current (52k) | After (52k) | After (1M) |
|----------|---------------|-------------|------------|
| No filters | ~7s / timeout | <500ms | <2s |
| City filter | ~10s / timeout | <50ms | <200ms |
| Job title ILIKE | timeout | <100ms | <500ms |
| Keyword search | timeout | <200ms | <1s |

### Risk Assessment

| Risk | Level | Mitigation |
|------|-------|------------|
| Logic change | Very low | Same filter blocks, just conditionally included |
| Result count change | None | Same WHERE logic, verified with baseline queries |
| Rollback | Easy | Original function is in stable migration file -- one `CREATE OR REPLACE` to revert |

### Verification After Deploy

Run the v3.9 baseline checks to confirm identical counts:
- Person total: 52,119
- Company total: 9,525
- Company size 5001-10000: 2,725
- Company size 10000+: 10,202
- Individual Contributor: 174
- Income Under $50K: 55
- Gender M: 136

### Sequence

1. Create migration with the dynamic SQL rewrite of `search_free_data_builder`
2. Run all 7 baseline verification queries
3. Confirm no frontend changes needed
4. User proceeds with 1M upload

