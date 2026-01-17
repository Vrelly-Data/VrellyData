# 🔒 Search Function Lock Document

**Purpose**: Protect the `search_free_data_builder` function from unintended modifications.  
**Version**: 3.2  
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

> **"Revert to v3.2 stable state"**

---

## ✅ 18 Verified Working Filters

All of these filters have been tested and confirmed working as of v3.2:

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

---

## 📁 Stable Migration Reference

**File**: `supabase/migrations/20260117175524_38595ba8-3317-4946-8c7a-25ee0c6d6037.sql`

This migration contains:
1. `parse_revenue_to_numeric()` - Helper for revenue parsing
2. `search_free_data_builder()` - Main search function (29 parameters)

---

## 🎨 Frontend Normalization (v3.1.1)

**File**: `src/hooks/useFreeDataSuggestions.ts`

Industry suggestions are normalized to Title Case and deduplicated in the frontend:
- "retail" → "Retail"
- "HEALTHCARE" → "Healthcare"
- Duplicates removed via Set

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

1. Tell the user to say: "Revert to v3.2 stable state"
2. Copy functions from the stable migration file
3. Create new migration with CREATE OR REPLACE
4. Verify counts match baseline

---

## 📊 Baseline Counts for Verification

Quick checks to verify function is working:

```sql
-- Should return 86
SELECT total_count FROM public.search_free_data_builder(
  p_entity_type := 'person',
  p_company_size_ranges := ARRAY['5001-10000']
) LIMIT 1;

-- Should return 8
SELECT total_count FROM public.search_free_data_builder(
  p_entity_type := 'person',
  p_company_size_ranges := ARRAY['10000+']
) LIMIT 1;

-- Should return 400 (all person records)
SELECT total_count FROM public.search_free_data_builder(
  p_entity_type := 'person'
) LIMIT 1;

-- Should return 99
SELECT total_count FROM public.search_free_data_builder(
  p_entity_type := 'person',
  p_seniority_levels := ARRAY['Individual Contributor']
) LIMIT 1;

-- Should return 55
SELECT total_count FROM public.search_free_data_builder(
  p_entity_type := 'person',
  p_income := ARRAY['Under $50K']
) LIMIT 1;
```

---

## 🔧 What the AI Should Do on Revert

When user says "Revert to v3.2 stable state":

1. Read migration file: `20260117175524_38595ba8-3317-4946-8c7a-25ee0c6d6037.sql`
2. Extract `parse_revenue_to_numeric` function
3. Extract `search_free_data_builder` function
4. Create new migration with both functions using `CREATE OR REPLACE`
5. Add assertion block to verify single function with 29 parameters
6. Run verification queries to confirm baseline counts
7. Verify frontend normalization in `useFreeDataSuggestions.ts`

---

## 📝 Related Documentation

- `docs/STABLE_CHECKPOINTS.md` - Version history and baseline counts
- `docs/FILTER_CONTRACT.md` - Field mappings and parameter reference
- `docs/BUILDER_SEARCH_TEST.sql` - Automated test suite
- `docs/FILTER_DATA_MAPPING.md` - UI to database field mapping
- `docs/V3.2_RELEASE_NOTES.md` - Full release notes

---

## ⚡ Quick Reference

| What | Value |
|------|-------|
| Current Version | v3.2 |
| Total Records | 724 (400 person, 324 company) |
| Parameter Count | 29 |
| Revert Command | "Revert to v3.2 stable state" |
| Test File | `docs/BUILDER_SEARCH_TEST.sql` |
| Frontend Fix | `src/hooks/useFreeDataSuggestions.ts` (industry normalization) |
