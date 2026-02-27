

# Fix: Reliable Fast Search with Split Architecture

## Root Cause Found

The `authenticated` database role has a **hard 8-second statement timeout**. Here's what happens with a keyword search like "CEO":

- **Data query** (get 100 rows): ~1.2 seconds -- FINE
- **Bounded count query** (count all matches): ~18 seconds -- TIMES OUT
- **Combined in one RPC**: exceeds 8s, gets killed with error `57014`

The bounded count approach (LIMIT 100001 subquery) we added doesn't help for keyword searches because ILIKE across 6 JSONB fields must scan all 154K rows to find all ~21K matches. Even the trigram indexes can't speed up counting at this scale.

This is why other filters (industry, gender, company size) worked fine -- they use equality matches on indexed columns and count quickly. Keywords are the problematic case.

## Solution: Two-Phase Search Architecture

Split the single RPC into **two separate calls** from the frontend, run in parallel:

### 1. Data Function: `search_free_data_results` (new, fast)
- Returns only paginated rows (LIMIT/OFFSET)
- No count query at all
- Completes in ~1-2 seconds consistently
- Uses existing composite index for ordering

### 2. Count Function: `search_free_data_count` (new, smart)
- Runs separately with its own timeout budget
- Uses a **tiered counting strategy**:
  - Non-keyword filters: exact bounded count (fast, under 2s)
  - Keyword filters: EXPLAIN planner estimate (instant, approximate)
- Returns `total_count` and `is_estimate` boolean
- SET `statement_timeout TO '30s'` on this function (SECURITY DEFINER overrides role timeout)

### 3. Frontend Changes: `useFreeDataSearch.ts`
- Call both functions in parallel with `Promise.allSettled`
- Display data immediately when results arrive
- Show count when it arrives (or "many results" if count times out)
- Show "~X results" indicator when count is an estimate

## Technical Details

### Migration: Create two new functions + keep original

```text
-- Function 1: Results only (fast, always succeeds)
CREATE FUNCTION search_free_data_results(...)
  RETURNS TABLE(entity_external_id text, entity_data jsonb)
  SET statement_timeout TO '15s'
  -- Same WHERE clause building, just no count step

-- Function 2: Count only (smart strategy)
CREATE FUNCTION search_free_data_count(...)
  RETURNS TABLE(total_count bigint, is_estimate boolean)
  SET statement_timeout TO '30s'
  -- Keyword filters: EXPLAIN estimate (instant)
  -- Other filters: exact bounded count
```

Both functions use `SECURITY DEFINER` with explicit `SET statement_timeout` which overrides the role-level 8s limit.

The original `search_free_data_builder` remains for backward compatibility but won't be called from the frontend anymore.

### Frontend: `useFreeDataSearch.ts`

```text
// Call both in parallel
const [resultsResponse, countResponse] = await Promise.allSettled([
  supabase.rpc('search_free_data_results', dataParams),
  supabase.rpc('search_free_data_count', countParams),
]);

// Always show data (fast path)
// Show count when available, "Loading..." or "~X" if still pending or estimated
```

### Why This Works

- **Data always returns fast**: ~1.2s, well within any timeout
- **Count never blocks data**: runs independently
- **Keyword counts are instant**: EXPLAIN estimate returns in <1ms
- **Non-keyword counts are exact**: bounded count for equality filters is fast
- **Graceful degradation**: if count fails, data still shows with approximate indicator

### Accuracy Trade-off

- Non-keyword filters: exact counts (same as before)
- Keyword filters: approximate counts (EXPLAIN estimates can be 2-5x off, but the UI already caps at 100K and shows ranges)
- The `is_estimate` flag lets the frontend show "~21,000 results" vs "21,282 results"

### Files Changed

1. **New migration**: Creates `search_free_data_results` and `search_free_data_count` functions
2. **`src/hooks/useFreeDataSearch.ts`**: Parallel calls to both new functions
3. **`src/pages/AudienceBuilder.tsx`**: Minor update to show estimate indicator if needed

### Risk Assessment

- Low risk: existing function untouched, new functions added alongside
- Data retrieval path is simpler (no count overhead)
- Worst case: count fails silently, data still shows
- Rollback: revert to calling original function

