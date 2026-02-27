

# Fix: Inaccurate Keyword Counts (771 vs 21,256)

## Problem

When you search for "CEO", the count shows ~771 but the actual number is **21,256**. This happens because the `search_free_data_count` function uses Postgres `EXPLAIN` planner estimates for keyword searches, and those estimates are wildly inaccurate for JSONB ILIKE queries (off by 27x in this case).

The EXPLAIN approach was chosen to avoid timeouts, but now that the count function runs independently with its own 30-second timeout budget, we can safely use exact bounded counts for everything.

## Solution

Remove the tiered counting strategy entirely. Use **one counting method for all filters**: the exact bounded count with `LIMIT 100001`. This is the same method that already works perfectly for non-keyword filters.

### Why this will work now (and didn't before)

- The count function has `SET statement_timeout TO '30s'` (SECURITY DEFINER), which overrides the 8-second role-level timeout
- A bounded count of 21K CEO matches should take ~3-5 seconds (well within 30s)
- Even broad keyword searches that match 100K+ rows stop scanning at 100,001 rows
- The data retrieval function is unaffected -- results always return in ~1-2 seconds

### What changes

**Database migration**: Update `search_free_data_count` to remove the EXPLAIN path and use bounded exact count for all filtered queries:

```text
-- BEFORE (tiered strategy):
IF has_keyword_filters THEN
  EXECUTE 'EXPLAIN (FORMAT JSON) SELECT 1 ...'  -- returns 771 (wrong!)
  v_is_estimate := true;
ELSE
  EXECUTE 'SELECT count(*) FROM (... LIMIT 100001) _sub'  -- exact
  v_is_estimate := false;
END IF;

-- AFTER (unified strategy):
IF has_filters THEN
  EXECUTE 'SELECT count(*) FROM (... LIMIT 100001) _sub'  -- always exact
  v_is_estimate := false;
END IF;
```

- Remove the `has_keyword_filters` variable and all EXPLAIN logic
- Keep the unfiltered path using `pg_class.reltuples` (still instant for base counts)
- All filtered searches now return `is_estimate = false` with accurate counts
- Add exception handler so if the count does time out (extreme edge case), it falls back gracefully with `is_estimate = true` and count of 0

**No frontend changes needed** -- the `isEstimate` flag and `~` prefix logic already exist and will simply show exact counts more often.

## Expected Results

| Search | Before | After |
|--------|--------|-------|
| CEO keyword | ~771 (estimate, wrong) | 21,256 (exact) |
| Gender: Male | 43,109 (exact) | 43,109 (exact, unchanged) |
| No filters | ~154K (estimate) | ~154K (estimate, unchanged) |

## Risk

- Low: we're removing the problematic EXPLAIN path and using the proven bounded count method
- The 30-second timeout on the count function provides ample headroom
- If a count query somehow exceeds 30s, the exception handler returns a safe fallback and the data results still display normally

