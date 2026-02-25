# Stable Checkpoints

**Purpose**: Document stable states for easy recovery. Say "Revert to v3.9 stable state" to restore.  
**Last Updated**: February 25, 2026  
**Current Stable Version**: v3.9

---

## 🚨 CRITICAL: DO NOT MODIFY WITHOUT EXPLICIT INSTRUCTION

The `search_free_data_builder` function is **LOCKED**. Do NOT modify it unless the user explicitly says:
- "Modify the search function"
- "Change filter logic"
- "Update the builder search"

If in doubt, **ASK FIRST**.

---

## ⏪ Quick Revert Command

Say this to revert to the last known good state:

> **"Revert to v3.9 stable state"**

The AI will:
1. Copy functions from the stable migration
2. Create a new migration with `CREATE OR REPLACE FUNCTION`
3. Verify no duplicate functions exist
4. Verify baseline counts match expectations
5. Restore frontend gender conversion in `useFreeDataSearch.ts`

---

## ✅ Current Stable: v3.9

**Date**: February 25, 2026  
**Status**: All 18 filters + 8 DNC exclusions verified working

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

## 📊 Verified Baseline Counts (v3.9)

Use these for regression testing. If counts change unexpectedly, something is broken.

### Data Source Summary
| Source | Entity Type | Count |
|--------|-------------|-------|
| **Total Records** | All | **61,644** |
| Person Records | person | 52,119 |
| Company Records | company | 9,525 |

### Company Size Filters (entity_type = person)
| Filter | Value | Expected Count |
|--------|-------|----------------|
| Company Size | 1-10 | 5,109 |
| Company Size | 11-50 | 10,283 |
| Company Size | 51-200 | 9,013 |
| Company Size | 201-500 | 4,893 |
| Company Size | 5001-10000 | 2,725 |
| Company Size | 10000+ | 10,202 |

### Company Revenue Filters (entity_type = person)
| Filter | Value | Expected Count |
|--------|-------|----------------|
| Company Revenue | Under $1M | 652 |
| Company Revenue | $1M - $10M | 5,452 |
| Company Revenue | $10M - $50M | 7,540 |

### Person Demographics
| Filter | Value | Expected Count |
|--------|-------|----------------|
| Income | Under $50K | 55 |
| Income | $50K - $100K | 77 |
| Net Worth | Under $100K | 96 |
| Gender | Male (M) | 136 |
| Gender | Female (F) | 55 |

### Professional Filters
| Filter | Value | Expected Count |
|--------|-------|----------------|
| Department | C-Suite / Leadership | 11,725 |
| Seniority | Individual Contributor | 174 |

### Prospect Data
| Filter | Value | Expected Count |
|--------|-------|----------------|
| Personal Facebook | true | 13 |
| Personal Twitter | true | 7 |
| Company Facebook | true | 38,502 |
| Company Twitter | true | 36,391 |
| Company LinkedIn | true | 51,351 |

---

## 🎨 Gender Filter Note (v3.3)

The Gender filter stores values as `M` or `F` in the database. The frontend (`src/hooks/useFreeDataSearch.ts`) includes a `convertGender` function that translates:
- `male` → `M`
- `female` → `F`

---

## 🔧 Database Functions (v3.9)

| Function | Parameters | Status |
|----------|------------|--------|
| `search_free_data_builder` | 37 | ✅ Single version |
| `parse_employee_count_upper` | 1 | ✅ Helper |
| `parse_revenue_to_numeric` | 1 | ✅ Helper (added v2.10) |
| `title_matches_seniority` | 3 | ✅ Helper (2 versions) |
| `get_filter_suggestions` | 0 | ✅ Suggestion provider |

### Database Indexes on `free_data` (v3.9)

| Index | Type | Notes |
|-------|------|-------|
| Primary key | btree | id |
| entity_type | btree | Partition-like index |
| entity_external_id | btree | Deduplication lookups |
| entity_data | GIN (jsonb_path_ops) | `@>` containment only |
| entity_type + created_at | btree | Sorted listing |
| source_template_id | btree | Template FK |
| Unique constraint | btree | entity_external_id + entity_type |

**⚠️ No expression indexes on JSONB fields** — this is why queries time out at 61k+ records. The next optimization step (v3.10) will add expression indexes and rewrite the function to single-pass.

---

## 📝 Change Log

