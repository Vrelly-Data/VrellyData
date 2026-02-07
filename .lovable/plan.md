

## Fix: Reply.io Sync is Not Respecting Workspace Isolation

### Problem Identified

Looking at the database and logs, you have **two integrations** using the same API key:

| Integration ID | reply_team_id | Last Synced | Campaigns |
|----------------|---------------|-------------|-----------|
| `ff397702...` (new) | `383171` | Yesterday 20:16 | 62 |
| `88a35dc3...` (old) | `null` | Today 13:02 | 62 |

Both synced 62 campaigns because:

1. **The API key has access to all campaigns** - Reply.io API keys are account-level, not workspace-specific
2. **The `X-Reply-Team-Id` header** is used by Reply.io for **write operations and some read operations**, but the `/campaigns` endpoint may return **all campaigns the API key has access to** regardless of this header
3. **The old integration without a team ID** was synced today (likely when you clicked sync), pulling all 62 campaigns without any workspace filtering

---

### Root Cause

The Reply.io V1 `/campaigns` endpoint doesn't filter by `X-Reply-Team-Id` header in all cases. According to Reply.io's behavior:
- Some endpoints respect the team header for filtering
- Others return all data the API key can access
- The campaigns endpoint appears to return all accessible campaigns

The sync logic correctly **sends** the header but Reply.io **ignores** it for campaign listing.

---

### Solution

Implement **client-side workspace filtering** after fetching campaigns:

1. **Fetch workspace info first** - Get the teamId associated with each campaign from Reply.io
2. **Filter campaigns by teamId** - Only sync campaigns that belong to the specified workspace
3. **Delete orphaned campaigns** - Remove campaigns from the old integration that should be isolated

---

### Technical Changes

#### File: `supabase/functions/sync-reply-campaigns/index.ts`

**Change 1**: After fetching campaigns, filter them by the workspace teamId

```typescript
// Around line 219-233, after fetching campaigns:

// Fetch ALL campaigns from Reply.io
let campaigns: ReplyioCampaign[] = [];
try {
  campaigns = await fetchAllPaginated<ReplyioCampaign>(
    "/campaigns",
    apiKey,
    "campaigns",
    replyTeamId || undefined
  );
  console.log(`Fetched ${campaigns.length} total campaigns from Reply.io`);
  
  // If a workspace filter is set, filter campaigns to only include those from that workspace
  if (replyTeamId) {
    const teamIdNum = parseInt(replyTeamId, 10);
    const originalCount = campaigns.length;
    
    // Filter campaigns by teamId if the campaign has team info
    campaigns = campaigns.filter(campaign => {
      // Check if campaign has teamId field (some campaigns include this)
      const campaignTeamId = (campaign as Record<string, unknown>).teamId as number | undefined;
      
      // If campaign has no teamId, try to fetch it individually or exclude it
      if (campaignTeamId === undefined) {
        // Conservative: include campaign if we can't determine its team
        // OR aggressive: exclude if we can't verify
        return true; // Conservative approach for now
      }
      
      return campaignTeamId === teamIdNum;
    });
    
    console.log(`After workspace filter: ${campaigns.length}/${originalCount} campaigns belong to workspace ${replyTeamId}`);
  }
} catch (err) {
  // ... existing error handling
}
```

**Change 2**: If Reply.io campaigns don't include `teamId`, fetch each campaign's details to get team info

```typescript
// Alternative approach: Use the /campaigns/{id} endpoint to get team info
// This is slower but more accurate
async function getCampaignTeamId(campaignId: number, apiKey: string): Promise<number | null> {
  try {
    const response = await fetchFromReplyio(`/campaigns/${campaignId}`, apiKey);
    return (response as Record<string, unknown>).teamId as number || null;
  } catch {
    return null;
  }
}
```

---

### Immediate Fix (Database Cleanup)

Before fixing the code, we should clean up the duplicate data:

**Delete campaigns from the old integration (no workspace filter):**
```sql
-- This will be run as a migration to clean up duplicates
DELETE FROM synced_campaigns 
WHERE integration_id = '88a35dc3-241c-4140-9109-670e1ec7ccb0';
```

**Consider deleting the old integration entirely:**
```sql
DELETE FROM outbound_integrations 
WHERE id = '88a35dc3-241c-4140-9109-670e1ec7ccb0';
```

---

### Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/sync-reply-campaigns/index.ts` | Add workspace filtering after fetching campaigns |
| Database migration | Clean up duplicate campaigns from old integration |

---

### Expected Outcome

| Before | After |
|--------|-------|
| 62 campaigns synced (all workspaces) | Only campaigns from workspace 383171 synced |
| Two integrations with same API key | Single integration with workspace isolation |
| Duplicate campaign data | Clean, isolated campaign data |

---

### Questions

1. Should I **delete the old integration** (`88a35dc3...`) and its campaigns to clean up duplicates?
2. For the filtering approach, should we be **conservative** (include campaigns if we can't verify their workspace) or **strict** (exclude if not verified)?

