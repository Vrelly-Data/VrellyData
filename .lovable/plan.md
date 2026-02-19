
## Add AI Buttons to Empty States in Copy Tab and People Tab

### What Needs to Change

Both tabs currently show plain "no data" empty states with no AI actions. The user wants the AI buttons ("Create New Copy" and "Build Audience with AI") accessible even when there are no synced campaigns or contacts.

---

### File 1: `src/components/playground/CopyTab.tsx`

**Target**: The "No Campaigns Synced" empty state at lines 179–189.

**Change**: Add a `createCopyOpen` state (already exists at line 49), then update the empty state to include the "Create New Copy" button below the existing message. The dialog (`<CreateCopyDialog>`) is already rendered at the bottom of the component at line 383 — no duplicate needed.

Before:
```
No Campaigns Synced
"First sync your campaigns from the Playground tab to see email copy here."
```

After:
```
No Campaigns Synced
"First sync your campaigns from the Playground tab to see email copy here."
[ Create New Copy button ]
```

---

### File 2: `src/components/playground/PeopleTab.tsx`

**Target**: The "No Contacts Synced" empty state at lines 225–275.

**Change**: The `buildAudienceOpen` state and `<BuildAudienceDialog>` are already wired in. Add a "Build Audience with AI" button at the bottom of the empty state card, below the sync buttons. This works regardless of whether there are 0 campaigns or campaigns that just haven't been synced.

Before (empty state bottom):
```
[ Sync All X Linked Campaigns ]
  — or —
[ Campaign selector dropdown ]
  — or —
"First sync your campaigns from the Playground tab."
```

After (empty state bottom):
```
[ Sync All X Linked Campaigns ]
  — or —
[ Campaign selector dropdown ]
  — or —
"First sync your campaigns from the Playground tab."

[ Divider ]
[ Build Audience with AI button ]
```

---

### Technical Notes

- No new state, imports, or dialogs need to be added — both tabs already have the state variables and dialog components in place.
- Only the JSX of the two early-return empty state blocks needs updating.
- Two files changed, minimal risk.
