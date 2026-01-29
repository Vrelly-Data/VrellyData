

## Add Hover Tooltips with Percentage Rates

### What You're Asking For

Inside the "Total Messages Sent" and "Total Replies" popovers, add hover tooltips to specific metrics that show conversion percentages:

| Metric | Hover Shows |
|--------|-------------|
| Connections Accepted | `X% acceptance rate` (accepted / requests sent) |
| LinkedIn Replies | `X% reply rate` (replies / messages sent) |

---

### Visual Example

**Before** (just numbers):
```
Connections Accepted:    42
LinkedIn Replies:        15
```

**After** (numbers with hover for percentages):
```
Connections Accepted:    42  ← hover → "58.3% acceptance rate"
LinkedIn Replies:        15  ← hover → "12.5% reply rate"
```

---

### Implementation Details

**File**: `src/components/playground/PlaygroundStatsGrid.tsx`

1. **Import Tooltip components** (already available in the project)
2. **Calculate percentages**:
   - Acceptance rate: `(linkedinConnectionsAccepted / linkedinConnectionsSent) * 100`
   - LinkedIn reply rate: `(linkedinReplies / linkedinMessagesSent) * 100`
3. **Wrap the value spans** in the popover content with `Tooltip` components
4. **Handle edge cases**: Show "N/A" or skip tooltip when denominator is 0

---

### Technical Changes

**Add Tooltip imports**:
```typescript
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
```

**Calculate percentages**:
```typescript
const connectionAcceptanceRate = linkedinConnectionsSent > 0 
  ? ((linkedinConnectionsAccepted / linkedinConnectionsSent) * 100).toFixed(1)
  : null;

const linkedinReplyRate = linkedinMessagesSent > 0
  ? ((linkedinReplies / linkedinMessagesSent) * 100).toFixed(1)
  : null;
```

**Update Connections Accepted row**:
```typescript
<div className="flex items-center justify-between gap-4">
  <span className="flex items-center gap-1.5 text-muted-foreground">
    <Linkedin className="h-3.5 w-3.5" />
    Connections Accepted:
  </span>
  {connectionAcceptanceRate ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="font-medium cursor-help underline decoration-dotted">
          {linkedinConnectionsAccepted.toLocaleString()}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {connectionAcceptanceRate}% acceptance rate
      </TooltipContent>
    </Tooltip>
  ) : (
    <span className="font-medium">
      {hasWebhookData ? linkedinConnectionsAccepted.toLocaleString() : 'Not tracked'}
    </span>
  )}
</div>
```

**Update LinkedIn Replies row** (in the replies popover):
```typescript
<div className="flex items-center justify-between gap-4">
  <span className="flex items-center gap-1.5 text-muted-foreground">
    <Linkedin className="h-3.5 w-3.5" />
    LinkedIn Replies:
  </span>
  {linkedinReplyRate ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="font-medium cursor-help underline decoration-dotted">
          {linkedinReplies.toLocaleString()}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {linkedinReplyRate}% reply rate
      </TooltipContent>
    </Tooltip>
  ) : (
    <span className="font-medium">
      {hasWebhookData ? linkedinReplies.toLocaleString() : 'Not tracked'}
    </span>
  )}
</div>
```

**Wrap popover content in TooltipProvider**:
The tooltip content needs to be wrapped in a `TooltipProvider` for the nested tooltips to work inside the popover.

---

### Files to Modify

| File | Changes |
|------|---------|
| `src/components/playground/PlaygroundStatsGrid.tsx` | Add Tooltip imports, calculate rates, wrap metric values with hover tooltips |

---

### Expected Result

| Interaction | Before | After |
|-------------|--------|-------|
| Click "Total Messages Sent" card | Popover opens with breakdown | Same |
| Hover over "Connections Accepted" number | Nothing | Tooltip shows "58.3% acceptance rate" |
| Click "Total Replies" card | Popover opens with breakdown | Same |
| Hover over "LinkedIn Replies" number | Nothing | Tooltip shows "12.5% reply rate" |

The numbers will have a subtle dotted underline to indicate they're hoverable.

