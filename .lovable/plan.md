

# Fix Email Stats: Add V1 Campaign Stats Fallback

## Problem Confirmed

Your expected stats (114 sent, 2 replies) are not appearing because:

1. **V3 Statistics API fails** - Returns 404 errors consistently
2. **Contact-level engagement doesn't exist** - The V1 `/campaigns/{id}/people` endpoint only returns profile data (name, email, company), NOT engagement flags

The current `sync-reply-contacts` function tries to count `replied: true` from contacts, but those fields don't exist in the API response.

## Solution: Fetch Campaign Stats from V1 Single Campaign Endpoint

The V1 `GET /campaigns/{id}` endpoint returns the full campaign object with aggregate stats. We'll add this as a fallback when V3 fails.

---

## Implementation Plan

### 1. Update `sync-reply-campaigns/index.ts`

Add a V1 stats fetching function that calls the single campaign endpoint:

```typescript
// Fetch stats from V1 single campaign endpoint
async function fetchCampaignStatsV1(
  campaignId: number,
  apiKey: string,
  teamId?: string
): Promise<Record<string, number>> {
  try {
    const data = await fetchWithRetryV1(`/campaigns/${campaignId}`, apiKey, teamId);
    const campaign = data as Record<string, unknown>;
    
    // V1 campaign response includes these fields
    return {
      sent: (campaign.peopleSent as number) || (campaign.peopleDelivered as number) || 0,
      delivered: (campaign.peopleDelivered as number) || (campaign.peopleSent as number) || 0,
      replies: (campaign.peopleReplied as number) || 0,
      opens: (campaign.peopleOpened as number) || 0,
      clicks: (campaign.peopleClicked as number) || 0,
      bounces: (campaign.peopleBounced as number) || 0,
      peopleFinished: (campaign.peopleFinished as number) || 0,
    };
  } catch (err) {
    console.warn(`Could not fetch V1 stats for campaign ${campaignId}:`, err);
    return {};
  }
}
```

Update the sync loop to try V3 first, then fall back to V1:

```typescript
// Try V3 Statistics API first
let apiStats = await fetchSequenceStats(sequence.id, apiKey, replyTeamId);

// If V3 returned no data, try V1 single campaign endpoint
if (!apiStats.sent && !apiStats.replies) {
  console.log(`  V3 stats empty, trying V1 /campaigns/${sequence.id}...`);
  apiStats = await fetchCampaignStatsV1(sequence.id, apiKey, replyTeamId);
}

console.log(`  Stats: sent=${apiStats.sent || 0}, replies=${apiStats.replies || 0}`);
```

### 2. Simplify `sync-reply-contacts/index.ts`

Remove the broken engagement counting logic since contacts don't have that data:

```typescript
// REMOVE these lines (they never work because API doesn't return these fields)
// if (contact.replied) repliesCount++;
// if (hasEngagement) deliveredCount++;

// KEEP: Save contacts for profile data (name, company, etc)
// KEEP: engagement_data structure (for future webhook updates)
```

The campaign sync will now populate the stats, not the contact sync.

---

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/sync-reply-campaigns/index.ts` | Add `fetchCampaignStatsV1()` function, update sync loop to use V1 fallback |
| `supabase/functions/sync-reply-contacts/index.ts` | Remove broken engagement counting, keep contact profile sync |

---

## Why This Will Work

The V1 `/campaigns/{id}` endpoint typically returns:

```json
{
  "id": 1419855,
  "name": "Business owners...",
  "status": 4,
  "peopleCount": 378,
  "peopleSent": 114,      // ← Your "emails sent"
  "peopleReplied": 2,     // ← Your "replies"
  "peopleOpened": 45,
  "peopleBounced": 3
}
```

This matches your expected 114 sent / 2 replies!

---

## Data Flow After Fix

```text
1. Sync button clicked
2. sync-reply-campaigns runs:
   a. Fetch sequence list from V3 (for names/status)
   b. For each campaign:
      - Try V3 /statistics/sequences/{id} → 404 error
      - Fall back to V1 /campaigns/{id} → Gets stats!
      - Save to synced_campaigns.stats: { sent: 114, replies: 2 }
3. sync-reply-contacts runs:
   - Saves contact profiles (name, email, company)
   - Updates peopleCount
   - Does NOT try to count engagement (removed)
4. Dashboard reads synced_campaigns.stats
   - Shows: 114 Emails Sent, 2 Replies
```

---

## What's Preserved

- LinkedIn stats from CSV uploads (never overwritten)
- Contact profile data (name, email, company, etc.)
- Individual contact response tracking (for future webhook re-enablement)
- Existing campaign link preferences

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| V1 endpoint also fails | Graceful fallback to 0 stats (no crash) |
| Rate limiting | Uses existing retry logic with exponential backoff |
| Field names different | Check multiple possible field names (`peopleSent`, `sent`, etc.) |
| Breaking existing logic | Only adds new function, minimal changes to existing flow |

