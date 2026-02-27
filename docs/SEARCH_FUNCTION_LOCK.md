# 🔒 Search Function Lock Document

**Purpose**: Protect the audience builder search functions from unintended modifications.  
**Version**: 4.0  
**Last Updated**: February 27, 2026

---

## 🚨 STOP! READ THIS FIRST

The audience builder search functions are **LOCKED AND VERIFIED WORKING**.

**DO NOT MODIFY** unless the user explicitly says one of:
- "Modify the search function"
- "Change filter logic"
- "Update the builder search"
- "Add a new filter to the builder"

If you're unsure, **ASK THE USER FIRST**.

---

## 🏗️ Architecture (v4.0 — Split Search)

The frontend no longer calls a single RPC. Instead it calls **two functions in parallel** via `Promise.allSettled`:

| Function | Purpose | Timeout | Returns |
|----------|---------|---------|---------|
| `search_free_data_results` | Paginated data rows | 15s (SECURITY DEFINER) | `entity_data`, `entity_external_id` |
| `search_free_data_count` | Exact bounded count | 30s (SECURITY DEFINER) | `total_count`, `is_estimate` |

`search_free_data_builder` is **retained for backward compatibility** but is no longer called from the frontend.

### Count Strategy

- **Filtered queries**: Exact bounded count (`SELECT count(*) FROM (... LIMIT 100001) _sub`), `is_estimate = false`
- **Unfiltered queries**: `pg_class.reltuples` for instant statistical count, `is_estimate = true`
- **Timeout fallback**: If count query fails, returns `total_count = 0`, `is_estimate = true`

---

## ⏪ Quick Revert Command

If anything breaks, the user can say:

> **"Revert to v4.0 stable state"**

---

## ✅ 18 Verified Working Filters + 8 DNC Exclusions

All of these filters have been tested and confirmed working as of v4.0:

| # | Filter | Status |
|---|--------|--------|
| 1 | Keyword Logic | ✅ |
| 2 | Prospect Data (all has_* filters) | ✅ |
| 3 | Company Revenue | ✅ |
| 4 | Job Titles | ✅ |
| 5 | Seniority (including Individual Contributor) | ✅ |
| 6 | Department | ✅ |
| 7 | Person City | ✅ |
| 8 | Person Country | ✅ |
| 9 | Company City | ✅ |
| 10 | Company Country | ✅ |
| 11 | Technology | ✅ |
| 12 | Company Size (5001-10000, 10000+) | ✅ |
| 13 | Person Interest | ✅ |
| 14 | Person Skill | ✅ |
| 15 | Gender | ✅ |
| 16 | Person Income | ✅ |
| 17 | Person Net Worth | ✅ |
| 18 | Industry Suggestions (Frontend Normalized) | ✅ |

### DNC (Do Not Include) Exclusion Parameters (v3.6)

| # | Exclusion Parameter | Status |
|---|---------------------|--------|
| 1 | p_exclude_keywords | ✅ |
| 2 | p_exclude_job_titles | ✅ |
| 3 | p_exclude_industries | ✅ |
| 4 | p_exclude_cities | ✅ |
| 5 | p_exclude_countries | ✅ |
| 6 | p_exclude_technologies | ✅ |
| 7 | p_exclude_person_skills | ✅ |
| 8 | p_exclude_person_interests | ✅ |

---

## 📁 Stable Migration References

| Migration | Contents |
|-----------|----------|
| `20260117175524_*.sql` | `parse_revenue_to_numeric()`, `search_free_data_builder()` (37 params) |
| `20260227_split_search_*.sql` | `search_free_data_results()` (35 params), `search_free_data_count()` (35 params) |

---

## 🎨 Frontend Normalization (v4.0)

### Industry Suggestions

**File**: `src/hooks/useFreeDataSuggestions.ts`

Industry suggestions are normalized to Title Case and deduplicated in the frontend.

### Industry Deduplication in FilterBuilder

**File**: `src/components/search/FilterBuilder.tsx`

The `dedup()` helper applies `trim()` + Title Case normalization before `new Set()` dedup.

### Display Cap

