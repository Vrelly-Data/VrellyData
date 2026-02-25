

# Fix "Build Audience" — UI-Only Approach

## Problem
The Build Audience dialog uses plain free-text inputs, so users type values like "SaaS" or "10-200" that don't match the canonical values in the database (e.g., "Information Technology & Services", "11-50"). The backend function works fine — we just need to guide users to pick correct values.

## Solution
Reuse the exact same suggestion-powered inputs from the Audience Builder (TagInput with suggestions, MultiSelectDropdown for company sizes) in the Build Audience dialog. Also add basic error handling for the RPC call in the edge function.

## Changes

### 1. `src/components/playground/BuildAudienceDialog.tsx`
- Import `useFreeDataSuggestions` and `useAudienceAttributes` (same hooks the Audience Builder uses)
- Import `MultiSelectDropdown` from the search components
- Replace the custom inline `TagInput` component with the shared `TagInput` from `@/components/ui/tag-input` (which supports `suggestions` prop)
- **Industry field**: Use `TagInput` with `suggestions={dedup([...attributes.industries, ...suggestions.industries])}` — same as Audience Builder line 352
- **Job Titles field**: Use `TagInput` with `suggestions={attributes.jobTitles}`
- **Company Size field**: Replace free-text TagInput with `MultiSelectDropdown` using `attributes.companySizeRanges` — same as Audience Builder line 384-392
- **Locations field**: Use `TagInput` with `suggestions={attributes.cities}` (or keep as-is with country suggestions)
- Remove the custom inline `TagInput` component definition (lines 42-75) since we'll use the shared one

### 2. `supabase/functions/build-audience/index.ts`
- Add error checking on the `supabase.rpc("search_free_data_builder", ...)` call
- If `error` is returned, log it and return a proper error response instead of silently continuing with empty results

## What stays the same
- `search_free_data_builder` function — no changes
- All database indexes and logic — no changes
- The AI insights / Claude integration — no changes

## Result
Users will see autocomplete suggestions as they type (pulled from real database values), and company size becomes a dropdown with exact canonical buckets. This eliminates the mismatch that causes 0 results.
