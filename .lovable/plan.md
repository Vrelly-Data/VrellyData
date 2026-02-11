

# Cap Displayed Total at 100,000+

## What Changes

When a search returns more than 100,000 results, instead of showing the exact number, the UI will display **"100,000+"** everywhere the total count appears. This applies to:

- The toast notification after search ("Found 100,000+ people")
- The "Found X people/companies" text above the preview table (appears in both People and Companies tabs)
- The selection badge ("X selected of 100,000+")

No pagination cap, no preview limit, no behavioral changes. Just a display cap.

## Technical Details (3 files)

### 1. `useFreeDataSearch.ts` -- Export the cap constant

Add and export a constant:
```
export const TOTAL_DISPLAY_CAP = 100_000;
```

In the search response, cap `totalEstimate` so it never exceeds 100,000:
```
totalEstimate: Math.min(totalCount, TOTAL_DISPLAY_CAP)
```

This means downstream code automatically receives the capped number without any extra logic.

### 2. `AudienceBuilder.tsx` -- Format display with "+" suffix

Import `TOTAL_DISPLAY_CAP` from the hook. Create a small helper:
```
const formatTotal = (n: number) =>
  n >= TOTAL_DISPLAY_CAP
    ? `${TOTAL_DISPLAY_CAP.toLocaleString()}+`
    : n.toLocaleString();
```

Apply it to these locations (both People and Companies tabs):
- Toast message in `handleSearch`: `Found ${formatTotal(displayTotal)} people/companies`
- "Found X people/companies" text (lines 714-716 and 863-866)
- Selection badge "of X" text (lines 706-710 and 855-860)
- "Select All X Results" in `PreviewTable` (passed via `totalResults` prop -- already capped from the hook)
- `handleSelectAllResults` confirmation prompt (line 388) -- already uses `totalEstimate` which is now capped

### 3. `PreviewTable.tsx` -- Format the "Select All" label

Import `TOTAL_DISPLAY_CAP` and use the same `formatTotal` helper for:
- "Select All {totalResults} Results" dropdown label (lines 148 and 299)
- The placeholder text for "Select first" input (lines 171 and 323)

## What Does NOT Change

- Database function `search_free_data_builder` -- untouched
- Pagination logic -- untouched (pages still calculated from capped total)
- Selection logic -- untouched (users can still select up to 100,000)
- Filter logic, DNC exclusions -- untouched
- Unlock/credit flow -- untouched
- Net new filter -- untouched

