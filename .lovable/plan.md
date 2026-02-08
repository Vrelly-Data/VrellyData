
## Fix: Incorrect Email Stats (Showing 1,053 Instead of 114)

### Root Cause

The dashboard shows 1,053 "emails sent" because **both sync functions** are using `peopleCount` as a fallback:

| Source | Value | What it actually means |
|--------|-------|------------------------|
| `peopleCount` | 1,053 | Contacts added to campaigns |
| Actual emails sent | 114 | What Reply.io reports |
| V3 Statistics API | 404 | Not working - returns empty data |

The fallback chain `sent: apiStats.sent || existingSent || peopleCount || 0` is using `peopleCount` since the V3 Statistics API returns 404.

### The Real Problem

Reply.io's V3 Statistics API (`/v3/statistics/sequences/{id}`) is returning 404 for all sequences. This API is supposed to provide `deliveredContacts` (actual emails sent), but it's not accessible.

### Solution: Remove the peopleCount Fallback

Since `peopleCount` (contacts in campaign) ≠ "emails sent", we should **not** use it as a fallback. Instead:

1. **Only use actual delivery data** when available from the Statistics API
2. **Don't show inflated numbers** - better to show 0 than incorrect data
3. **Derive stats from contacts** where possible (replies, opens, clicks are accurate)

### Technical Changes

| File | Change |
|------|--------|
| `supabase/functions/sync-reply-campaigns/index.ts` | Remove `peopleCount` fallback for `sent`/`delivered` - only use actual API data or existing values |
| `supabase/functions/sync-reply-contacts/index.ts` | Remove `peopleCount` fallback for `sent`/`delivered` - these can only come from Statistics API |

### Updated Logic

**sync-reply-campaigns (line ~365):**
```typescript
const mergedStats = {
  ...existingStats,
  ...apiStats,
  ...linkedinStats,
  // Only use actual API data or existing values - NOT peopleCount
  sent: apiStats.sent || existingSent || 0,
  delivered: apiStats.delivered || existingDelivered || 0,
  replies: apiStats.replies || existingReplies || 0,
  // Keep peopleCount separate - it's "contacts in campaign", not "emails sent"
  peopleCount: existingPeopleCount || 0,
};
```

**sync-reply-contacts (line ~336-337):**
```typescript
// Don't override sent/delivered with peopleCount
delivered: existingDelivered ?? undefined,
sent: existingSent ?? undefined,
```

### After This Fix

1. Dashboard will show 0 emails sent (accurate when V3 API fails)
2. `peopleCount` will be tracked separately as "Contacts in Campaigns"
3. Replies, opens, clicks will still show accurate data from contacts
4. When the V3 Statistics API works again, actual delivery numbers will appear

### Future Improvement (Optional)

If you want to display email stats when the V3 API is unavailable, we could:
- Add a V1 campaign stats endpoint call (if Reply.io has one)
- Use `finished` contacts as a proxy for "emails sent" (contacts who completed the sequence)
- Display a different metric like "Contacts Enrolled" instead of "Emails Sent"

### Why This Is The Right Fix

- `peopleCount` = 1,053 contacts added
- Emails actually sent = 114 (per Reply.io dashboard)
- **Showing 1,053 as "Emails Sent" is misleading**
- Better to show 0 (with proper messaging) than inflate numbers 9x
