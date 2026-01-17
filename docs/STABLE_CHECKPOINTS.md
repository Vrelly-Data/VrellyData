# Stable Checkpoints

> **PURPOSE:** This document timestamps stable states of the application for easy reference and recovery.  
> **USAGE:** Reference these checkpoints when the system needs to be restored to a known-good state.
> **LAST UPDATED:** January 16, 2026 (v2.3)

---

## Checkpoint: v2.3 - January 16, 2026

### ✅ Status: STABLE

**Fixes Applied:**
- **Company Size Filter:** Changed field from `employeeCount` → `companySize`
- **Seniority Filter:** Added `president` and `head of` pattern matching
- **Department Filter:** Added `customer success`, `product`, `community and social services` patterns
- **Income Filter:** Now only returns records WITH income data (84 records total)
- **Net Worth Filter:** Now only returns records WITH net worth data (87 records), handles negative values

---

## Database Functions (13 total, 0 duplicates)

| Function Name | Parameters | Status |
|---------------|------------|--------|
| `search_free_data_builder` | 29 | ✅ Core search - v2.3 STABLE |
| `deduct_credits` | 2 | ✅ Stable |
| `get_all_profiles_admin` | 0 | ✅ Stable |
| `get_filter_suggestions` | 0 | ✅ Stable |
| `get_user_team_id` | 1 | ✅ Stable |
| `has_role` | 3 | ✅ Stable |
| `is_global_admin` | 1 | ✅ Stable |
| `log_audit_event` | 4 | ✅ Stable |
| `parse_employee_count_upper` | 1 | ✅ Stable |
| `reset_daily_credits_if_needed` | 1 | ✅ Stable |
| `reset_monthly_credits` | 0 | ✅ Stable |
| `title_matches_seniority` | 3 | ✅ Stable |
| `update_credits_for_testing` | 2 | ✅ Stable |

---

## Working Filters (v2.3)

| Filter | Status | Notes |
|--------|--------|-------|
| Keywords | ✅ | Searches firstName, lastName, title, company, industry |
| Prospect Data | ✅ | All boolean filters work |
| Company Revenue | ✅ | ILIKE matching |
| Job Titles | ✅ | ILIKE matching |
| Seniority | ✅ FIXED v2.3 | Added president, head of patterns |
| Department | ✅ FIXED v2.3 | Added customer success, product patterns |
| Person City | ✅ | Case-insensitive match |
| Person Country | ✅ | Case-insensitive match |
| Company City | ✅ | Case-insensitive match |
| Company Country | ✅ | Case-insensitive match |
| Technology | ✅ | ILIKE matching |
| Company Size | ✅ FIXED v2.3 | Uses `companySize` field |
| Person Interest | ✅ | ILIKE matching |
| Person Skill | ✅ | ILIKE matching |
| Gender | ✅ | Case-insensitive exact match |
| Person Income | ✅ FIXED v2.3 | Only returns records WITH data |
| Person Net Worth | ✅ FIXED v2.3 | Handles negative values |
| Industries | ✅ | Case-insensitive exact match |

---

## Verified Data Counts (v2.3)

### Company Size (using `companySize` field)
| Range | Count |
|-------|-------|
| 1-10 | 13 |
| 11-50 | 96 |
| 51-200 | 81 |
| 201-500 | 78 |

### Income (84 records total with data)
| Range | Count |
|-------|-------|
| Under $50K | 21 |
| $50K-$100K | 45 |
| $100K-$200K | 15 |
| $200K+ | 3 |

### Net Worth (87 records total with data)
| Range | Count |
|-------|-------|
| Under $100K | 56 |
| $100K-$500K | 21 |
| $500K-$1M | 10 |

---

## Health Check Results

```
✅ No duplicate functions
✅ search_free_data_builder has 29 parameters
✅ All helper functions present
⚠️ RLS on free_data: Public read access (intentional for free tier)
```

---

## Recovery Instructions

1. Run `docs/QUICK_CHECK.sql` to verify current state
2. Compare against this checkpoint
3. If recovery needed, restore from Git history

---

## Change Log

| Date | Version | Changes |
|------|---------|---------|
| Jan 16, 2026 | v2.3 | Fixed Company Size (companySize), Seniority (president/head of), Department (customer success/product), Income (data-only), Net Worth (negative values) |
| Jan 16, 2026 | v2.2 | Fixed Seniority, Department, Income, Net Worth filter logic |
| Jan 16, 2026 | v2.1 | Added p_has_email parameter |
| Jan 15, 2026 | v2.0 | Initial stable release |

---

**Next Checkpoint:** Create when adding new major features or database changes.
