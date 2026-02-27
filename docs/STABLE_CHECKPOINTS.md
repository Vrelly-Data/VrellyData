# Stable Checkpoints

**Purpose**: Document stable states for easy recovery. Say "Revert to v4.0 stable state" to restore.  
**Last Updated**: February 27, 2026  
**Current Stable Version**: v4.0

---

## 🚨 CRITICAL: DO NOT MODIFY WITHOUT EXPLICIT INSTRUCTION

The audience builder search functions are **LOCKED**. Do NOT modify them unless the user explicitly says:
- "Modify the search function"
- "Change filter logic"
- "Update the builder search"

If in doubt, **ASK FIRST**.

---

## ⏪ Quick Revert Command

Say this to revert to the last known good state:

> **"Revert to v4.0 stable state"**

The AI will:
1. Copy functions from the stable migration files
2. Create a new migration with `CREATE OR REPLACE FUNCTION` for all three search functions
3. Verify no duplicate functions exist
4. Verify baseline counts match expectations
5. Restore frontend gender conversion in `useFreeDataSearch.ts`

---

## ✅ Current Stable: v4.0

**Date**: February 27, 2026  
**Status**: Split architecture deployed. All 18 filters + 8 DNC exclusions verified. Keyword counts now accurate.

### Confirmed Working Filters (18 total)

| # | Filter | Status | Notes |
|---|--------|--------|-------|
| 1 | Keyword Logic | ✅ Working | Searches across multiple fields |
| 2 | Prospect Data | ✅ Working | All has_* boolean filters |
| 3 | Company Revenue | ✅ Working | Fixed in v2.10 with parse_revenue_to_numeric |
| 4 | Job Titles | ✅ Working | ILIKE pattern matching |
| 5 | Seniority | ✅ Working | Regex-based title matching (incl. Individual Contributor) |
| 6 | Department | ✅ Working | Regex-based matching |
| 7 | Person City | ✅ Working | COALESCE fallback to personCity/companyCity |
| 8 | Person Country | ✅ Working | COALESCE fallback to personCountry/companyCountry |
| 9 | Company City | ✅ Working | Same as Person City |
| 10 | Company Country | ✅ Working | Same as Person Country |
| 11 | Technology | ✅ Working | Array contains matching |
| 12 | Company Size | ✅ Working | Includes 5001-10000 and 10000+ buckets |
| 13 | Person Interest | ✅ Working | Array/string matching |
| 14 | Person Skill | ✅ Working | Array/string matching |
| 15 | Gender | ✅ Working | DB stores M/F, frontend converts male/female |
| 16 | Person Income | ✅ Working | Numeric range parsing |
| 17 | Person Net Worth | ✅ Working | Numeric range parsing (supports negatives) |
| 18 | Industry Suggestions | ✅ Working | Frontend Title Case normalization |

---

## 🔧 Database Functions (v4.0)

| Function | Parameters | Status |
|----------|------------|--------|
| `search_free_data_builder` | 37 | ✅ Retained (backward compat, not called from frontend) |
| `search_free_data_results` | 35 | ✅ New — data retrieval (SECURITY DEFINER, 15s timeout) |
| `search_free_data_count` | 35 | ✅ New — exact bounded count (SECURITY DEFINER, 30s timeout) |
| `parse_employee_count_upper` | 1 | ✅ Helper |
| `parse_revenue_to_numeric` | 1 | ✅ Helper (added v2.10) |
| `title_matches_seniority` | 3 | ✅ Helper (2 versions) |
| `get_filter_suggestions` | 0 | ✅ Suggestion provider |

---

## 🎨 Gender Filter Note (v3.3)

The Gender filter stores values as `M` or `F` in the database. The frontend (`src/hooks/useFreeDataSearch.ts`) includes a `convertGender` function that translates:
- `male` → `M`
- `female` → `F`

---

## 🛡️ Pre-Change Checklist

Before modifying any filter logic:

- [ ] User explicitly requested the change
- [ ] Current counts verified against baseline
- [ ] Migration uses `CREATE OR REPLACE FUNCTION`
- [ ] Signatures stay identical (37 for builder, 35 each for results/count)
- [ ] Run `docs/BUILDER_SEARCH_TEST.sql` after changes
- [ ] No duplicate functions created
- [ ] Post-change counts verified

---

## 🔄 Manual Revert Procedure

