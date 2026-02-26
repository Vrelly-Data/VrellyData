

# Fix: Search Performance at 240K+ Records (Scaling to Millions)

## Root Cause

The `search_free_data_builder` function uses `count(*) OVER()` as a window function to get the total result count. This forces Postgres to scan **every matching row** before returning even the first 50. At 155K person records, the unfiltered base query alone takes 35 seconds. This will only get worse as you add more data.

This is NOT related to the security changes -- it's a scaling bottleneck that was always going to surface as the dataset grew.

## Solution: Two-Query Strategy

Replace the single-query `count(*) OVER()` approach with a **separate count query** that uses a fast estimate for large result sets, while keeping the paginated data query lightweight.

### How it works

1. **Data query**: Returns just the paginated rows (LIMIT/OFFSET) -- no window function, so Postgres can stop after finding 50 rows
2. **Count strategy**: 
   - When filters are applied: Run a separate `SELECT count(*)` with the same WHERE clause (this is faster than `count(*) OVER()` because it doesn't need to fetch `entity_data`)
   - When NO filters are applied (just entity_type): Use `pg_class.reltuples` statistical estimate -- instant, no scan needed
   - Apply a hard cap at 100,000 (already enforced in the frontend)

### Expected performance improvement

| Scenario | Current | After Fix |
|----------|---------|-----------|
| No filters (155K person) | 35s | Under 1s (estimate) |
| Industry filter (3K rows) | 3.5s | Under 1s |
| Keyword search (broad) | Timeout | 2-5s |
| At 1M records, no filters | Would timeout | Under 1s (estimate) |

## Technical Details

### Step 1: Update `search_free_data_builder` function

Remove `count(*) OVER()` from the data query. Instead, the function will:
- Run the paginated data query (fast -- stops at LIMIT)
- Run a separate count query using `SELECT count(*)` with the same WHERE clause but without fetching `entity_data`
- For the unfiltered base case, use `pg_class.reltuples` as a near-instant statistical estimate
- Return `total_count` as before (same return signature, no frontend changes needed)

The 37-parameter signature stays identical. The return type stays identical (`entity_external_id`, `entity_data`, `total_count`).

### Step 2: Add a composite index for the base sort

```text
CREATE INDEX idx_free_data_type_extid 
ON free_data (entity_type, entity_external_id);
```

This lets the `ORDER BY entity_external_id LIMIT 50` use an index-only scan instead of sorting all rows.

### Step 3: Frontend -- no changes needed

The `useFreeDataSearch.ts` hook already reads `total_count` from the first result row and clamps it to `TOTAL_DISPLAY_CAP` (100,000). The function signature doesn't change, so the frontend continues working as-is.

## Risk Assessment

- **Low risk**: The return signature doesn't change, so no frontend or edge function changes are needed
- **Count accuracy**: For filtered queries, count is exact. For unfiltered queries, the statistical estimate is refreshed by `ANALYZE` and is typically within 1-2% accuracy
- **Revert**: If anything breaks, the existing `SEARCH_FUNCTION_LOCK.md` revert procedure works since we're using `CREATE OR REPLACE`

