

# Add Select All / Delete All to Sales Knowledge Tab

## Changes

### 1. Add `bulkDeleteEntries` mutation to `src/hooks/useAdminSalesKnowledge.ts`

Add a new mutation that accepts an array of IDs and deletes them all in one call using `.in('id', ids)`.

### 2. Add selection state and bulk actions to `src/components/admin/SalesKnowledgeTab.tsx`

- Add `selectedIds: Set<string>` state to track which entries are selected
- Add a **checkbox** on each entry card for individual selection
- Add a **"Select All"** checkbox in the toolbar that toggles all currently visible (filtered) entries
- Show a **"Delete Selected (N)"** button in the toolbar when any entries are selected, styled as destructive
- Wire the delete button to an `AlertDialog` confirmation, then call `bulkDeleteEntries`
- Clear selection after successful deletion

### UI Layout

The toolbar gets a select-all checkbox on the left and a conditional "Delete Selected" button:

```text
[x] Select All  |  [Add Entry]  [Import CSV]  [Import Doc]  |  [Category Filter]  [Search]  |  [Delete Selected (12)]
```

Each entry card gets a checkbox before the title area.

### No database or RLS changes needed

The existing RLS policy `"Admins can delete sales knowledge"` already allows deletion, and the `.in()` operator works with the existing policy.

