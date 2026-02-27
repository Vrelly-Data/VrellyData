

# Fix Credit Balance & Improve Recent Credit Usage Display

## Problem 1: Credit Balance Shows Wrong Amount
The "Credit Balance" section reads `profile.credits` which is stuck at 75,000 (never decremented). The actual deductions are only tracked in the `credit_transactions` table.

## Problem 2: Recent Credit Usage Shows All 20 Events
The table currently shows up to 20 events at once. User wants to see only the last 3 by default with an option to expand.

## Solution

### `src/pages/Settings.tsx`

**Credit Balance Fix:**
- Add a new `useQuery` to sum all `credits_deducted` from `credit_transactions` for the current user
- Compute the displayed balance as: tier max credits minus total deductions
- Update the Progress bar and text to reflect the computed balance

**Recent Credit Usage - Collapse to 3:**
- Add a `showAllCredits` state (default `false`)
- When `false`, slice `creditHistory` to show only the first 3 entries
- Add a "View All" / "Show Less" button below the table that toggles between showing 3 and all entries
- Keep fetching up to 20 from the database (no query change needed)

### No database changes needed
The `credit_transactions` table already has all the data. The `profile.credits` field simply isn't being kept in sync, so we'll compute the real balance client-side from the transaction history.

