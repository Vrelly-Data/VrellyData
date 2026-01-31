

## Improve Timeline Display in Copy Tab

### What you're asking for

Change from confusing "+0d delay" / "+1d delay" badges to clear cumulative day labels like "Day 1", "Day 2", etc. This helps users understand the actual sequence timeline at a glance.

---

## Current vs Proposed Display

| Current | Proposed |
|---------|----------|
| LinkedIn Connect "0" | LinkedIn Connect **Day 1** |
| Email "0" | Email **Day 1** |
| Condition "0" | Condition **Day 1** |
| Email "0" | Email **Day 1** |
| LinkedIn Message "+1d delay" | LinkedIn Message **Day 2** |
| LinkedIn Message "+2d delay" | LinkedIn Message **Day 4** |

---

## How it works

The `delay_days` field represents delay **from the previous step**, not cumulative time. We need to calculate running totals:

```text
Step 1: delay=0 → cumulative = 1 (Day 1)
Step 2: delay=0 → cumulative = 1 (Day 1)  
Step 3: delay=0 → cumulative = 1 (Day 1)
Step 4: delay=0 → cumulative = 1 (Day 1)
Step 5: delay=1 → cumulative = 2 (Day 2)
Step 6: delay=2 → cumulative = 4 (Day 4)
```

---

## Implementation

### File: `src/components/playground/CopyTab.tsx`

**1. Add helper function to calculate cumulative days:**

```typescript
// Calculate cumulative day for each step
const getSequenceWithDays = (steps: typeof sequences) => {
  if (!steps) return [];
  
  let cumulativeDay = 1;
  return steps.map((step, index) => {
    if (index > 0 && step.delay_days) {
      cumulativeDay += step.delay_days;
    }
    return { ...step, cumulativeDay };
  });
};
```

**2. Update the badge display:**

Replace:
```tsx
{step.delay_days && step.delay_days > 0 && (
  <Badge variant="secondary" className="text-xs">
    +{step.delay_days}d delay
  </Badge>
)}
```

With:
```tsx
<Badge variant="secondary" className="text-xs">
  Day {step.cumulativeDay}
</Badge>
```

---

## Visual Result

Each step card will clearly show:

```text
┌─────────────────────────────────────────┐
│ ▸ 🔗 Step 1  LinkedIn Connect  [Day 1]  │
├─────────────────────────────────────────┤
│ ▸ ✉️ Step 2  Email            [Day 1]  │
├─────────────────────────────────────────┤
│ ▸ ⚙️ Step 3  Condition        [Day 1]  │
├─────────────────────────────────────────┤
│ ▸ ✉️ Step 4  Email            [Day 1]  │
├─────────────────────────────────────────┤
│ ▸ 💬 Step 5  LinkedIn Message [Day 2]  │
├─────────────────────────────────────────┤
│ ▸ 💬 Step 6  LinkedIn Message [Day 4]  │
└─────────────────────────────────────────┘
```

---

## Summary

| Change | Details |
|--------|---------|
| Calculate cumulative days | Sum delays to get actual timeline position |
| Show "Day X" badge | Always visible, not just for non-zero delays |
| Clearer UX | Users immediately understand sequence timing |

