

# Update Documentation for v4.0 Split Architecture

## What Changed

The audience builder search was refactored from a single `search_free_data_builder` RPC into a two-phase split architecture:

1. **`search_free_data_results`** -- returns paginated rows only (fast, ~1-2s)
2. **`search_free_data_count`** -- returns exact bounded count independently (up to 30s budget)
3. **Frontend** (`useFreeDataSearch.ts`) calls both in parallel via `Promise.allSettled`
4. The EXPLAIN estimation approach was removed -- all filtered counts are now exact (bounded at 100,001)

## Files to Update

### 1. `docs/SEARCH_FUNCTION_LOCK.md`

- Bump version to **v4.0**
- Update date to February 27, 2026
- Document the split architecture: `search_free_data_results` + `search_free_data_count` replace `search_free_data_builder` as the frontend entry points
- Note that `search_free_data_builder` is retained for backward compatibility but no longer called from frontend
- Update the Quick Reference table with new function names, parameter counts (35 each), and architecture description
- Update baseline verification queries to use the new functions
- Update the revert command to "Revert to v4.0 stable state"
- Remove the "Known Issue: Queries time out at 61k+" note (this is now resolved)
- Update guardrails to reference all three functions

### 2. `docs/STABLE_CHECKPOINTS.md`

- Bump to v4.0
- Add v4.0 entry to the Change Log
- Update the Database Functions table to include `search_free_data_results` and `search_free_data_count`
- Add a new "Audience Builder Stable State (v4.0)" section documenting the split architecture
- Update the Audience Builder key files table to reflect `useFreeDataSearch.ts` parallel call pattern
- Add the `isEstimate` store field in `audienceStore.ts` to key files
- Update baseline verification queries to use new functions
- Update revert procedure to reference all three functions
- Remove the "no expression indexes" warning since timeouts are resolved

### 3. `docs/BUILDER_SEARCH_TEST.sql`

- Update header to v4.0
- Add new Section 0: Function Health Check for `search_free_data_results` and `search_free_data_count` (verify they exist with correct parameter counts)
- Keep existing `search_free_data_builder` tests as backward-compatibility checks
- Add new test sections that verify `search_free_data_count` returns accurate counts:
  - CEO keyword search should return ~21,282 with `is_estimate = false`
  - Gender Male should return accurate count with `is_estimate = false`
  - Unfiltered count returns `is_estimate = true` (uses pg_class.reltuples)

### 4. `docs/V4.0_RELEASE_NOTES.md` (new file)

Create release notes documenting:
- **Problem**: Keyword searches timed out due to 8s role-level timeout; EXPLAIN estimates were wildly inaccurate (771 vs 21,256 for "CEO")
- **Solution**: Split architecture with parallel RPC calls
- **Three phases of the fix**: (1) Split into results + count functions, (2) Remove EXPLAIN estimates, (3) Use unified bounded count
- **Key files changed**: migration files, `useFreeDataSearch.ts`, `audienceStore.ts`, `AudienceBuilder.tsx`
- **Architecture diagram** showing the parallel call flow
- **Performance characteristics**: results ~1-2s, count ~3-5s for keywords, both within SECURITY DEFINER timeout budgets

## Technical Details

### New Baseline Verification Queries (v4.0)

The lock doc and checkpoints will use the new functions:

```text
-- Results function health check
SELECT count(*) FROM public.search_free_data_results(p_entity_type := 'person', p_limit := 10, p_offset := 0);

-- Count function: unfiltered
SELECT total_count, is_estimate FROM public.search_free_data_count(p_entity_type := 'person');

-- Count function: keyword (was broken, now accurate)
SELECT total_count, is_estimate FROM public.search_free_data_count(p_entity_type := 'person', p_keywords := ARRAY['CEO']);
-- Expected: ~21,282, is_estimate = false

-- Count function: equality filter
SELECT total_count, is_estimate FROM public.search_free_data_count(p_entity_type := 'person', p_gender := ARRAY['M']);
```

### Updated Database Functions Table

| Function | Parameters | Status |
|----------|-----------|--------|
| `search_free_data_builder` | 37 | Retained (backward compat, not called from frontend) |
| `search_free_data_results` | 35 | New -- data retrieval (SECURITY DEFINER, 15s timeout) |
| `search_free_data_count` | 35 | New -- exact bounded count (SECURITY DEFINER, 30s timeout) |
| `parse_revenue_to_numeric` | 1 | Helper |
| `parse_employee_count_upper` | 1 | Helper |
| `title_matches_seniority` | 3 | Helper |
| `get_filter_suggestions` | 0 | Suggestion provider |