| Version | Date | Changes |
|---------|------|---------|
| v3.9 | 2026-02-25 | Copy Tab reorganization (saved copies moved from Dashboard to Copy Tab), stable state docs refreshed with 61,644 records baseline |
| v3.8 | 2026-02-20 | Resource CMS (database-backed SEO articles), AI Copy & Audience generation with Sales KB context, Sales Knowledge Base CSV import |
| v3.7 | 2026-02-18 | Stripe checkout flow fixed: white screen, infinite spinner, and transient logout resolved |
| v3.6 | 2026-02-11 | DNC exclusion filters (37 params), 100,000+ display cap, case-insensitive industry dedup in FilterBuilder |
| v3.5 | 2026-02-10 | Email stats aggregation fix, webhook messaging removal from popovers |
| v3.4 | 2026-02-08 | Data Playground: auto-link on first sync, links_initialized column, Link All recovery button |
| v3.3 | 2026-01-21 | Updated baseline counts, documented Gender M/F format, verified 137 Male / 55 Female |
| v3.2 | 2026-01-17 | Established stable state with 724 records, 18 filters, updated baselines |
| v3.1.1 | 2026-01-17 | Frontend industry suggestion normalization (Title Case + dedup) |
| v3.1 | 2026-01-17 | Added Company Size 5001-10000, 10000+ and Individual Contributor |
| v3.0 | 2026-01-17 | Documented all 17 working filters, established revert mechanism |
| v2.10 | 2026-01-17 | Fixed Company Revenue filter with parse_revenue_to_numeric |

---

## 🛡️ Pre-Change Checklist

Before modifying any filter logic:

- [ ] User explicitly requested the change
- [ ] Current counts verified against v3.9 baseline (61,644 total)
- [ ] Migration uses `CREATE OR REPLACE FUNCTION`
- [ ] Signature stays identical (37 parameters)
- [ ] Run `docs/BUILDER_SEARCH_TEST.sql` after changes
- [ ] No duplicate functions created
- [ ] Post-change counts verified

---

## 🔄 Manual Revert Procedure

If the quick command doesn't work:

1. Find the stable migration file
2. Copy both functions:
   - `parse_revenue_to_numeric`
   - `search_free_data_builder`
3. Create new migration with `CREATE OR REPLACE FUNCTION`
4. Verify single function exists with 37 parameters
5. Restore frontend gender conversion in `src/hooks/useFreeDataSearch.ts`

---

## 🎮 Data Playground Stable State (v3.4)

**Date**: February 8, 2026  
**Status**: Sync working, auto-link enabled

### Key Components

| Component | Status | Notes |
|-----------|--------|-------|
| Auto-link on first sync | ✅ Working | Campaigns visible immediately |
| links_initialized flag | ✅ Working | Prevents re-linking after user unlinking |
| Link All Campaigns button | ✅ Working | Recovery for 0-linked state |
| Contact sync paging | ✅ Working | Page signature guard prevents loops |
| Engagement stats derivation | ✅ Working | Uses V1 contact engagement flags |

### Edge Function Sync Order

1. `fetch-available-campaigns` (V1 API) - Gets peopleCount, auto-links
2. `sync-reply-campaigns` (V3 API) - Gets campaign status, preserves links
3. `sync-reply-contacts` (V1 API) - Background, per-campaign, page-guarded

---

## 💳 Stripe Checkout Stable State (v3.7)

**Date:** February 18, 2026  
**Status:** End-to-end checkout working; occasional post-checkout logout is a known lower-priority issue

### Architecture

```
Stripe payment complete
  → redirect to /checkout-success (unprotected)
  → invoke check-subscription edge function
  → fetchProfile() refreshes auth store
  → toast: "Payment confirmed! Welcome to Vrelly..."
  → navigate('/dashboard', { replace: true })
```

### Key Files

| File | Role |
|------|------|
| `src/pages/CheckoutSuccess.tsx` | Unprotected post-payment verification page |
| `src/components/ProtectedRoute.tsx` | Simplified to pure auth + subscription guard |
| `src/components/AuthProvider.tsx` | Guards `SIGNED_OUT`; handles `INITIAL_SESSION` |
| `src/App.tsx` | `/checkout-success` registered as unprotected route |
| `supabase/functions/create-checkout/index.ts` | `success_url` points to `/checkout-success` |

---

## 🔍 Audience Builder Stable State (v3.6 → v3.9)

**Date**: February 25, 2026  
**Status**: DNC exclusion filters, display cap, industry dedup all working. 61,644 records. Queries may time out without expression indexes (planned for v3.10).

### Key Files

| File | Role |
|------|------|
| `src/hooks/useFreeDataSearch.ts` | Search hook with exclusion params and display cap |
| `src/pages/AudienceBuilder.tsx` | Main builder page |
| `src/components/search/PreviewTable.tsx` | Results display with 100,000+ formatting |
| `src/components/search/FilterBuilder.tsx` | Filter UI with DNC sections and dedup helper |

---

## 📰 Resource CMS Stable State (v3.8)

**Date**: February 20, 2026  
**Status**: Database-backed article publishing with SEO

### Key Components

| Component | Status |
|-----------|--------|
| Resource CRUD (admin) | ✅ Working |
| Public resource pages | ✅ Working |
| SEO meta tags | ✅ Working |
| publish-resource edge function | ✅ Working |

---

## 🎨 Data Playground Copy Tab (v3.9)

**Date**: February 25, 2026  
**Status**: Saved AI copies moved from Dashboard to Copy Tab

### Key Files

| File | Role |
|------|------|
| `src/components/playground/CopyTab.tsx` | Copy tab with campaign sequences + saved copies grid |
| `src/components/playground/PlaygroundDashboard.tsx` | Dashboard simplified (no more saved copies shelf) |
