
## View Saved Copy: Copy Content + Rename Title

### What's Being Added

When a user opens a saved copy card (from the dashboard library), the `ViewCopyDialog` currently shows read-only step cards with Copy buttons and a Close button. Two things are missing:

1. **Copy the copy** — the Copy buttons for subject/body are already there and work correctly. No change needed here — this already works.
2. **Rename the title** — the dialog title just shows the name as static text. The user needs to be able to click and edit it inline, save the new name, which updates all rows in the group in the database.

### How the Name is Stored

The name is embedded inside each row's `name` column using the pattern: `"{templateName} — Step {N} ({Channel})"`. This means to rename a group, we must update **all rows** in the group to replace the base name prefix.

For example, if the group has 3 rows:
- `"My SaaS Copy — Step 1 (LinkedIn)"`
- `"My SaaS Copy — Step 2 (Email)"`
- `"My SaaS Copy — Step 3 (LinkedIn)"`

Renaming to `"Q1 SaaS Outreach"` produces:
- `"Q1 SaaS Outreach — Step 1 (LinkedIn)"`
- `"Q1 SaaS Outreach — Step 2 (Email)"`
- `"Q1 SaaS Outreach — Step 3 (LinkedIn)"`

The base name is already extracted by the hook using `replace(/\s*[—–-]\s*Step\s*\d+.*$/i, '')`, so we know the suffix to preserve.

---

### Part 1: Add `useRenameCopyGroup` to `useCopyTemplates.ts`

A new mutation that:
1. Accepts `{ groupId, newName, rows }` where `rows` are the current `CopyTemplateRow[]`
2. For each row, rebuilds the name by replacing the old base name with the new one, keeping the `" — Step N (Channel)"` suffix intact
3. Runs `supabase.from('copy_templates').update({ name: newName }).eq('id', row.id)` for each row (using `Promise.all` for parallel updates)
4. Invalidates `['copy-templates', 'ai-groups']` on success

The suffix extraction logic: take each row's `name`, strip the base prefix (anything before `" — Step"`), and prepend the new name. Since the suffix follows the consistent `— Step N (Channel)` pattern, a simple regex replace is reliable.

```ts
export function useRenameCopyGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ rows, newName }: { groupId: string; newName: string; rows: CopyTemplateRow[] }) => {
      await Promise.all(rows.map((row) => {
        const suffix = row.name.match(/(\s*[—–-]\s*Step\s*\d+.*$)/i)?.[1] || '';
        const updatedName = newName + suffix;
        return supabase.from('copy_templates').update({ name: updatedName }).eq('id', row.id);
      }));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['copy-templates', 'ai-groups'] });
    },
  });
}
```

---

### Part 2: Update `ViewCopyDialog.tsx`

**New state:**
- `isEditingName: boolean` — controls whether the title is shown as text or an input
- `editedName: string` — the draft value while editing (initialised from `group.name` when the dialog opens via `useEffect`)
- `isSavingName: boolean` — disables the save button during mutation

**Title area changes** (the `DialogHeader`):

Instead of `<DialogTitle>{group.name}</DialogTitle>`, render:

```
[ ✏️ edit icon ]  "My SaaS Copy"
```

When the pencil icon is clicked (or the title text is clicked), it switches to an inline input:

```
[ Input: "My SaaS Copy" ] [ ✓ Save ] [ ✕ Cancel ]
```

- Input is pre-focused on open
- Enter key triggers save
- Escape key cancels
- "Save" calls `useRenameCopyGroup`, shows a spinner while saving, then exits edit mode
- On success: toast "Title updated", query invalidated so the dashboard card also updates

The layout within `DialogHeader`:

```tsx
// View mode:
<DialogTitle className="flex items-center gap-2 group/title">
  <Mail className="h-5 w-5 text-primary" />
  {group.name}
  <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover/title:opacity-100" onClick={() => setIsEditingName(true)}>
    <Pencil className="h-3.5 w-3.5" />
  </Button>
</DialogTitle>

// Edit mode:
<div className="flex items-center gap-2">
  <Input value={editedName} onChange={...} onKeyDown={...} autoFocus className="h-8 text-base font-semibold" />
  <Button size="sm" onClick={handleSaveName} disabled={isSavingName}>
    {isSavingName ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
  </Button>
  <Button size="sm" variant="ghost" onClick={() => setIsEditingName(false)}>
    <X className="h-3.5 w-3.5" />
  </Button>
</div>
```

**Reset on open**: a `useEffect` watching `group?.name` resets `editedName` and `isEditingName` whenever a new group is opened.

**Copy buttons**: Already work — no changes needed.

---

### Files to Change

| File | Action |
|---|---|
| `src/hooks/useCopyTemplates.ts` | Add `useRenameCopyGroup` mutation |
| `src/components/playground/ViewCopyDialog.tsx` | Add inline title editing with save/cancel + `useRenameCopyGroup` |

### No Database Schema Changes

The `copy_templates` table already has the `name` column with an UPDATE policy allowing team members to update their own team's records. The rename writes directly to existing rows.

### No Dashboard Changes

Because `useAICopyGroups` is invalidated on rename success, the `DocCard` on the dashboard automatically re-renders with the updated name — no changes to `PlaygroundDashboard.tsx` needed.
