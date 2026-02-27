

# Fix: Saved Copies Not Visible in Copy Tab Library

## Problem
The CopyTab component has an early return on line 251 when no campaigns are synced (`if (!campaigns?.length)`). This causes the "Saved Copies" grid and the ViewCopyDialog to never render -- even though copies exist in the database.

The user saves copy via the Revamp dialog, but when they go to the Copy tab, the library section is completely hidden behind the "No Campaigns Synced" empty state.

## Solution

Restructure the CopyTab so that the "Saved Copies" library section and its ViewCopyDialog always render, regardless of whether campaigns are synced.

## Changes

### `src/components/playground/CopyTab.tsx`

1. **Move the "Saved Copies" section and dialogs outside the early return**: Instead of returning early when there are no campaigns, render the empty state inline and always show the saved copies grid below it.

2. Specifically:
   - Remove the early `return` block for `!campaigns?.length` (lines 251-267)
   - Instead, render it as inline conditional content within the main return
   - Ensure the "Saved Copies" grid (lines 454-471), the RevampResultDialog, CreateCopyDialog, and ViewCopyDialog always render at the bottom

3. The resulting layout will be:
   - If no campaigns: show empty state card + "Create New Copy" button, then the saved copies library below
   - If campaigns exist: show campaign selector + sequence steps, then saved copies library below
   - Dialogs always rendered at the bottom

This is a UI-only fix -- no database or backend changes needed.
