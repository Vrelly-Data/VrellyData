

## Add "Connections Accepted" to Messages Breakdown Tooltip

### Current State
- The CSV parser already captures `linkedinConnectionsAccepted` from "Accepted Auto Connection" actions
- This value is stored in the `stats` JSONB column of `synced_campaigns`
- However, it's **not being aggregated** in `usePlaygroundStats.ts`
- And it's **not being displayed** in the "Total Messages Sent" tooltip

### Solution

#### 1. Update `usePlaygroundStats.ts`

Add `linkedinConnectionsAccepted` to the interface and aggregation:

```typescript
export interface PlaygroundStats {
  // ... existing fields
  linkedinConnectionsAccepted: number;  // NEW
}
```

Aggregate it in the loop:
```typescript
let linkedinConnectionsAccepted = 0;

campaigns?.forEach((campaign) => {
  // ... existing code
  linkedinConnectionsAccepted += stats.linkedinConnectionsAccepted || 0;
});
```

Return it in the stats object.

#### 2. Update `PlaygroundStatsGrid.tsx`

Add the new metric to the component and display it in the tooltip:

```typescript
const linkedinConnectionsAccepted = stats?.linkedinConnectionsAccepted ?? 0;

// Update hasWebhookData check to include acceptances
const hasWebhookData = linkedinMessagesSent > 0 || linkedinConnectionsSent > 0 || 
                       linkedinReplies > 0 || linkedinConnectionsAccepted > 0;
```

Add to the tooltip breakdown (after "Connection Requests"):
```tsx
<div className="flex items-center justify-between gap-4">
  <span className="flex items-center gap-1.5 text-muted-foreground">
    <Linkedin className="h-3.5 w-3.5" />
    Connections Accepted:
  </span>
  <span className="font-medium">
    {hasWebhookData ? linkedinConnectionsAccepted.toLocaleString() : 'Not tracked'}
  </span>
</div>
```

### Files to Modify

| File | Changes |
|------|---------|
| `src/hooks/usePlaygroundStats.ts` | Add `linkedinConnectionsAccepted` to interface and aggregation logic |
| `src/components/playground/PlaygroundStatsGrid.tsx` | Display "Connections Accepted" in the Messages Breakdown tooltip |

### Expected Result

The "Total Messages Sent" tooltip will show:

| Metric | Value |
|--------|-------|
| Emails Sent | X |
| LinkedIn Messages | 213 |
| Connection Requests | 561 |
| **Connections Accepted** | **116** |

