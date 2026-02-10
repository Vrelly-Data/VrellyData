

# Fix: Case-insensitive deduplication of industry suggestions

## Problem

The Industry filter shows both "Insurance" and "insurance" (displayed as two separate suggestions) because two separate data sources are merged with a case-sensitive `new Set()`:

1. `attributes.industries` -- from the AudienceLab API edge function (may contain "Insurance", "insurance", etc.)
2. `suggestions.industries` -- from the database `get_filter_suggestions()` function (returns lowercase, then Title Cased by the frontend)

The `new Set()` in FilterBuilder treats "Insurance" and "insurance" as different strings.

## Fix (1 file change)

Update **FilterBuilder.tsx** lines 346 and 353 where the two arrays are merged. Instead of:

```ts
[...new Set([...attributes.industries, ...suggestions.industries])]
```

Use a case-insensitive dedup helper that Title Cases all values before deduplication:

```ts
const dedup = (arr: string[]) => [...new Set(arr.map(s =>
  s.trim().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
))].filter(Boolean);
```

Then apply it to both the include and exclude suggestion props:

```ts
suggestions={dedup([...attributes.industries, ...suggestions.industries])}
```

This ensures "insurance", "Insurance", and "INSURANCE" all collapse into a single "Insurance" entry.

## What does NOT change

- Database function `get_filter_suggestions` -- already fixed, no further changes
- `useFreeDataSuggestions.ts` -- already fixed, no further changes
- `search_free_data_builder` -- untouched
- All filter parameters and DNC logic -- untouched
- No other suggestion fields affected (skills, interests, technologies only come from one source)

