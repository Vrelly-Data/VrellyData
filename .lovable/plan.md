

# Fix: Use Planner Estimates for Filtered Count Queries

## Problem
The separate `SELECT count(*)` query for filtered results still times out because it must evaluate expensive JSONB operations (ILIKE, regex) on every matching row. For broad filters like keywords across 154K records, this is just as slow as the original `count(*) OVER()`.

## Solution
Replace `SELECT count(*)` with the Postgres query planner's row estimate, extracted from `EXPLAIN (FORMAT JSON)`. This is instant because it only runs the planner -- it never executes the query.

### How it works
- Instead of `EXECUTE count_sql INTO v_total_count`, the function will:
  1. Run `EXECUTE 'EXPLAIN (FORMAT JSON) SELECT 1 FROM free_data fd ' || where_clause` 
  2. Extract `Plan Rows` from the top-level JSON node
  3. Use that as `total_count`
- Unfiltered queries continue using `pg_class.reltuples` (already fast)
- All counts remain capped at 100,000

### Accuracy
- Planner estimates depend on table statistics (refreshed by ANALYZE, which we already ran)
- For simple equality filters (industry, gender), estimates are typically within 2-5x of actual
- For ILIKE/regex filters, estimates may be rougher but still give a useful order of magnitude
- This is acceptable since the user chose "fast estimated counts" and the UI already shows "100,000+" for large results

## Technical Details

### Single migration: Update `search_free_data_builder`

Replace the filtered count block:
```text
-- BEFORE (times out on broad filters):
count_sql := 'SELECT count(*) FROM public.free_data fd ' || where_clause;
EXECUTE count_sql INTO v_total_count USING ...;

-- AFTER (instant planner estimate):
EXECUTE 'EXPLAIN (FORMAT JSON) SELECT 1 FROM public.free_data fd ' || where_clause
  INTO explain_result USING ...;
v_total_count := (explain_result->0->'Plan'->>'Plan Rows')::bigint;
```

The function signature (37 parameters) and return type remain identical. No frontend changes needed.

### Risks
- Low risk: Same function signature, same return type, same capped behavior
- Count accuracy is approximate for filtered queries, which is the accepted trade-off
- Revert procedure unchanged (SEARCH_FUNCTION_LOCK.md)

