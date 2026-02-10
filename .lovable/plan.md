

# Fix Duplicate Industry Suggestions

## Problem

The industry suggestions dropdown shows duplicate entries (e.g., "Insurance" appearing twice). This happens because the suggestion list is built by merging two sources:

1. **Mock/hardcoded industries** from `MOCK_ATTRIBUTES` (e.g., "Retail", "Software")
2. **Database-sourced industries** from `get_filter_suggestions()` (e.g., "insurance", "retail")

The frontend applies Title Case normalization and `new Set()` deduplication, but there are edge cases where case-sensitive `DISTINCT` in PostgreSQL produces near-duplicates that slip through.

## Root Cause

The database function `get_filter_suggestions` uses `DISTINCT` on raw values, which is **case-sensitive** in PostgreSQL. If the data contains both `insurance` and `Insurance` across different records (one in `industry`, another in `companyIndustry`), both survive `DISTINCT` and get returned. The frontend Title Case + `new Set` should catch these, but only if the normalization is perfectly consistent. Values with special characters like `&`, `-`, or `,` can produce inconsistent Title Case results.

## Fix (2 changes)

### 1. Database function: case-insensitive deduplication

Update `get_filter_suggestions` so the industries subquery uses `LOWER(TRIM(...))` for deduplication, then returns the lowercased values. This guarantees no case-based duplicates leave the database.

```sql
-- Current: DISTINCT val (case-sensitive)
-- Fixed:   DISTINCT LOWER(TRIM(val)) (case-insensitive)
```

This is a single `CREATE OR REPLACE FUNCTION` migration -- no signature change, no parameter changes.

### 2. Frontend hook: add `.trim()` before Title Case

In `useFreeDataSuggestions.ts`, add `.trim()` to the industry normalization pipeline to catch any whitespace edge cases:

```
.map(i => i.trim().split(' ')...)
```

Also apply the same deduplication to the `skills`, `interests`, and `technologies` arrays for consistency (they currently don't normalize at all).

## What Does NOT Change

- `search_free_data_builder` function -- untouched
- All 37 parameters -- untouched
- FilterBuilder UI -- untouched
- DNC exclusion logic -- untouched
- Filter result counts -- untouched
- No changes to any other hooks or components

## Revert Safety

"Revert to v3.5 stable state" still applies. These changes are purely cosmetic (suggestion display only) and have zero impact on search logic.
