
## Phase 2: Wire Up AI Features in the Data Playground

### Current State Assessment

After reviewing all relevant files, here is exactly what exists vs. what is missing:

| Feature | Dialog | Edge Function | Button/Entrypoint |
|---|---|---|---|
| Create New Copy | `CreateCopyDialog.tsx` — complete | `generate-copy` — deployed | "Create New Copy" button in CopyTab header — already wired |
| Build Audience | `BuildAudienceDialog.tsx` — complete | `build-audience` — deployed | **MISSING** — dialog is imported in PeopleTab but never rendered or triggered |

The work needed is minimal but impactful:

1. Wire the `BuildAudienceDialog` into `PeopleTab` (add state + button + render the dialog)
2. Add an "AI Actions" section to the `PlaygroundDashboard` so both AI features are discoverable from the main Playground tab — not just buried inside sub-tabs

---

### What Will Change

#### File 1: `src/components/playground/PeopleTab.tsx`
- Add `buildAudienceOpen` state (`useState(false)`)
- Add a "Build Audience with AI" button in the top-right actions bar (next to "Export CSV")
- Render `<BuildAudienceDialog open={buildAudienceOpen} onOpenChange={setBuildAudienceOpen} />` at the bottom of the component (currently imported but unused)

#### File 2: `src/components/playground/PlaygroundDashboard.tsx`
- Import `BuildAudienceDialog` and `CreateCopyDialog`
- Add `buildAudienceOpen` and `createCopyOpen` state
- Insert a new "AI Tools" section above the Overview stats grid, containing two action cards:
  - **Generate Copy** card — Sparkles icon, description, "Create New Copy" button → opens `CreateCopyDialog`
  - **Build Audience** card — Target icon, description, "Build Audience" button → opens `BuildAudienceDialog`
- Render both dialogs at the bottom of the dashboard

---

### Layout After Changes

The Playground tab (main dashboard) will look like:

```text
[ Integration Setup Card ]
        ↓
[ AI Tools ]
  [ Generate Copy Card ]  [ Build Audience Card ]
        ↓
[ Overview — Stats Grid ]
        ↓
[ Synced Campaigns Table ]
```

The People tab will gain a "Build Audience with AI" button in its top-right action bar, next to "Export CSV".

---

### No Database or Edge Function Changes Required

Both edge functions are already deployed and functional. No new backend work is needed — this is purely a UI wiring task across two files.
