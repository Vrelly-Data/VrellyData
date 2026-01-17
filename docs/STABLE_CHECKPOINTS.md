# Stable Checkpoints

> **PURPOSE:** This document timestamps stable states of the application for easy reference and recovery.  
> **USAGE:** Reference these checkpoints when the system needs to be restored to a known-good state.
> **LAST UPDATED:** January 17, 2026 (v2.6)

---

## 🚨 REVERT INSTRUCTIONS

**To revert to stable state, tell the AI:**
> "Revert back to stable state"

The AI will:
1. Copy the `search_free_data_builder` function from the latest stable migration
2. Create a new migration to drop and recreate the function
3. NOT suggest using history panel (it doesn't work reliably)

---

## Checkpoint: v2.6 - January 17, 2026

### ✅ Status: STABLE (Current)

**Base Migration:** `20260117035653_656c0ab5-a9dc-4159-a5bf-875212e91b06.sql`

**Known Issues in v2.6 (inherited from v2.3 revert):**
- Personal Facebook Filter: Uses `facebook` field but data is in `facebookUrl` (0 results instead of 13)
- Personal Twitter Filter: Uses `twitter` field but data is in `twitterUrl` (0 results instead of 7)
- Company Facebook Filter: Uses `companyFacebook` field but data is in `companyFacebookUrl` (0 results instead of 147)
- Company Twitter Filter: Uses `companyTwitter` field but data is in `companyTwitterUrl` (0 results instead of 141)
- Company Revenue Filter: Uses `revenue`/`annualRevenue` but data is in `companyRevenue` (0 results instead of 150)
- Company LinkedIn Filter: Uses `companyLinkedin` (correct - 203 records)

**Working Filters:**
- ✅ Income (incomeRange): 84 records with data
- ✅ Net Worth (netWorth): 87 records with data  
- ✅ Company Size (companySize): 585 records with data
- ✅ Department (including C-Suite/Leadership): ~138 for C-Suite
- ✅ Seniority (including president, head of): Working
- ✅ All other filters

---

## Database Field Reference (Actual Data)

| Category | Correct Field | Wrong Field | Records |
|----------|--------------|-------------|---------|
| Personal Facebook | `facebookUrl` | `facebook` | 13 |
| Personal Twitter | `twitterUrl` | `twitter` | 7 |
| Company Facebook | `companyFacebookUrl` | `companyFacebook` | 147 |
| Company Twitter | `companyTwitterUrl` | `companyTwitter` | 141 |
| Company Revenue | `companyRevenue` | `revenue` | 150 |
| Company LinkedIn | `companyLinkedin` | - | 203 |
| Income | `incomeRange` | `income` | 84 |
| Net Worth | `netWorth` | - | 87 |
| Company Size | `companySize` | - | 585 |

---

## Database Functions (13 total, 0 duplicates)

| Function Name | Parameters | Status |
|---------------|------------|--------|
| `search_free_data_builder` | 29 | ✅ Core search - v2.6 |
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

## Verified Filter Counts (v2.6)

### Income (using `incomeRange` field - 84 records total)
| Range | Expected Count |
|-------|----------------|
| Under $50K | 21 |
| $50K-$100K | 45 |
| $100K-$200K | 15 |
| $200K+ | 3 |

### Net Worth (using `netWorth` field - 87 records total)
| Range | Expected Count |
|-------|----------------|
| Under $100K | 56 |
| $100K-$500K | 21 |
| $500K-$1M | 10 |

### Company Size (using `companySize` field - 585 records total)
| Range | Expected Count |
|-------|----------------|
| 1-10 | 13 |
| 11-50 | 96 |
| 51-200 | 81 |
| 201-500 | 78 |

### Department
| Department | Expected Count |
|------------|----------------|
| C-Suite / Leadership | ~138 |

---

## Health Check Results (v2.6)

```
✅ Function count: 1 (no duplicates)
✅ Parameter count: 29
✅ Income filter: Working (21 for Under $50K)
✅ Net Worth filter: Working (56 for Under $100K)
✅ Company Size filter: Working (13 for 1-10)
✅ Department C-Suite: Working (~138, not inflated)
⚠️ Prospect Data filters: Some use wrong field names (see Known Issues)
⚠️ RLS on free_data: Public read access (intentional for free tier)
```

---

## Recovery Instructions

### Automated Revert (Preferred)
Tell the AI: **"Revert back to stable state"**

### Manual Revert Steps
1. Find the latest stable migration file (currently `20260117035653`)
2. Copy the `search_free_data_builder` function
3. Create new migration with:
   - `DROP FUNCTION IF EXISTS public.search_free_data_builder(...)`
   - `CREATE FUNCTION public.search_free_data_builder(...)`
4. Approve migration

---

## Change Log

| Date | Version | Changes |
|------|---------|---------|
| Jan 17, 2026 | v2.6 | Reverted to v2.3 function, documented known issues |
| Jan 17, 2026 | v2.5 | BROKEN - bad regex for income/net worth/department |
| Jan 17, 2026 | v2.4 | Fixed 5 field names for prospect data |
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

**Next Step:** Fix Prospect Data field names (facebookUrl, twitterUrl, etc.) to match actual data fields.
