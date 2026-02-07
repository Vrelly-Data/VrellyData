
## Fix: Dashboard Not Updating After Sync

### Root Cause Analysis

I investigated the edge function logs and database state. Here's what I found:

**The sync IS working** - campaigns and contacts are being saved:
- 6 campaigns synced to your team
- 1,053 contacts synced across all campaigns
- All campaigns are `is_linked: true`

**But stats are empty** (`stats: map[]`):
```
Could not fetch stats for campaign 1606195: Error: Reply.io V1 API error (404)
Could not fetch stats for campaign 1606099: Error: Reply.io V1 API error (404)
... (all 6 campaigns returning 404)
```

**Why 404?** The current code tries to fetch stats from the **V1 `/campaigns/{id}` endpoint**, but these are **V3 sequences** - they have a different API structure. Reply.io's V1 campaign endpoint doesn't recognize V3 sequence IDs.

**Additionally**, the sync status is stuck at `syncing` instead of `synced` - likely due to a timeout during the long contact sync (1,053 contacts with rate limiting).

---

### Solution

Use Reply.io's **V3 Statistics API** which provides sequence-level stats:

```text
GET /v3/statistics/sequences/{sequenceId}

Response:
{
  "sequenceId": 123,
  "sequenceName": "Welcome Sequence",
  "deliveredContacts": 50,      // Total contacts delivered to
  "repliedContacts": 5,         // Contacts who replied
  "interestedContacts": 5,      // Interested responses
  "replyRate": 12,              // Reply rate percentage
  "deliveryRate": 98,           // Delivery success rate
  "interestedRate": 4           // Interest rate percentage
}
```

---

### Technical Changes

#### 1. Update Stats Fetching to V3 Endpoint

**File**: `supabase/functions/sync-reply-campaigns/index.ts`

Replace the V1 stats function with V3:

```typescript
// BEFORE (broken):
async function fetchCampaignStats(campaignId, apiKey, teamId) {
  const data = await fetchWithRetryV1(`/campaigns/${campaignId}`, apiKey, teamId);
  return {
    sent: data.deliveriesCount || 0,  // V1 fields don't exist for V3 sequences
    ...
  };
}

// AFTER (fixed):
async function fetchSequenceStats(sequenceId, apiKey, teamId) {
  const data = await fetchWithRetryV3(`/statistics/sequences/${sequenceId}`, apiKey, teamId);
  return {
    sent: data.deliveredContacts || 0,
    delivered: data.deliveredContacts || 0,
    replies: data.repliedContacts || 0,
    replyRate: data.replyRate || 0,
    deliveryRate: data.deliveryRate || 0,
    interestedContacts: data.interestedContacts || 0,
    // Map to our normalized stats format
  };
}
```

#### 2. Update Stats Field Mapping

Map V3 statistics response fields to our normalized `stats` JSONB structure:

| V3 Statistics Field | Our Stats Field | Dashboard Usage |
|---------------------|-----------------|-----------------|
| `deliveredContacts` | `sent` / `delivered` | "Total Messages Sent" |
| `repliedContacts` | `replies` | "Total Replies" |
| `replyRate` | `replyRate` | Reply rate display |
| (from contacts sync) | `peopleCount` | "Total Contacts" |

#### 3. Fix Sync Status Update

Ensure the sync status updates to `synced` even if some API calls fail or timeout:

```typescript
// Update to 'synced' even with partial failures
const finalStatus = campaignsFailed > 0 && campaignsProcessed === 0 ? "error" : "synced";

await supabase
  .from("outbound_integrations")
  .update({
    sync_status: finalStatus,
    sync_error: campaignsFailed > 0 ? `${campaignsProcessed}/${total} synced` : null,
    last_synced_at: new Date().toISOString(),
  })
  .eq("id", integrationId);
```

#### 4. Add peopleCount from Contact Sync

Since the V3 statistics endpoint doesn't return total people count, derive it from the contacts we sync:

```typescript
// After syncing contacts for a campaign, update the campaign stats with peopleCount
const contactsResult = await syncContactsForCampaign(...);
if (contactsResult.count > 0) {
  await supabase
    .from("synced_campaigns")
    .update({ 
      stats: { 
        ...existingStats, 
        peopleCount: contactsResult.count 
      } 
    })
    .eq("id", campaignId);
}
```

---

### Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/sync-reply-campaigns/index.ts` | Switch stats fetch from V1 `/campaigns/{id}` to V3 `/statistics/sequences/{sequenceId}`, update field mapping, ensure sync status completion |

---

### Expected Outcome

| Before | After |
|--------|-------|
| V1 stats fetch returns 404 | V3 stats fetch succeeds |
| `stats: {}` (empty) | `stats: { sent: 50, replies: 5, ... }` |
| Dashboard shows all 0s | Dashboard shows actual engagement data |
| Sync stuck at "syncing" | Sync completes to "synced" |

---

### Execution Steps

1. Update the `fetchCampaignStats` function to use V3 statistics endpoint
2. Map V3 response fields to our normalized stats structure
3. Ensure sync status updates properly on completion
4. Deploy the updated edge function
5. Trigger a fresh sync to populate stats
