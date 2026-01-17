# Stable Checkpoints

**Purpose**: Document stable states for easy recovery. Say "Revert to v3.0 stable state" to restore.  
**Last Updated**: January 17, 2026

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

> **"Revert to v3.0 stable state"**

The AI will:
1. Copy functions from migration `20260117133021_ab3eead1-e309-4d56-b71d-56f8a549f3e8.sql`
2. Create a new migration with `CREATE OR REPLACE FUNCTION`
3. Verify no duplicate functions exist
4. Verify baseline counts match v3.0 expectations

---

## ✅ Current Stable: v3.0

**Date**: January 17, 2026  
**Migration File**: `supabase/migrations/20260117133021_ab3eead1-e309-4d56-b71d-56f8a549f3e8.sql`  
**Status**: All 17 filters verified working

### Confirmed Working Filters (17 total)

| # | Filter | Status | Notes |
|---|--------|--------|-------|
| 1 | Keyword Logic | ✅ Working | Searches across multiple fields |
| 2 | Prospect Data | ✅ Working | All has_* boolean filters |
| 3 | Company Revenue | ✅ Working | Fixed in v2.10 with parse_revenue_to_numeric |
| 4 | Job Titles | ✅ Working | ILIKE pattern matching |
| 5 | Seniority | ✅ Working | Regex-based title matching |
| 6 | Department | ✅ Working | Regex-based matching |
| 7 | Person City | ✅ Working | COALESCE fallback to personCity/companyCity |
| 8 | Person Country | ✅ Working | COALESCE fallback to personCountry/companyCountry |
| 9 | Company City | ✅ Working | Same as Person City |
| 10 | Company Country | ✅ Working | Same as Person Country |
| 11 | Technology | ✅ Working | Array contains matching |
| 12 | Company Size | ✅ Working | Parsed with parse_employee_count_upper |
| 13 | Person Interest | ✅ Working | Array/string matching |
| 14 | Person Skill | ✅ Working | Array/string matching |
| 15 | Gender | ✅ Working | Case-insensitive exact match |
| 16 | Person Income | ✅ Working | Numeric range parsing |
| 17 | Person Net Worth | ✅ Working | Numeric range parsing (supports negatives) |

---

## 📊 Verified Baseline Counts (v3.0)

Use these for regression testing. If counts change unexpectedly, something is broken.

### Company Filters
| Filter | Value | Expected Count |
|--------|-------|----------------|
| Company Size | 1-10 | 13 |
| Company Size | 11-50 | 96 |
| Company Size | 51-200 | 81 |
| Company Size | 201-500 | 78 |
| Company Revenue | Under $1M | 3 |
| Company Revenue | $1M - $10M | 42 |
| Company Revenue | $10M - $50M | 56 |

### Person Demographics
| Filter | Value | Expected Count |
|--------|-------|----------------|
| Income | Under $50K | 21 |
| Income | $50K - $100K | 45 |
| Net Worth | Under $100K | 56 |
| Gender | Male | 74 |
| Gender | Female | 18 |

### Professional Filters
| Filter | Value | Expected Count |
|--------|-------|----------------|
| Department | C-Suite / Leadership | 138 |

### Prospect Data
| Filter | Value | Expected Count |
|--------|-------|----------------|
| Personal Facebook | true | 13 |
| Personal Twitter | true | 7 |
| Company Facebook | true | 147 |
| Company Twitter | true | 141 |
| Company LinkedIn | true | 203 |

---

## 🔧 Database Functions (v3.0)

| Function | Parameters | Status |
|----------|------------|--------|
| `search_free_data_builder` | 29 | ✅ Single version |
| `parse_employee_count_upper` | 1 | ✅ Helper |
| `parse_revenue_to_numeric` | 1 | ✅ Helper (added v2.10) |
| `title_matches_seniority` | 3 | ✅ Helper |

---

## 📝 Change Log

| Version | Date | Changes |
|---------|------|---------|
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

1. Find: `supabase/migrations/20260117133021_ab3eead1-e309-4d56-b71d-56f8a549f3e8.sql`
2. Copy both functions:
   - `parse_revenue_to_numeric`
   - `search_free_data_builder`
3. Create new migration with `CREATE OR REPLACE FUNCTION`
4. Verify single function exists with 29 parameters
