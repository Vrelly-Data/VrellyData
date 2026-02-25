

# Cache Filter Suggestions with a Materialized View

## Problem
The `get_filter_suggestions()` function scans the entire `free_data` table (currently 61K rows, soon 1M) to compute distinct values for industries, skills, interests, and technologies. At 61K rows it already takes ~40 seconds. At 1M rows it will exceed the 120-second database timeout, breaking both the Audience Builder and Build Audience dialog.

## Solution
Create a materialized view that pre-computes the distinct suggestion values once, then update `get_filter_suggestions()` to read from the view instantly (~1ms instead of ~40s).

## Changes

### 1. Database Migration

Create a materialized view `mv_filter_suggestions` with four columns (interests, skills, industries, technologies), each storing a JSONB array of distinct lowercase values. This is the same data `get_filter_suggestions()` currently computes on-the-fly.

Create a unique index on the view to enable `REFRESH MATERIALIZED VIEW CONCURRENTLY` (non-blocking refresh).

Replace the body of `get_filter_suggestions()` to simply `SELECT` from the materialized view — instant response.

Create a helper function `refresh_filter_suggestions()` that admins or the CSV upload flow can call after importing new data.

Populate the view as part of the migration so it works immediately.

### 2. No Frontend Changes

The `useFreeDataSuggestions` hook already calls `get_filter_suggestions()` — it will simply get results in milliseconds instead of timing out.

### 3. No Edge Function Changes

The `search_free_data_builder` function is unaffected — it uses indexes and WHERE clauses, not full-table scans.

## Risk Assessment

| Risk | Level | Mitigation |
|------|-------|------------|
| Stale suggestions after CSV upload | Low | Call `refresh_filter_suggestions()` after uploads; suggestions only change when admin adds new data |
| Migration failure | Low | Pure additive change — creates new objects, replaces function body. No existing tables or indexes are modified |
| Concurrent refresh blocking | None | Unique index enables `CONCURRENTLY` mode which doesn't lock reads |

## What This Fixes
- Audience Builder page load: no more statement timeout
- Build Audience dialog: suggestions load instantly
- Ready for 1M+ record scale

## Technical Detail

```text
BEFORE (every page load):
  get_filter_suggestions()
    -> 4 full sequential scans of free_data (61K+ rows)
    -> ~40 seconds (will be 500s+ at 1M)

AFTER (every page load):
  get_filter_suggestions()
    -> SELECT from mv_filter_suggestions (1 row)
    -> < 10ms

REFRESH (admin uploads only):
  refresh_filter_suggestions()
    -> REFRESH MATERIALIZED VIEW CONCURRENTLY
    -> runs in background, no user impact
```

