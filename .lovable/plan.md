
## Fix: Dashboard Empty After Sync + UX for Auto-Sync on Connect

### Problems Identified

**Problem 1: Dashboard shows no data after sync**

The recent sync processed 6 sequences successfully (confirmed in logs):
```
V3 sync complete: 6/6 sequences processed
```

However, **no data appears on your dashboard** because:

1. **Your user's team_id is `71f2f8c5-9375-4633-a445-17143e898600`**
2. **The synced campaigns are in team_id `8bc0455e-121a-4c87-adb7-d2f787a270d8`**

The integration was created by a different user (ID ending in `...1b5a`), so the campaigns are isolated to their team. RLS policies correctly block cross-team data access.

Your integration (`0605651a-c008-4119-b445-dd02772534ec`) exists in your team but has **0 campaigns** synced because the V3 API migration happened after your last sync.

**Problem 2: V3 API doesn't include stats**

The Reply.io V3 `/sequences` endpoint returns campaign metadata but **NOT** engagement stats (sent, replies, opens, etc.). The current sync function preserves existing stats but doesn't populate them for newly synced campaigns, resulting in all-zero dashboard metrics.

**Problem 3: User must manually click Sync after connecting**

When a user connects a new integration:
1. The integration is created with `sync_status: 'pending'`
2. No automatic sync is triggered
3. User sees "Pending" badge but must manually click "Sync"

---

### Solution Overview

| Change | Description |
|--------|-------------|
| **Auto-sync on connect** | Trigger sync immediately after integration is created |
| **Sync campaigns + contacts** | After syncing campaigns, also sync contacts for all linked campaigns |
| **Auto-link all campaigns** | New campaigns are `is_linked: true` by default (already implemented) |
| **Baseline stats from V1** | Use V1 API `/campaigns/{id}` endpoint to fetch stats for each sequence |
| **Re-sync your integration** | Trigger sync for your team's integration to populate data |

---

### Technical Changes

#### 1. Auto-Sync on Connect

**File**: `src/hooks/useOutboundIntegrations.ts`

Modify `addIntegration` mutation to automatically trigger a sync after successfully creating the integration:

```typescript
// After creating integration, trigger immediate sync
onSuccess: async (data) => {
  queryClient.invalidateQueries({ queryKey: ['outbound-integrations'] });
  toast.success('Integration added - syncing campaigns...');
  
  // Trigger automatic sync
  if (data?.id) {
    try {
      await supabase.functions.invoke('sync-reply-campaigns', {
        body: { integrationId: data.id },
      });
      queryClient.invalidateQueries({ queryKey: ['playground-stats'] });
      queryClient.invalidateQueries({ queryKey: ['synced-campaigns'] });
    } catch (err) {
      console.error('Auto-sync failed:', err);
    }
  }
}
```

#### 2. Fetch Stats from V1 API

**File**: `supabase/functions/sync-reply-campaigns/index.ts`

The V3 sequences endpoint doesn't include stats. Add a function to fetch stats from V1 API for each sequence:

```typescript
// Add V1 API base for stats fetching
const REPLY_API_V1 = "https://api.reply.io/v1";

async function fetchCampaignStats(campaignId: number, apiKey: string, teamId?: string): Promise<Record<string, number>> {
  const headers: Record<string, string> = {
    "X-Api-Key": apiKey,
    "Content-Type": "application/json",
  };
  if (teamId) headers["X-Reply-Team-Id"] = teamId;
  
  const response = await fetch(`${REPLY_API_V1}/campaigns/${campaignId}`, { headers });
  if (!response.ok) return {};
  
  const data = await response.json();
  return {
    sent: data.deliveriesCount || 0,
    delivered: data.deliveriesCount || 0,
    replies: data.repliesCount || 0,
    opens: data.opensCount || 0,
    bounces: data.bouncesCount || 0,
    optOuts: data.optOutsCount || 0,
    peopleCount: data.peopleCount || 0,
    peopleActive: data.peopleActive || 0,
    peopleFinished: data.peopleFinished || 0,
    outOfOffice: data.outOfOfficeCount || 0,
  };
}
```

Then use this in the sequence processing loop:

```typescript
// Inside the sequence processing loop, before upserting:
let apiStats: Record<string, number> = {};
try {
  apiStats = await fetchCampaignStats(sequence.id, apiKey, replyTeamId || undefined);
  console.log(`Stats for ${sequence.name}: sent=${apiStats.sent}, replies=${apiStats.replies}`);
} catch (err) {
  console.warn(`Could not fetch stats for sequence ${sequence.id}:`, err);
}

// Merge API stats with existing LinkedIn stats (from CSV)
const mergedStats = {
  ...apiStats,
  ...linkedinStats,  // Preserve LinkedIn stats from CSV
};
```

#### 3. Sync Contacts After Campaigns

**File**: `supabase/functions/sync-reply-campaigns/index.ts`

After syncing all campaigns, trigger contact sync for each linked campaign:

```typescript
// After the campaign processing loop, sync contacts for linked campaigns
console.log(`Starting contacts sync for ${campaignsProcessed} campaigns...`);
let contactsSynced = 0;

for (const sequence of sequences) {
  try {
    // Get the campaign ID from database
    const { data: campaign } = await supabase
      .from("synced_campaigns")
      .select("id")
      .eq("integration_id", integrationId)
      .eq("external_campaign_id", String(sequence.id))
      .single();
    
    if (campaign) {
      // Call contacts sync function (internal call with service role)
      const contactsResult = await syncContactsForCampaign(
        campaign.id, 
        sequence.id, 
        apiKey, 
        teamId, 
        replyTeamId
      );
      contactsSynced += contactsResult.count || 0;
    }
  } catch (err) {
    console.warn(`Failed to sync contacts for sequence ${sequence.id}:`, err);
  }
}
```

Alternatively, to avoid timeout issues, we can make contact syncing asynchronous or trigger it via a separate edge function call.

#### 4. Improve UX Feedback

**File**: `src/components/playground/IntegrationSetupCard.tsx`

Update the "Pending" status to be more descriptive:

```typescript
case 'pending':
  return <Badge variant="outline" className="text-xs animate-pulse">
    Syncing...
  </Badge>;
```

Or show "Click Sync to start" if truly pending:

```typescript
case 'pending':
  return <Badge variant="outline" className="text-xs cursor-pointer">
    Click Sync
  </Badge>;
```

---

### Execution Order

1. **Update `sync-reply-campaigns` function** to fetch baseline stats from V1 API
2. **Modify `useOutboundIntegrations`** to auto-trigger sync on connect
3. **Add contacts sync** to the main sync function (or trigger separately)
4. **Update UI badges** for clearer status indication
5. **Deploy edge function** and test end-to-end

---

### Edge Cases Handled

| Scenario | Handling |
|----------|----------|
| V1 stats API fails | Fall back to existing stats or zeros |
| Contact sync times out | Process campaigns first, contacts are optional |
| Large account (100+ campaigns) | Rate limiting with delays between API calls |
| LinkedIn-only campaigns | Preserve stats from CSV upload |
| Agency accounts | Team filtering ensures workspace isolation |

---

### Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/sync-reply-campaigns/index.ts` | Add V1 stats fetch, optional contacts sync |
| `src/hooks/useOutboundIntegrations.ts` | Auto-sync on successful integration creation |
| `src/components/playground/IntegrationSetupCard.tsx` | Improve pending/syncing state UX |
