# Stable Checkpoints

**Purpose**: Document stable states for easy recovery. Say "Revert to v3.3 stable state" to restore.  
**Last Updated**: January 21, 2026  
**Current Stable Version**: v3.3

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

> **"Revert to v3.3 stable state"**

The AI will:
1. Copy functions from the stable migration
2. Create a new migration with `CREATE OR REPLACE FUNCTION`
3. Verify no duplicate functions exist
4. Verify baseline counts match v3.3 expectations
5. Restore frontend gender conversion in `useFreeDataSearch.ts`

---

## ✅ Current Stable: v3.3

**Date**: January 21, 2026  
**Status**: All 18 filters verified working

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

## 📊 Verified Baseline Counts (v3.3)

Use these for regression testing. If counts change unexpectedly, something is broken.

### Data Source Summary
| Source | Entity Type | Count |
|--------|-------------|-------|
| **Total Records** | All | **724** |
| Person Records | person | 400 |
| Company Records | company | 324 |

### Company Filters
| Filter | Value | Expected Count |
|--------|-------|----------------|
| Company Size | 1-10 | 15 |
| Company Size | 11-50 | 96 |
| Company Size | 51-200 | 81 |
| Company Size | 201-500 | 78 |
| Company Size | 5001-10000 | 86 |
| Company Size | 10000+ | 8 |
| Company Revenue | Under $1M | 3 |
| Company Revenue | $1M - $10M | 42 |
| Company Revenue | $10M - $50M | 56 |

### Person Demographics
| Filter | Value | Expected Count |
|--------|-------|----------------|
| Income | Under $50K | 55 |
| Income | $50K - $100K | 45 |
| Net Worth | Under $100K | 56 |
| Gender | Male (M) | 137 |
| Gender | Female (F) | 55 |

### Professional Filters
| Filter | Value | Expected Count |
|--------|-------|----------------|
| Department | C-Suite / Leadership | 138 |
| Seniority | Individual Contributor | 99 |

### Prospect Data
| Filter | Value | Expected Count |
|--------|-------|----------------|
| Personal Facebook | true | 13 |
| Personal Twitter | true | 7 |
| Company Facebook | true | 147 |
| Company Twitter | true | 141 |
| Company LinkedIn | true | 203 |

---

## 🎨 Gender Filter Note (v3.3)

The Gender filter stores values as `M` or `F` in the database. The frontend (`src/hooks/useFreeDataSearch.ts`) includes a `convertGender` function that translates:
- `male` → `M`
- `female` → `F`

This ensures the UI uses human-readable labels while the database uses short codes.

---

## 🔧 Database Functions (v3.3)

| Function | Parameters | Status |
|----------|------------|--------|
| `search_free_data_builder` | 29 | ✅ Single version |
| `parse_employee_count_upper` | 1 | ✅ Helper |
| `parse_revenue_to_numeric` | 1 | ✅ Helper (added v2.10) |
| `title_matches_seniority` | 3 | ✅ Helper (2 versions) |
| `get_filter_suggestions` | 0 | ✅ Suggestion provider |

---

## 📝 Change Log

| Version | Date | Changes |
|---------|------|---------|
| v3.3 | 2026-01-21 | Updated baseline counts, documented Gender M/F format, verified 137 Male / 55 Female |
| v3.2 | 2026-01-17 | Established stable state with 724 records, 18 filters, updated baselines |
| v3.1.1 | 2026-01-17 | Frontend industry suggestion normalization (Title Case + dedup) |
| v3.1 | 2026-01-17 | Added Company Size 5001-10000, 10000+ and Individual Contributor |
| v3.0 | 2026-01-17 | Documented all 17 working filters, established revert mechanism |
| v2.10 | 2026-01-17 | Fixed Company Revenue filter with parse_revenue_to_numeric |
| v2.7 | 2026-01-17 | Fixed Facebook/Twitter Url variants |
| v2.6 | 2026-01-17 | Fixed income label format |
| v2.5 | 2026-01-17 | Fixed company size parsing |

---

## 🛡️ Pre-Change Checklist

Before modifying any filter logic:

- [ ] User explicitly requested the change
- [ ] Current counts verified against baseline
- [ ] Migration uses `CREATE OR REPLACE FUNCTION`
- [ ] Signature stays identical (29 parameters)
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
4. Verify single function exists with 29 parameters
5. Restore frontend gender conversion in `src/hooks/useFreeDataSearch.ts`
