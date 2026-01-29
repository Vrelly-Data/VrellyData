

## Change Stat Card Breakdowns from Hover to Click

### What You're Asking For

Currently, the "Total Messages Sent" and "Total Replies" stat cards show their detailed breakdowns (Email vs LinkedIn metrics) when you **hover** over them. You want to change this to show the breakdowns when users **click** on the cards instead.

---

### Current vs Proposed Behavior

| Card | Current Behavior | Proposed Behavior |
|------|------------------|-------------------|
| Total Messages Sent | Hover shows tooltip with breakdown | Click opens dialog/popover with breakdown |
| Total Replies | Hover shows tooltip with breakdown | Click opens dialog/popover with breakdown |
| Total Contacts | Click opens contacts dialog | No change |
| Active Campaigns | Click opens campaigns dialog | No change |

---

### Implementation Approach

Replace the `Tooltip` component with a `Popover` component for these two cards. The popover:
- Opens on click (not hover)
- Shows the same breakdown content
- Can be dismissed by clicking outside or clicking again

---

### Technical Changes

**File**: `src/components/playground/PlaygroundStatsGrid.tsx`

1. **Add Popover imports** from `@/components/ui/popover`
2. **Update StatCard component** to accept a `popoverContent` prop instead of `tooltipContent`
3. **Wrap card in Popover** when `popoverContent` is provided
4. **Update the two stat cards** to use the new popover-based interaction

**Updated StatCard Logic:**
```typescript
interface StatCardProps {
  // ... existing props
  popoverContent?: React.ReactNode;  // NEW: replaces tooltipContent
}

function StatCard({ ..., popoverContent }: StatCardProps) {
  if (popoverContent) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          {cardContent}
        </PopoverTrigger>
        <PopoverContent side="bottom" className="w-72">
          {popoverContent}
        </PopoverContent>
      </Popover>
    );
  }
  // ... rest of existing logic
}
```

**Updated Card Usage:**
```typescript
<StatCard
  title="Total Messages Sent"
  value={stats?.totalMessagesSent.toLocaleString() ?? 0}
  icon={<Send className="h-5 w-5 text-primary" />}
  description="Across all campaigns"
  popoverContent={messagesTooltipContent}  // Changed from tooltipContent
/>
```

---

### Files to Modify

| File | Changes |
|------|---------|
| `src/components/playground/PlaygroundStatsGrid.tsx` | Replace Tooltip with Popover for breakdown cards |

---

### Expected Result

| Before | After |
|--------|-------|
| Hover over card → tooltip appears | Click card → popover opens |
| Tooltip disappears when mouse leaves | Popover stays open until clicked away |
| Harder to read on mobile/touch devices | Works properly on touch devices |

