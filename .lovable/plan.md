

# Fix Build Audience Timeout + Add Save Flow (Data Playground Only)

Scope: Only `BuildAudienceDialog.tsx` and the `build-audience` edge function. The main Audience Builder page is untouched.

## Task 1: Fix Timeout in Edge Function

**File:** `supabase/functions/build-audience/index.ts`

- Add `SET statement_timeout = '15000'` before calling the RPC to prevent indefinite hangs
- Reduce `p_limit` from 100 to 50 for the preview query
- Add a fallback: if the RPC times out, run a simpler direct query filtering only by industry and job title

## Task 2: Add Save Audience Flow to Result Screen

**File:** `src/components/playground/BuildAudienceDialog.tsx`

On the results screen (after prospects are shown), add:

- A text input for **audience name** (auto-populated with something like "Audience - [first industry] - Feb 2026")
- A **credit cost summary** showing: number of contacts, cost (1 credit each), current balance
- A **"Save Audience"** button that:
  1. Deducts credits via existing `useCreditCheck` hook
  2. Saves prospects to `people_records` via existing `usePersistRecords` hook
  3. Creates a new List and links the prospects via existing `useLists` hook
  4. Shows a "Saved" confirmation state

### Hooks reused (no modifications needed):
- `useCreditCheck` -- credit deduction
- `usePersistRecords` -- save to people_records
- `useLists` -- create list + add items
- `authStore` -- current credit balance

## What is NOT touched:
- `src/pages/AudienceBuilder.tsx` -- not modified
- `src/components/search/*` -- not modified
- `supabase/functions/audiencelab-api/` -- not modified
- No database migrations needed

