# 🔒 Search Function Lock Document

**Purpose**: Protect the `search_free_data_builder` function from unintended modifications.  
**Version**: 3.0  
**Last Updated**: January 17, 2026

---

## 🚨 STOP! READ THIS FIRST

The `search_free_data_builder` function is **LOCKED AND VERIFIED WORKING**.

**DO NOT MODIFY** unless the user explicitly says one of:
- "Modify the search function"
- "Change filter logic"
- "Update the builder search"
- "Add a new filter to the builder"

If you're unsure, **ASK THE USER FIRST**.

---

## ⏪ Quick Revert Command

If anything breaks, the user can say:

> **"Revert to v3.0 stable state"**

---

## ✅ 17 Verified Working Filters

All of these filters have been tested and confirmed working as of v3.0:

| # | Filter | Status |
|---|--------|--------|
| 1 | Keyword Logic | ✅ |
| 2 | Prospect Data (all has_* filters) | ✅ |
| 3 | Company Revenue | ✅ |
| 4 | Job Titles | ✅ |
| 5 | Seniority | ✅ |
| 6 | Department | ✅ |
| 7 | Person City | ✅ |
| 8 | Person Country | ✅ |
| 9 | Company City | ✅ |
| 10 | Company Country | ✅ |
| 11 | Technology | ✅ |
| 12 | Company Size | ✅ |
| 13 | Person Interest | ✅ |
| 14 | Person Skill | ✅ |
| 15 | Gender | ✅ |
| 16 | Person Income | ✅ |
| 17 | Person Net Worth | ✅ |

---

## 📁 Stable Migration Reference

**File**: `supabase/migrations/20260117133021_ab3eead1-e309-4d56-b71d-56f8a549f3e8.sql`

This migration contains:
1. `parse_revenue_to_numeric()` - Helper for revenue parsing
2. `search_free_data_builder()` - Main search function (29 parameters)

---

## 🛡️ Guardrails

### Before ANY Change to search_free_data_builder:

1. ⚠️ **User must explicitly request the change**
2. ⚠️ **Verify current baseline counts first**
3. ⚠️ **Use CREATE OR REPLACE FUNCTION**
4. ⚠️ **Never change the 29-parameter signature**
5. ⚠️ **Run BUILDER_SEARCH_TEST.sql after changes**
6. ⚠️ **Verify no duplicate functions created**

### If You Break Something:

1. Tell the user to say: "Revert to v3.0 stable state"
2. Copy functions from the stable migration file
3. Create new migration with CREATE OR REPLACE
4. Verify counts match baseline

---

## 📊 Baseline Counts for Verification

Quick checks to verify function is working:

```sql
-- Should return ~13
SELECT total_count FROM public.search_free_data_builder(
  p_entity_type := 'person',
  p_company_size_ranges := ARRAY['1-10']
) LIMIT 1;

-- Should return ~42
SELECT total_count FROM public.search_free_data_builder(
  p_entity_type := 'person',
  p_company_revenue := ARRAY['$1M - $10M']
) LIMIT 1;

-- Should return ~74
SELECT total_count FROM public.search_free_data_builder(
  p_entity_type := 'person',
  p_gender := ARRAY['male']
) LIMIT 1;
```

---

## 🔧 What the AI Should Do on Revert

When user says "Revert to v3.0 stable state":

1. Read migration file: `20260117133021_ab3eead1-e309-4d56-b71d-56f8a549f3e8.sql`
2. Extract `parse_revenue_to_numeric` function
3. Extract `search_free_data_builder` function
4. Create new migration with both functions using `CREATE OR REPLACE`
5. Add assertion block to verify single function with 29 parameters
6. Run verification queries to confirm baseline counts

---

## 📝 Related Documentation

- `docs/STABLE_CHECKPOINTS.md` - Version history and baseline counts
- `docs/FILTER_CONTRACT.md` - Field mappings and parameter reference
- `docs/BUILDER_SEARCH_TEST.sql` - Automated test suite
- `docs/FILTER_DATA_MAPPING.md` - UI to database field mapping

---

## ⚡ Quick Reference

| What | Value |
|------|-------|
| Current Version | v3.0 |
| Stable Migration | `20260117133021_ab3eead1-e309-4d56-b71d-56f8a549f3e8.sql` |
| Parameter Count | 29 |
| Revert Command | "Revert to v3.0 stable state" |
| Test File | `docs/BUILDER_SEARCH_TEST.sql` |
