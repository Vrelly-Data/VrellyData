

# Stable State Documentation Update — v3.9

## Why This Is Needed

The current documentation (STABLE_CHECKPOINTS.md, SEARCH_FUNCTION_LOCK.md) references **724 total records** (400 person, 324 company). The actual database now contains **61,644 records** (52,119 person, 9,525 company) after two large CSV uploads. The baseline counts used for regression testing are completely stale.

Additionally, several features have been added since v3.7 (the last documented checkpoint) that aren't captured: the Resource CMS (v3.8), AI Copy generation, Sales Knowledge Base, and the Copy Tab reorganization just completed.

## What Gets Updated

### 1. `docs/STABLE_CHECKPOINTS.md`

- Update "Current Stable Version" from v3.6 to **v3.9**
- Update the **Data Source Summary** table: 724 total to **61,644** (52,119 person + 9,525 company)
- Remove the old baseline counts (they were for 724 records and are no longer valid)
- Add **new baseline counts** queried from the live database at the current scale
- Add **v3.8 changelog entry**: Resource CMS, AI Copy/Audience generation with Sales KB context
- Add **v3.9 changelog entry**: Copy Tab reorganization (saved copies moved from Dashboard to Copy Tab), stable state documentation refresh, 61,644 total records confirmed
- Update the database functions table to reflect current state (still 37 params, single function)
- Update the Pre-Change Checklist baseline reference

### 2. `docs/SEARCH_FUNCTION_LOCK.md`

- Update version from 3.6 to **3.9**
- Update "Total Records" from 724 to **61,644**
- Update the baseline verification SQL queries with **new expected counts** from the current dataset
- Update the Quick Reference table
- Keep the revert command pointing to the same stable migration file (the function itself hasn't changed)

### 3. New baseline counts to document

These will be queried from the live database before writing, capturing the actual current counts for:
- Total person records (unfiltered)
- Total company records (unfiltered)  
- A selection of filter combinations (company size, gender, seniority, income) so future regressions can be detected

### 4. What does NOT change

- The `search_free_data_builder` function itself (still 37 params, still locked)
- The frontend search hook (`useFreeDataSearch.ts`)
- The filter builder UI
- The stable migration reference file
- Any filter logic or behavior

## Revert Safety

After this update, you can say **"Revert to v3.9 stable state"** to restore to this exact documented state. The existing v3.6 revert command for the search function itself remains valid since the function hasn't changed.

## Technical Details

### Files Modified

| File | Change |
|---|---|
| `docs/STABLE_CHECKPOINTS.md` | Update record counts, add v3.8 + v3.9 entries, refresh baseline counts |
| `docs/SEARCH_FUNCTION_LOCK.md` | Update version, record counts, and baseline verification queries |

### Current Database State (verified)

| Metric | Value |
|---|---|
| Total records | 61,644 |
| Person records | 52,119 |
| Company records | 9,525 |
| search_free_data_builder params | 37 (single function) |
| get_filter_suggestions params | 0 (single function) |
| Existing indexes on free_data | 7 (pkey, entity_type, external_id, GIN jsonb, type+created, source_template, unique constraint) |
| No expression indexes on JSONB fields | Confirmed (this is why queries time out) |

