

## Fix LinkedIn Stats Parsing for Action-Based CSV

### Problem Identified
The CSV parser has hardcoded action names that don't match your Reply.io export format:

| Expected Action | Current Mapping | Your CSV Uses |
|----------------|-----------------|---------------|
| Connection Request Sent | `'sent auto connection note'` | `'sent auto connection'` |
| Reply to Connection | `'replied auto connection note'` | Likely `'replied auto connection'` |
| Reply to Message | `'replied auto message'` | May need verification |

This explains:
- **Connection Requests = 0** - The action text doesn't match, so all 561 connection requests are ignored
- **Replies = 40 instead of 14** - Either the action name is wrong OR old data from Jan 27 campaigns is still being counted

### Root Cause Analysis
1. **Action mapping is too strict**: Only exact lowercase matches work. `'Sent Auto Connection'` ≠ `'sent auto connection note'`
2. **The 4 old campaigns from Jan 27** (Retail, Healthcare, Bournemouth, Rejuvenate) weren't cleared because they may have different campaign names that didn't match

### Solution

#### 1. Expand Action Mappings (LinkedInStatsUploadDialog.tsx)

Add more action aliases to cover Reply.io's actual export format:

```typescript
const ACTION_MAPPINGS: Record<string, LinkedInMetric> = {
  // Replies
  'replied auto connection note': 'linkedinReplies',
  'replied auto connection': 'linkedinReplies',  // NEW
  'replied auto message': 'linkedinReplies',
  'replied message': 'linkedinReplies',  // NEW - potential alias
  
  // Connection Acceptances
  'accepted auto connection': 'linkedinConnectionsAccepted',
  'accepted connection': 'linkedinConnectionsAccepted',  // NEW
  
  // Connection Requests Sent
  'sent auto connection note': 'linkedinConnectionsSent',
  'sent auto connection': 'linkedinConnectionsSent',  // NEW - THIS IS THE KEY FIX
  'sent connection request': 'linkedinConnectionsSent',  // NEW
  
  // Messages Sent
  'sent auto message': 'linkedinMessagesSent',
  'sent message': 'linkedinMessagesSent',  // NEW
};
```

#### 2. Add Partial Matching Fallback

Instead of only exact matches, add fuzzy matching logic:

```typescript
function getMetricForAction(action: string): LinkedInMetric | null {
  const normalized = action.toLowerCase().trim();
  
  // Exact match first
  if (ACTION_MAPPINGS[normalized]) {
    return ACTION_MAPPINGS[normalized];
  }
  
  // Partial matching fallback
  if (normalized.includes('replied') && normalized.includes('connection')) {
    return 'linkedinReplies';
  }
  if (normalized.includes('replied') && normalized.includes('message')) {
    return 'linkedinReplies';
  }
  if (normalized.includes('accepted') && normalized.includes('connection')) {
    return 'linkedinConnectionsAccepted';
  }
  if (normalized.includes('sent') && normalized.includes('connection')) {
    return 'linkedinConnectionsSent';
  }
  if (normalized.includes('sent') && normalized.includes('message')) {
    return 'linkedinMessagesSent';
  }
  
  return null;
}
```

#### 3. Add Debug Info to Preview Table

Show which actions were detected to help troubleshoot:

```tsx
// Add a summary above the table showing detected action types
<div className="text-xs text-muted-foreground mb-2">
  Detected actions: {detectedActions.join(', ')}
  {unrecognizedActions.length > 0 && (
    <span className="text-amber-600"> | Unrecognized: {unrecognizedActions.join(', ')}</span>
  )}
</div>
```

### Files to Modify

| File | Changes |
|------|---------|
| `src/components/playground/LinkedInStatsUploadDialog.tsx` | Expand ACTION_MAPPINGS to include `'sent auto connection'` and other variants; add partial matching logic; add debug info showing detected/unrecognized actions |

### Expected Result After Fix

When you re-upload your CSV:
- **Connection Requests Sent**: 561 (currently 0 → fixed by adding `'sent auto connection'` mapping)
- **LinkedIn Replies**: 14 (currently inflated → fixed by correct action matching)
- **LinkedIn Messages**: 213 (already working)
- **Connection Acceptances**: 116 (already working)

### Verification Steps

After implementing:
1. Upload your LinkedIn stats CSV using "Replace LinkedIn Stats" mode
2. Check the preview table shows the correct totals per campaign
3. Verify dashboard shows exactly: 14 replies, 213 messages, 116 acceptances, 561 connection requests

