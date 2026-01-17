# Stable Checkpoints

> **PURPOSE:** This document timestamps stable states of the application for easy reference and recovery.  
> **USAGE:** Reference these checkpoints when the system needs to be restored to a known-good state.
> **LAST UPDATED:** January 17, 2026 (v2.4)

---

## Checkpoint: v2.4 - January 17, 2026

### ✅ Status: STABLE

**Fixes Applied:**
- **Personal Facebook Filter:** Changed field from `facebook` → `facebookUrl` (13 records)
- **Personal Twitter Filter:** Changed field from `twitter` → `twitterUrl` (7 records)
- **Company Facebook Filter:** Changed field from `companyFacebook` → `companyFacebookUrl` (147 records)
- **Company Twitter Filter:** Changed field from `companyTwitter` → `companyTwitterUrl` (141 records)
- **Company Revenue Filter:** Changed field from `revenue`/`annualRevenue` → `companyRevenue` (150 records)

**Previous fixes preserved from v2.3:**
- Company Size: Uses `companySize` field
- Seniority: Includes president, head of patterns
- Department: Includes executive, customer success, product patterns
- Income: Only returns records WITH income data
- Net Worth: Handles negative values

---

## Database Functions (13 total, 0 duplicates)

| Function Name | Parameters | Status |
|---------------|------------|--------|
| `search_free_data_builder` | 29 | ✅ Core search - v2.4 STABLE |
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

## Working Filters (v2.4 - ALL FILTERS NOW WORKING)

| Filter | Status | Notes |
|--------|--------|-------|
| Keywords | ✅ | Searches firstName, lastName, title, company, industry |
| Prospect Data | ✅ | All boolean filters work |
| Company Revenue | ✅ FIXED v2.4 | Uses `companyRevenue` field (150 records) |
| Job Titles | ✅ | ILIKE matching |
| Seniority | ✅ | President, head of patterns included |
| Department | ✅ | Executive, customer success, product patterns |
| Person City | ✅ | Case-insensitive match |
| Person Country | ✅ | Case-insensitive match |
| Company City | ✅ | Case-insensitive match |
| Company Country | ✅ | Case-insensitive match |
| Technology | ✅ | ILIKE matching |
| Company Size | ✅ | Uses `companySize` field |
| Person Interest | ✅ | ILIKE matching |
| Person Skill | ✅ | ILIKE matching |
| Gender | ✅ | Case-insensitive exact match |
| Person Income | ✅ | Only returns records WITH data |
| Person Net Worth | ✅ | Handles negative values |
| Personal Facebook | ✅ FIXED v2.4 | Uses `facebookUrl` field (13 records) |
| Personal Twitter | ✅ FIXED v2.4 | Uses `twitterUrl` field (7 records) |
| Company Facebook | ✅ FIXED v2.4 | Uses `companyFacebookUrl` field (147 records) |
| Company Twitter | ✅ FIXED v2.4 | Uses `companyTwitterUrl` field (141 records) |
| Has LinkedIn | ✅ | Uses `linkedInUrl` |
| Has Email | ✅ | Checks email, businessEmail, personalEmail |
| Has Phone | ✅ | Uses `phone` |
| Personal Email | ✅ | Uses `personalEmail` |
| Business Email | ✅ | Uses `businessEmail` |
| Company LinkedIn | ✅ | Uses `companyLinkedInUrl` |
| Company Phone | ✅ | Uses `companyPhone` |

---

## Verified Data Counts (v2.4)

### Prospect Data Fields
| Field | Records |
|-------|---------|
| facebookUrl | 13 |
| twitterUrl | 7 |
| companyFacebookUrl | 147 |
| companyTwitterUrl | 141 |
| companyRevenue | 150 |

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
✅ Function count: 1 (no duplicates)
✅ Parameter count: 29
✅ All 5 fixed fields now return data
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
| Jan 17, 2026 | v2.4 | Fixed 5 field names: facebookUrl, twitterUrl, companyFacebookUrl, companyTwitterUrl, companyRevenue |
| Jan 16, 2026 | v2.3 | Fixed Company Size, Seniority, Department, Income, Net Worth |
| Jan 16, 2026 | v2.2 | Fixed Seniority, Department, Income, Net Worth filter logic |
| Jan 16, 2026 | v2.1 | Added p_has_email parameter |
| Jan 15, 2026 | v2.0 | Initial stable release |

---

## Guardrails to Prevent Duplicate Functions

### Before ANY function modification:
1. Query `pg_proc` to get EXACT function identity: `pg_get_function_identity_arguments(oid)`
2. Use `DROP FUNCTION IF EXISTS` with the EXACT parameter signature
3. Use `CREATE FUNCTION` (not `CREATE OR REPLACE`) after dropping
4. Verify with: `SELECT COUNT(*) FROM pg_proc WHERE proname = 'function_name'`

### Why duplicates happen:
- PostgreSQL allows function overloading (same name, different signatures)
- `CREATE OR REPLACE` fails if return type differs
- Parameter ORDER matters for function identity

---

**Next Checkpoint:** Create when adding new major features or database changes.
