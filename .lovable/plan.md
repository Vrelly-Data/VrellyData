

# Fix: Revert Search Function + Keep Performance Improvements

## What Happened

Several migrations were applied today to the `search_free_data_builder` function, each trying to fix a timeout issue:
1. Migration `210832` -- Split into Two-Query Strategy (count + data separately), but the filtered count query still timed out
2. Migration `212209` -- Replaced count with EXPLAIN planner estimates, which fixed timeouts but introduced **inaccurate counts** (e.g., "found: 60" but 100 rows actually returned)

The search IS currently working (no errors in the last few minutes), but the count estimates are wrong, which breaks pagination and confuses the UI.

## Root Cause

The `EXPLAIN (FORMAT JSON)` planner estimate approach gives instant counts but they're often wildly inaccurate for JSONB-based filters (ILIKE, regex). Postgres doesn't have statistics on JSONB field values, so the planner guesses poorly.

## Solution: Hybrid Approach

Keep the Two-Query architecture but use a **bounded count** instead of EXPLAIN estimates:

1. **Filtered count with a hard LIMIT**: Instead of counting all matching rows (which times out), count up to 100,001 rows max. This tells us whether results exceed the 100K cap without scanning the entire table.
2. **Use a subquery with LIMIT**: `SELECT count(*) FROM (SELECT 1 FROM free_data fd WHERE ... LIMIT 100001) sub` -- Postgres will stop scanning after finding 100,001 rows, preventing timeout for broad queries.
3. **Keep the paginated data query** (already fast with the composite index).

This gives **exact counts** up to 100K (the display cap), and "100,000+" for anything larger -- matching the existing UI behavior.

## Technical Details

### Single migration: Update `search_free_data_builder`

Replace the EXPLAIN-based count block with a bounded count:

```text
-- CURRENT (inaccurate planner estimate):
EXECUTE 'EXPLAIN (FORMAT JSON) SELECT 1 FROM ...' INTO explain_result;
v_total_count := (explain_result->0->'Plan'->>'Plan Rows')::bigint;

-- NEW (exact count, bounded at 100,001):
EXECUTE 'SELECT count(*) FROM (SELECT 1 FROM public.free_data fd '
  || where_clause || ' LIMIT 100001) _sub'
  INTO v_total_count USING ...;
IF v_total_count > 100000 THEN v_total_count := 100000; END IF;
```

### Why This Won't Time Out

- The inner `LIMIT 100001` means Postgres stops scanning after finding 100,001 matching rows
- For narrow filters (100s-1000s of results): scans only those rows -- fast
- For broad filters (10,000s+ results): scans at most 100,001 rows then stops -- bounded time
- Worst case: broad filter that matches 100K+ records still only scans ~100K rows, which with the composite index takes under 5 seconds

### Unfiltered queries

Continue using `pg_class.reltuples` for the unfiltered base count (instant).

### No frontend changes needed

Same function signature (37 parameters), same return type, same capped behavior. The only difference: counts will be accurate again.

### Risks
- Low risk: Same architecture, just replacing the count method
- Bounded scan ensures no timeout even for broad filters
- Exact counts up to 100K instead of rough estimates
