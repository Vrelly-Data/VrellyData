

# DNC (Do Not Include) Filters for the Audience Builder

## Revert Safety

**Your revert command: "Revert to v3.5 stable state"**

All changes below are purely additive. No existing parameters, logic, or filter behavior will be modified.

## Overview

Add an expandable "Do Not Include" (DNC) section beneath each tag-input filter in the Builder. Users click a small arrow/chevron to reveal a second input that accepts exclusion terms. These exclusion terms get passed as new, separate parameters to the database function.

## Approach: Additive Only

The strategy is straightforward:

1. **FilterBuilderState** gets new `exclude_*` fields (all default to empty arrays -- existing fields untouched)
2. **FilterBuilder UI** gets a collapsible DNC section under each tag-input filter
3. **useFreeDataSearch** passes the new exclude fields as new parameters (existing parameter mapping untouched)
4. **search_free_data_builder** DB function gets new exclusion parameters added to the end of its signature (existing 29 parameters untouched, new ones appended with defaults of NULL)

Because every new parameter defaults to NULL, **passing nothing changes nothing** -- all existing queries return identical results.

## Tag-Input Fields That Get DNC

These are the fields using TagInput (free-text entry):

- Keywords
- Job Titles
- Person City
- Person Country
- Person Interest
- Person Skill
- Industry
- Technologies
- Company City
- Company Country

MultiSelectDropdown fields (Seniority, Department, Company Size, etc.) do NOT get DNC since they use predefined options where exclusion is less meaningful.

## Step-by-Step Changes

### Step 1: Update `FilterBuilderState` type

**File**: `src/lib/filterConversion.ts`

Add new optional exclusion fields (appended, nothing removed):

```
excludeKeywords: string[];
excludeJobTitles: string[];
excludePersonCity: string[];
excludePersonCountry: string[];
excludePersonInterests: string[];
excludePersonSkills: string[];
excludeIndustries: string[];
excludeTechnologies: string[];
excludeCompanyCity: string[];
excludeCompanyCountry: string[];
```

### Step 2: Update FilterBuilder UI

**File**: `src/components/search/FilterBuilder.tsx`

For each tag-input filter, add a collapsible "Do Not Include" section below it:

```text
[Keywords]
[tag1] [tag2] [input field...]
  v Do Not Include
    [exclude-tag1] [exclude-tag2] [input field...]
```

The chevron (v) toggles visibility using the existing Collapsible component from Radix UI (already installed). Each DNC section is independent -- users can expand only the ones they need.

### Step 3: Update `useFreeDataSearch.ts`

**File**: `src/hooks/useFreeDataSearch.ts`

Map the new exclude fields to new DB parameters, using the same `arrayOrNull` helper. Appended to the existing `searchParams` object -- no existing lines changed.

### Step 4: Update database function

**Migration**: New migration file

Use `CREATE OR REPLACE FUNCTION` to add new exclusion parameters to the END of the signature:

```
p_exclude_keywords text[] DEFAULT NULL,
p_exclude_job_titles text[] DEFAULT NULL,
p_exclude_industries text[] DEFAULT NULL,
p_exclude_cities text[] DEFAULT NULL,
p_exclude_countries text[] DEFAULT NULL,
p_exclude_technologies text[] DEFAULT NULL,
p_exclude_person_skills text[] DEFAULT NULL,
p_exclude_person_interests text[] DEFAULT NULL
```

Each exclusion adds a simple `AND NOT` clause:

```sql
AND (p_exclude_keywords IS NULL OR NOT (
  -- same keyword search fields, but negated
))
```

All existing logic stays identical. The guarded pattern (drop + recreate + assert) will be used per the project convention.

### Step 5: Update initial state and clear logic

**File**: `src/components/search/FilterBuilder.tsx`

- `getInitialFilterState()` includes all `exclude*` fields as empty arrays
- `hasActiveFilters()` checks exclude fields too
- `handleClearFilters` resets them

### Step 6: Update filter presets

**File**: `src/hooks/useFilterPresets.ts` (if applicable)

Ensure saved/loaded presets gracefully handle the new fields (default to empty arrays if missing from stored data).

## What Does NOT Change

- The existing 29 parameters keep their positions and defaults
- All 18 verified filters continue returning identical results
- No existing UI components are modified (only new sub-sections added)
- `filterMockPeople` and `filterMockCompanies` in filterConversion.ts are untouched
- Gender, Prospect Data, Seniority, Department, Company Size, Company Revenue, Net Worth, Income filters are unchanged
- Baseline counts (724 records, 400 person, 324 company) remain identical

## Verification After Implementation

1. Run all baseline queries from `docs/BUILDER_SEARCH_TEST.sql`
2. Confirm counts match v3.3 baselines
3. Test a DNC filter returns fewer results than the same include filter
4. Confirm empty DNC fields produce identical results to current behavior

## New Parameter Count

29 existing + 8 exclusion = **37 parameters**

Documentation will be updated to reflect this, but the revert command still restores the 29-parameter v3.5 state.

