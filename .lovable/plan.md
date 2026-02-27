

# Fix Recent Credit Usage Display

## Problem
The "Recent Credit Usage" section in Settings queries the `unlock_events` table, which has no data. The actual credit usage is stored in the `credit_transactions` table -- that's where the 14-credit transaction exists.

## Solution
Update the Settings page to query `credit_transactions` instead of `unlock_events`.

## Changes

### `src/pages/Settings.tsx`

1. Update the React Query `queryFn` to fetch from `credit_transactions` instead of `unlock_events`:
   - Table: `credit_transactions`
   - Filter by `user_id` = current user
   - Order by `created_at` descending, limit 20

2. Update the table columns to match `credit_transactions` fields:
   - "Type" column: display `entity_type` (same field name, works as-is)
   - "Credits" column: display `credits_deducted` instead of `cost`
   - "Records" column (new): display `records_returned` for additional context
   - "Date" column: display `created_at` (same as before)

3. Update the query key to `["credit-transactions"]` for clarity.

### No database changes needed
The data is already being recorded correctly in `credit_transactions`.

