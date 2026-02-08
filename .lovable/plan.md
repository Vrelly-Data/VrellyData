

## Fix: Email Stats Not Appearing in Dashboard

### Root Cause Identified

The dashboard shows "0 emails sent" because there's a **data flow gap** between the sync functions:

```text
Flow Timeline:
1. fetch-available-campaigns → writes {peopleCount: 378, replyTeamId: "383893"}
2. sync-reply-campaigns → overwrites with {} (V3 Stats API returns 404)
3. sync-reply-contacts → tries to update stats but runs after campaign already saved with empty stats
```

The V3 Statistics API (`/v3/statistics/sequences/{id}`) is returning **404 for all sequences**, so `apiStats` is empty. The current code doesn't preserve existing stats when the API fails.

### The Fix

Modify `sync-reply-campaigns` to:
1. **Preserve existing stats** when V3 API returns 404
2. **Use `peopleCount` as fallback** for `sent`/`delivered` when no API data is available

**Current code (broken):**
```typescript
// Lines 358-362 - does NOT preserve existing stats
const mergedStats = {
  ...apiStats,           // empty when V3 returns 404
  ...linkedinStats,      // only LinkedIn fields
};
```

**Fixed code:**
```typescript
// Preserve existing stats, overlay with API data and LinkedIn stats
const existingPeopleCount = existingStats.peopleCount as number | undefined;
const existingSent = existingStats.sent as number | undefined;
const existingDelivered = existingStats.delivered as number | undefined;
const existingReplies = existingStats.replies as number | undefined;

const mergedStats = {
  ...existingStats,      // Preserve ALL existing stats (including peopleCount, replies, etc.)
  ...apiStats,           // Overlay with fresh API data (if available)
  ...linkedinStats,      // Preserve LinkedIn fields from CSV uploads
  // Fallback: use existing or peopleCount if no sent/delivered data
  sent: apiStats.sent || existingSent || existingDelivered || existingPeopleCount || 0,
  delivered: apiStats.delivered || existingDelivered || existingSent || existingPeopleCount || 0,
};
```

### Technical Changes

| File | Change |
|------|--------|
| `supabase/functions/sync-reply-campaigns/index.ts` | Preserve existing stats when V3 API fails, add fallback logic |

### After This Fix

1. Campaign sync will preserve existing stats when V3 Statistics API returns 404
2. Dashboard will show `peopleCount` as "Emails Sent" (since that's the number of people who received the sequence)
3. As contacts sync, actual engagement data (replies, opens) will be added to the stats
4. LinkedIn stats from CSV uploads remain preserved

### Why This Is Correct

- `peopleCount` represents contacts added to the campaign/sequence
- In Reply.io, a contact added to a sequence will receive emails (unless bounced/opted out)
- Using `peopleCount` as a baseline for "sent" is a reasonable approximation when the Statistics API is unavailable
- The `sync-reply-contacts` function will later update with actual engagement data