**File**: `src/hooks/useFreeDataSearch.ts`

`TOTAL_DISPLAY_CAP = 100_000` — When results exceed 100,000, the UI displays "100,000+". `totalEstimate` and `totalPages` are clamped to this limit.

### Parallel RPC Calls

**File**: `src/hooks/useFreeDataSearch.ts`

The hook calls `search_free_data_results` and `search_free_data_count` in parallel via `Promise.allSettled`. Results display immediately; count arrives independently and updates the store's `isEstimate` flag.

---

## 🛡️ Guardrails

### Before ANY Change to search functions:

1. ⚠️ **User must explicitly request the change**
2. ⚠️ **Verify current baseline counts first**
3. ⚠️ **Use CREATE OR REPLACE FUNCTION**
4. ⚠️ **Never change the parameter signatures** (37 for builder, 35 each for results/count)
5. ⚠️ **Run BUILDER_SEARCH_TEST.sql after changes**
6. ⚠️ **Verify no duplicate functions created**

### If You Break Something:

1. Tell the user to say: "Revert to v4.0 stable state"
2. Copy functions from the stable migration files
3. Create new migration with CREATE OR REPLACE
4. Verify counts match baseline

---

## 📊 Baseline Verification Queries (v4.0)

Quick checks using the **new split functions**:

```sql
-- Results function health check (should return 10 rows)
SELECT count(*) FROM public.search_free_data_results(
  p_entity_type := 'person', p_limit := 10, p_offset := 0
);

-- Count function: unfiltered (is_estimate = true, uses pg_class.reltuples)
SELECT total_count, is_estimate FROM public.search_free_data_count(
  p_entity_type := 'person'
);

-- Count function: keyword — was broken (771), now accurate (~21,282)
SELECT total_count, is_estimate FROM public.search_free_data_count(
  p_entity_type := 'person', p_keywords := ARRAY['CEO']
);
-- Expected: ~21,282, is_estimate = false

-- Count function: equality filter
SELECT total_count, is_estimate FROM public.search_free_data_count(
  p_entity_type := 'person', p_gender := ARRAY['M']
);
```

Legacy `search_free_data_builder` checks (backward compat):

```sql
SELECT total_count FROM public.search_free_data_builder(
  p_entity_type := 'person'
) LIMIT 1;

SELECT total_count FROM public.search_free_data_builder(
  p_entity_type := 'company'
) LIMIT 1;
```

---

## 🔧 What the AI Should Do on Revert

When user says "Revert to v4.0 stable state":

1. Read stable migration files
2. Extract all three functions: `search_free_data_builder`, `search_free_data_results`, `search_free_data_count`
3. Extract `parse_revenue_to_numeric`
4. Create new migration with `CREATE OR REPLACE` for all functions
5. Verify no duplicate functions
6. Run verification queries to confirm baseline counts
7. Verify frontend normalization in `useFreeDataSuggestions.ts`

---

## 📝 Related Documentation

- `docs/STABLE_CHECKPOINTS.md` - Version history and baseline counts
- `docs/FILTER_CONTRACT.md` - Field mappings and parameter reference
- `docs/BUILDER_SEARCH_TEST.sql` - Automated test suite
- `docs/FILTER_DATA_MAPPING.md` - UI to database field mapping
- `docs/V4.0_RELEASE_NOTES.md` - Split architecture release notes

---

## ⚡ Quick Reference

| What | Value |
|------|-------|
| Current Version | v4.0 |
| Architecture | Split: results + count in parallel |
| Frontend Entry | `useFreeDataSearch.ts` → `Promise.allSettled` |
| Results Function | `search_free_data_results` (35 params, 15s timeout) |
| Count Function | `search_free_data_count` (35 params, 30s timeout) |
| Legacy Function | `search_free_data_builder` (37 params, retained) |
| Revert Command | "Revert to v4.0 stable state" |
| Test File | `docs/BUILDER_SEARCH_TEST.sql` |
| Display Cap | 100,000+ (`useFreeDataSearch.ts`) |
| Count Strategy | Bounded exact (filtered) / pg_class (unfiltered) |
