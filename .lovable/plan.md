

# Fix: Contact Count and Email Stats Discrepancy

## Summary of Issues

You're experiencing three related problems:

1. **Contact count shows 737 instead of 1,053** - Some campaigns didn't sync their contacts
2. **Emails sent shows 0 instead of 114** - The V3 Statistics API is returning 404 errors
3. **3 campaigns have 0 synced contacts** - Campaigns 1451359, 1496434, and 1606099 failed to sync

## Root Cause Analysis

| Issue | Cause | Evidence |
|-------|-------|----------|
| Missing 316 contacts | 3 campaigns have 0 synced contacts | Database shows campaigns 1451359, 1496434, 1606099 have 0 contacts |
| Emails sent = 0 | V3 Statistics API returns 404 | Edge function logs show `Reply.io V3 API error (404)` for all 6 sequences |
| Dashboard shows wrong number | `usePlaygroundStats` sums `peopleCount` from campaigns | Only synced campaigns have `peopleCount` populated |

## Technical Details

### The V3 Statistics API Problem

The Reply.io V3 Statistics endpoint `/v3/statistics/sequences/{id}` is consistently returning 404 errors. This endpoint is supposed to return `deliveredContacts` (actual emails sent), but it's not accessible with the current API key/permissions.

### The V3 Extended Contacts Endpoint

Reply.io has a V3 endpoint `/v3/sequences/{id}/contacts/extended` that returns per-contact engagement data including a `sent` boolean:

```text
GET /v3/sequences/{id}/contacts/extended
Response:
{
  "items": [{
    "email": "...",
    "engagement": {
      "sent": true/false,
      "opened": true/false,
      "clicked": true/false,
      "replied": true/false
    }
  }]
}
```

Currently, the system uses the V1 endpoint which only returns boolean flags for `replied`, `opened`, `bounced`, `clicked`, but **not** `sent`.

## Solution

### Part 1: Switch to V3 Extended Contacts Endpoint

Migrate from V1 `/campaigns/{id}/people` to V3 `/sequences/{id}/contacts/extended`:

- This endpoint returns per-contact `sent` status
- We can count contacts with `sent: true` to get actual emails sent
- Provides richer engagement data

### Part 2: Calculate "Emails Sent" from Contact Data

Since the V3 Statistics API is unreliable, derive the count from synced contacts:

```text
sent = COUNT of contacts WHERE engagement_data->>'sent' = true
  OR status IN ('finished', 'replied', 'opened', 'bounced')
```

Logic: If a contact has any engagement (opened, replied, bounced, finished), they must have received at least one email.

### Part 3: Ensure All Campaigns Sync Contacts

Add retry logic and better error handling so all 6 campaigns sync their contacts.

## File Changes

| File | Change |
|------|--------|
| `supabase/functions/sync-reply-contacts/index.ts` | Switch to V3 `/sequences/{id}/contacts/extended` endpoint; capture `sent` status per contact |
| `supabase/functions/sync-reply-contacts/index.ts` | Calculate `sent` count from contact engagement data |
| `src/hooks/usePlaygroundStats.ts` | Derive "emails sent" by counting contacts with engagement (sent/opened/replied/finished) |
| `src/hooks/useOutboundIntegrations.ts` | Add retry logic for campaigns that fail to sync contacts |

## Implementation Details

### sync-reply-contacts Changes

```text
1. Change endpoint from:
   /v1/campaigns/{id}/people
   
   To:
   /v3/sequences/{id}/contacts/extended

2. Map V3 response fields:
   - engagement.sent → Calculate sent count
   - engagement.opened → opened flag
   - engagement.replied → replied flag
   - engagement.clicked → clicked flag

3. Update campaign stats:
   sent = COUNT of contacts with (engagement.sent = true OR any engagement)
   delivered = sent (same value)
```

### usePlaygroundStats Changes

```text
Current:
  totalMessagesSent += stats.sent || stats.delivered || 0

New (fallback when sent=0):
  If sent = 0 but peopleCount > 0:
    Calculate sent from contacts with engagement
    sent = contacts with (opened OR replied OR finished OR bounced)
```

### Contact Sync Retry Logic

```text
For each campaign:
  Try sync contacts
  If fails: wait 2 seconds, retry up to 3 times
  If still fails: log error but continue with other campaigns
```

## Expected Outcome

After implementation:

| Metric | Current | Expected |
|--------|---------|----------|
| Total Contacts | 737 | ~1,053 |
| Emails Sent | 0 | ~114 |
| Campaigns with data | 3/6 | 6/6 |

## Alternative Approach (Simpler)

If the V3 extended endpoint also fails, we can use a heuristic:

```text
"Emails Sent" = COUNT of contacts with ANY engagement
  (opened = true OR replied = true OR finished = true OR bounced = true)
```

This undercounts (misses contacts who received but never engaged), but is better than 0.

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| V3 Extended endpoint also returns 404 | Fall back to V1 + heuristic counting |
| Rate limiting during sync | Already have retry with exponential backoff |
| Existing data loss | Merge new data with existing, never overwrite with empty |

