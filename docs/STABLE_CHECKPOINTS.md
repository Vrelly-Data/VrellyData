# Stable Checkpoints

> **PURPOSE:** This document timestamps stable states of the application for easy reference and recovery.  
> **USAGE:** Reference these checkpoints when the system needs to be restored to a known-good state.
> **LAST UPDATED:** January 17, 2026 (v2.7)

---

## 🚨 REVERT INSTRUCTIONS

**To revert to stable state, tell the AI:**
> "Revert back to stable state"

The AI will:
1. Copy the `search_free_data_builder` function from the latest stable migration
2. Create a new migration using `CREATE OR REPLACE FUNCTION` (to avoid duplicates)
3. Verify counts match the documented baseline values
4. NOT suggest using history panel (it doesn't work reliably)

---

## Checkpoint: v2.7 - January 17, 2026

### ✅ Status: STABLE (Current)

**Base Migration:** `20260117040902_352e325d-b578-4cbb-9441-b5b1e246f293.sql`  
**Fallback Migration:** `20260117035653_656c0ab5-a9dc-4159-a5bf-875212e91b06.sql` (v2.6)

**All Filters Now Working:**
- ✅ Income (incomeRange): Working
- ✅ Net Worth (netWorth): Working
- ✅ Company Size (companySize): Working
- ✅ Department (including C-Suite/Leadership): Working
- ✅ Seniority: Working
- ✅ Personal Facebook (facebookUrl): **Fixed in v2.7** - 13 records
- ✅ Personal Twitter (twitterUrl): **Fixed in v2.7** - 7 records
- ✅ Company Facebook (companyFacebookUrl): **Fixed in v2.7** - 147 records
- ✅ Company Twitter (companyTwitterUrl): **Fixed in v2.7** - 141 records
- ✅ All other filters

---

## Database Field Reference (Authoritative)

| Category | Correct Field(s) | Records |
|----------|-----------------|---------|
| Income | `incomeRange` | 84+ |
| Net Worth | `netWorth` | 87+ |
| Company Size | `companySize` | 500+ |
| Personal Facebook | `facebook`, `facebookUrl` | 13 |
| Personal Twitter | `twitter`, `twitterUrl` | 7 |
| Company Facebook | `companyFacebook`, `companyFacebookUrl` | 147 |
| Company Twitter | `companyTwitter`, `companyTwitterUrl` | 141 |
| Company LinkedIn | `companyLinkedin` | 203 |

---

## Database Functions (15 total)

| Function Name | Parameters | Status |
|---------------|------------|--------|
| `search_free_data_builder` | 29 | ✅ Core search - v2.7 |
| `deduct_credits` | 2 | ✅ Stable |
| `get_all_profiles_admin` | 0 | ✅ Stable |
| `get_filter_suggestions` | 0 | ✅ Stable |
| `get_user_team_id` | 1 | ✅ Stable |
| `handle_new_user` | 0 | ✅ Stable (trigger) |
| `handle_new_user_team` | 0 | ✅ Stable (trigger) |
| `has_role` | 3 | ✅ Stable |
| `is_global_admin` | 1 | ✅ Stable |
| `log_audit_event` | 4 | ✅ Stable |
| `parse_employee_count_upper` | 1 | ✅ Stable |
| `reset_daily_credits_if_needed` | 1 | ✅ Stable |
| `reset_monthly_credits` | 0 | ✅ Stable |
| `title_matches_seniority` | 3 | ⚠️ 2 duplicates (harmless) |
| `update_credits_for_testing` | 2 | ✅ Stable |
| `update_updated_at_column` | 0 | ✅ Stable (trigger) |

> **Note:** `title_matches_seniority` has 2 function versions due to overloading. Both have identical logic - one with optional parameter, one without. This is harmless and expected.

---

## Verified Filter Counts (v2.7 Baseline)

### Income (using `incomeRange` field)
| Range | Expected Count |
|-------|----------------|
| Under $50K | 21 |
| $50K-$100K | 45 |

### Net Worth (using `netWorth` field)
| Range | Expected Count |
|-------|----------------|
| Under $100K | 56 |

### Company Size (using `companySize` field)
| Range | Expected Count |
|-------|----------------|
| 1-10 | 13 |
| 11-50 | 96 |
| 51-200 | 81 |
| 201-500 | 78 |

### Department
| Department | Expected Count |
|------------|----------------|
| C-Suite / Leadership | 138 |

### Prospect Data (Fixed in v2.7)
| Filter | Expected Count |
|--------|----------------|
| Personal Facebook | 13 |
| Personal Twitter | 7 |
| Company Facebook | 147 |
| Company Twitter | 141 |
| Company LinkedIn | 203 |

---

## Health Check Results (v2.7)

```
✅ Function count: 15 (1 has 2 overloads - harmless)
✅ search_free_data_builder: 1 version, 29 parameters
✅ Income filter: Working (21 for Under $50K)
✅ Net Worth filter: Working (56 for Under $100K)
✅ Company Size filter: Working (13 for 1-10, 96 for 11-50, 81 for 51-200, 78 for 201-500)
✅ Department C-Suite: Working (138)
✅ Personal Facebook: Working (13)
✅ Personal Twitter: Working (7)
✅ Company Facebook: Working (147)
✅ Company Twitter: Working (141)
⚠️ RLS on free_data: Public read access (intentional for free tier)
```

---

## Recovery Instructions

### Automated Revert (Preferred)
Tell the AI: **"Revert back to stable state"**

### Manual Revert Steps
1. Find the stable migration file (`20260117040902_352e325d-b578-4cbb-9441-b5b1e246f293.sql`)
2. Copy the `search_free_data_builder` function
3. Create new migration with:
   - `CREATE OR REPLACE FUNCTION public.search_free_data_builder(...)`
4. Approve migration

---

## Change Log

| Date | Version | Changes |
|------|---------|---------|
| Jan 17, 2026 | **v2.7** | **Fixed Prospect Data field names** - added facebookUrl, twitterUrl variants; Updated Company Size counts (13, 96, 81, 78) |
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
1. **ALWAYS use `CREATE OR REPLACE FUNCTION`** - not `DROP` + `CREATE`
2. Keep the EXACT same parameter signature (29 parameters)
3. Keep the EXACT same return type
4. Verify after: `SELECT COUNT(*) FROM pg_proc WHERE proname = 'search_free_data_builder'`

### Why duplicates happen:
- PostgreSQL allows function overloading (same name, different signatures)
- Changing parameter types/count creates a NEW function
- Both functions then exist, causing ambiguous calls

---

## Quick Health Check SQL

```sql
-- Verify no duplicates
SELECT proname, COUNT(*) FROM pg_proc 
WHERE pronamespace = 'public'::regnamespace 
  AND proname = 'search_free_data_builder'
GROUP BY proname;
-- Expected: 1 row with count = 1

-- Verify baseline counts
SELECT 'Income Under $50K', COUNT(*) FROM free_data 
WHERE COALESCE(NULLIF(REGEXP_REPLACE(entity_data->>'incomeRange', '[^0-9]', '', 'g'), '')::int, 0) < 50
  AND entity_data->>'incomeRange' IS NOT NULL;
-- Expected: 21

SELECT 'Personal Facebook', COUNT(*) FROM free_data 
WHERE entity_data->>'facebookUrl' IS NOT NULL;
-- Expected: 13

SELECT 'Company Size 1-10', COUNT(*) FROM free_data 
WHERE entity_type = 'person'
  AND COALESCE(public.parse_employee_count_upper(entity_data->>'companySize'), 0) BETWEEN 1 AND 10;
-- Expected: 13
```