If the quick command doesn't work:

1. Find the stable migration files
2. Copy all functions:
   - `parse_revenue_to_numeric`
   - `search_free_data_builder`
   - `search_free_data_results`
   - `search_free_data_count`
3. Create new migration with `CREATE OR REPLACE FUNCTION`
4. Verify single version of each function exists with correct parameter counts
5. Restore frontend gender conversion in `src/hooks/useFreeDataSearch.ts`

---

## 📝 Change Log

| Version | Date | Changes |
|---------|------|---------|
| v4.0 | 2026-02-27 | Split architecture: `search_free_data_results` + `search_free_data_count` replace `search_free_data_builder` as frontend entry points. EXPLAIN estimates removed — all filtered counts now exact (bounded at 100,001). Keyword count accuracy fixed (CEO: 771 → 21,282). |
| v3.9 | 2026-02-25 | Copy Tab reorganization, stable state docs refreshed with 61,644 records baseline |
| v3.8 | 2026-02-20 | Resource CMS, AI Copy & Audience generation with Sales KB context |
| v3.7 | 2026-02-18 | Stripe checkout flow fixed |
| v3.6 | 2026-02-11 | DNC exclusion filters (37 params), 100,000+ display cap |
| v3.5 | 2026-02-10 | Email stats aggregation fix |
| v3.4 | 2026-02-08 | Data Playground: auto-link on first sync |
| v3.3 | 2026-01-21 | Updated baseline counts, documented Gender M/F format |
| v3.2 | 2026-01-17 | Established stable state with 724 records, 18 filters |
| v3.1 | 2026-01-17 | Added Company Size 5001-10000, 10000+ and Individual Contributor |
| v3.0 | 2026-01-17 | Documented all 17 working filters, established revert mechanism |
| v2.10 | 2026-01-17 | Fixed Company Revenue filter with parse_revenue_to_numeric |

---

## 🔍 Audience Builder Stable State (v4.0)

**Date**: February 27, 2026  
**Status**: Split architecture deployed. Keyword counts accurate. Display cap working.

### Architecture

```
Frontend (useFreeDataSearch.ts)
  ├── Promise.allSettled([
  │     search_free_data_results(filters, limit, offset)  → rows display immediately
  │     search_free_data_count(filters)                    → count updates independently
  │   ])
  └── audienceStore.ts ← totalEstimate, isEstimate, results
```

### Key Files

| File | Role |
|------|------|
| `src/hooks/useFreeDataSearch.ts` | Search hook — parallel RPC calls, display cap |
| `src/stores/audienceStore.ts` | Store with `isEstimate` flag for count display |
| `src/pages/AudienceBuilder.tsx` | Main builder page |
| `src/components/search/PreviewTable.tsx` | Results display with 100,000+ formatting |
| `src/components/search/FilterBuilder.tsx` | Filter UI with DNC sections and dedup helper |

### Performance

| Operation | Typical Time |
|-----------|-------------|
| Data retrieval (`search_free_data_results`) | ~1-2s |
| Keyword count (`search_free_data_count`) | ~3-5s |
| Equality filter count | ~1-3s |
| Unfiltered count (pg_class) | Instant |

---

## 💳 Stripe Checkout Stable State (v3.7)

**Date:** February 18, 2026  
**Status:** End-to-end checkout working

### Key Files

| File | Role |
|------|------|
| `src/pages/CheckoutSuccess.tsx` | Unprotected post-payment verification page |
| `src/components/ProtectedRoute.tsx` | Simplified to pure auth + subscription guard |
| `src/components/AuthProvider.tsx` | Guards `SIGNED_OUT`; handles `INITIAL_SESSION` |

---

## 🎮 Data Playground Stable State (v3.4)

**Date**: February 8, 2026  
**Status**: Sync working, auto-link enabled

### Key Components

| Component | Status |
|-----------|--------|
| Auto-link on first sync | ✅ Working |
| links_initialized flag | ✅ Working |
| Link All Campaigns button | ✅ Working |
| Contact sync paging | ✅ Working |

---

## 📰 Resource CMS Stable State (v3.8)

**Date**: February 20, 2026  
**Status**: Database-backed article publishing with SEO

---

## 🎨 Data Playground Copy Tab (v3.9)

**Date**: February 25, 2026  
**Status**: Saved AI copies moved from Dashboard to Copy Tab
