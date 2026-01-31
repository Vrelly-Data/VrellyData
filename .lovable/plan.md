

## Fix Timeline to Include Condition Wait Times

### The Problem

Reply.io uses **two different delay fields**:
- `delayInMinutes` - delay before a step executes (most steps)
- `waitInMinutes` - used by **Condition** steps to define how long to wait before checking

Currently we only capture `delayInMinutes`, but your condition step has `waitInMinutes: 4320` (3 days) that we're ignoring.

### Current vs Correct Timeline

| Step | Type | Current | Correct |
|------|------|---------|---------|
| 1 | LinkedIn Connect | Day 1 | Day 1 |
| 2 | Email | Day 1 | Day 1 |
| 3 | Condition | Day 1 | Day 1 |
| 4 | Email | Day 1 | **Day 4** |
| 5 | LinkedIn Message | Day 2 | **Day 5** |
| 6 | LinkedIn Message | Day 4 | **Day 7** |

---

### Solution: Two Changes Required

#### 1. Update Edge Function to Capture Wait Time

**File:** `supabase/functions/sync-reply-sequences/index.ts`

Add `waitInMinutes` to the interface and use whichever delay field is populated:

```typescript
interface ReplyStep {
  // ... existing fields
  waitInMinutes?: number;  // Add this - used by Condition steps
}

// When calculating delay_days:
const delayMinutes = step.delayInMinutes || step.waitInMinutes || 0;
delay_days: minutesToDays(delayMinutes),
```

#### 2. Update Frontend Logic for Timeline Calculation

**File:** `src/components/playground/CopyTab.tsx`

The delay on a Condition step applies to **the next step**, not the condition itself. Update the cumulative calculation:

```typescript
const sequencesWithDays = (() => {
  if (!sequences) return [];
  let cumulativeDay = 1;
  return sequences.map((step, index) => {
    // Add delay from THIS step (represents wait before this step runs)
    if (step.delay_days) {
      cumulativeDay += step.delay_days;
    }
    return { ...step, cumulativeDay };
  });
})();
```

---

### After Implementation

1. Deploy the updated edge function
2. Re-sync your campaigns (click "Sync Copy")
3. Timeline will correctly show:
   - Steps 1-3: Day 1
   - Step 4 (after 3-day condition): Day 4
   - Step 5 (+1 day): Day 5
   - Step 6 (+2 days): Day 7

---

### Technical Summary

| Change | File | Details |
|--------|------|---------|
| Capture `waitInMinutes` | Edge function | Use `delayInMinutes \|\| waitInMinutes` for conditions |
| Fix cumulative logic | CopyTab.tsx | Apply delay to the step itself, not the next one |
| Re-sync required | User action | Click "Sync Copy" after deployment |

