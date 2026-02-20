
## Move Saved Copy Cards from Dashboard to Copy Tab

### What's Changing

Currently, saved AI-generated copy groups (the Google Drive-style document cards) appear inside the "Generate Copy" card on the **Playground Dashboard tab**. The request is to move them so they appear in the **Copy tab**, below the "Select a campaign" dropdown — as a second section on that same page.

### Current Layout (Copy Tab)

```text
Copy Tab
├── [Create New Copy] button (top right)
├── Campaign selector dropdown
├── (if no campaign selected) → empty state with dashed border
└── (if campaign selected) → sequence step cards
```

### New Layout (Copy Tab)

```text
Copy Tab
├── [Create New Copy] button (top right)
├── Campaign selector dropdown
├── (if no campaign selected) → empty state with dashed border
└── (if campaign selected) → sequence step cards

── Saved Copies section (always visible below the campaign area) ──
├── Section header: "Saved Copies"
└── Google Drive-style document cards grid (same DocCard component)
    └── Each card: Open → ViewCopyDialog, Delete button
```

### Files to Change

**`src/components/playground/CopyTab.tsx`**
- Import `useAICopyGroups`, `useDeleteCopyGroup`, `CopyGroup` from `useCopyTemplates`
- Import `ViewCopyDialog` from `./ViewCopyDialog`
- Import `formatDistanceToNow` from `date-fns`
- Add state: `viewGroup` (for the ViewCopyDialog open/close)
- Add the `DocCard` component (move/copy it from `PlaygroundDashboard.tsx` — it's a self-contained sub-component)
- Add a "Saved Copies" section at the bottom of the tab, below the campaign area, using the same grid layout as the dashboard currently shows
- If no saved copies exist, show nothing (no empty state needed since the campaign empty state already occupies the space)

**`src/components/playground/PlaygroundDashboard.tsx`**
- Remove the "Saved copies" shelf from inside the "Generate Copy" card (lines 113–132)
- Remove the `ViewCopyDialog` import and state (`viewGroup`, `setViewGroup`) since it's no longer needed on the dashboard
- Remove the `useAICopyGroups` import and usage
- Remove the `DocCard` sub-component (it moves to CopyTab)
- Remove the `ViewCopyDialog` render at the bottom of the component
- The "Generate Copy" card becomes simpler: just the description + "Create New Copy" button

### Technical Notes

- `DocCard` is currently defined inside `PlaygroundDashboard.tsx` as a local sub-component. It will be moved to live inside `CopyTab.tsx` the same way — no need to make it a separate file.
- The `ViewCopyDialog` is already imported in both files; it will remain in `CopyTab.tsx` and be removed from `PlaygroundDashboard.tsx`.
- The saved copies section in the Copy tab will use `useAICopyGroups()` hook (same as dashboard currently does).
- No database changes needed — the data source is identical.
- The saved copies section will always be visible in the Copy tab regardless of whether a campaign is selected, positioned below the campaign selector area.
