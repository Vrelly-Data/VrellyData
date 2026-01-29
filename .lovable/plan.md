

## Copy Tab Redesign - Campaign-Centric View with Revamp Feature

### What You're Asking For

The current Copy tab shows all sequences in a flat list with a filter dropdown. You want a cleaner two-stage flow:

1. **Stage 1: Campaign List** - Show synced campaigns as clickable cards
2. **Stage 2: Copy Viewer** - When you click a campaign, show its email copy with easy "Copy" and "Revamp" actions

This creates a more intuitive drill-down experience: **Select Campaign → View/Copy/Revamp**

---

### Proposed User Flow

```text
┌─────────────────────────────────────────────────────────────────┐
│  COPY TAB                                                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Campaign Selector (Dropdown or Cards)                          │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ [v] Select a campaign...                                    ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  Once selected:                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Campaign: "HVAC Owners - Q1 Outreach"                      ││
│  │  [Sync Copy] [Revamp All]                                   ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │                                                             ││
│  │  Step 1: Email  │ Subject: "Quick question about..."       ││
│  │  ─────────────────────────────────────────────────────────  ││
│  │  [Preview Body]  [Copy Subject]  [Copy Body]  [Revamp]      ││
│  │                                                             ││
│  │  Step 2: Follow-up  │ Subject: "Following up on..."        ││
│  │  ─────────────────────────────────────────────────────────  ││
│  │  [Preview Body]  [Copy Subject]  [Copy Body]  [Revamp]      ││
│  │                                                             ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

---

### Key Changes

| Current | Proposed |
|---------|----------|
| Flat list of all steps from all campaigns | Two-stage: select campaign, then see its steps |
| Single "Copy" button copies body only | Separate "Copy Subject" and "Copy Body" buttons |
| No "Revamp" functionality | "Revamp" button for AI-powered copy rewriting |
| Cluttered view with multiple campaigns | Clean single-campaign focus with clear header |
| Dropdown hidden when sequences exist | Always visible dropdown to switch campaigns |

---

### UI Components Structure

**Component 1: Campaign Header Card**
- Campaign name prominently displayed
- Status badge (active/paused/finished)
- "Sync Copy" button to refresh from Reply.io
- "Revamp All" button for bulk AI rewriting (future)

**Component 2: Sequence Steps List**
- Each step as an expandable card
- Step type icon + number badge
- Subject line visible (truncated)
- Click to expand and see full email body
- Action buttons:
  - **Copy Subject** - copies subject line
  - **Copy Body** - copies body text
  - **Revamp** - opens AI dialog to rewrite (placeholder for now)

**Component 3: Empty/Initial State**
- Shows when no campaign is selected
- Prompt to select a campaign from dropdown
- If no sequences synced for selected campaign, show "Sync Copy" CTA

---

### Implementation Details

**File**: `src/components/playground/CopyTab.tsx`

**Changes**:
1. Add a proper campaign header section when a campaign is selected
2. Make the sequence steps cleaner with individual copy buttons for subject and body
3. Add a "Revamp" button placeholder for future AI functionality
4. Improve the empty state when no campaign is selected
5. Keep the dropdown visible at all times for easy switching

**New State Flow**:
```typescript
selectedCampaignId === 'all' 
  → Show prompt to select a campaign

selectedCampaignId !== 'all' && no sequences
  → Show "Sync Copy" button for this campaign

selectedCampaignId !== 'all' && has sequences
  → Show campaign header + sequence steps
```

---

### Technical Changes Summary

| File | Action | Changes |
|------|--------|---------|
| `src/components/playground/CopyTab.tsx` | Modify | Restructure to campaign-centric view with better copy buttons and revamp placeholder |

---

### Future Enhancements (Not in this PR)

- **Revamp Dialog**: AI-powered copy rewriting using Lovable AI (gemini-2.5-flash)
- **Copy Templates**: Save revamped versions to `copy_templates` table
- **Bulk Revamp**: Revamp all steps in a campaign at once

