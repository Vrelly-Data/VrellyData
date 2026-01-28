

## Fix Campaign Fetching: Remove Team ID Filter Option

### Problem
Your integration is filtering to team ID `383171`, showing only 62 campaigns. If your Reply.io account has campaigns across multiple teams/workspaces, or if the team discovery is incomplete, you're missing campaigns.

### Solution: Allow "All Campaigns" Option

Give users the ability to fetch campaigns **without** the team filter to see all accessible campaigns.

### Changes Required

**1. Update Edge Function: `fetch-available-campaigns`**

Add an optional `skipTeamFilter` parameter that bypasses the `X-Reply-Team-Id` header:

```typescript
// If user requests all campaigns, don't filter by team
const campaigns = await fetchAllCampaigns(
  apiKey, 
  skipTeamFilter ? undefined : (replyTeamId || undefined)
);
```

**2. Update UI: `ManageCampaignsDialog.tsx`**

Add a toggle or button to "Show all campaigns" that refetches without the team filter:

```text
+-----------------------------------------------------------+
| Manage Campaigns                               [X] Close   |
+-----------------------------------------------------------+
| [Search campaigns...]                                      |
| [✓] Select All  [  ] Deselect All                          |
|                                                            |
| ⚠️ Showing 62 campaigns for team "383171"                  |
| [Show All Campaigns] ← Fetch without team filter           |
+-----------------------------------------------------------+
```

**3. Update Integration Settings: Allow Clearing Team ID**

In `EditIntegrationDialog.tsx`, allow users to clear the Team ID field to disable filtering entirely.

**4. Alternative: Improve Team Discovery**

Update `fetch-reply-teams` to:
- Paginate through ALL sequences (not just 100)
- Also check the V1 `/campaigns` endpoint directly for unique owners
- Provide better visibility into what the API key has access to

### Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/fetch-available-campaigns/index.ts` | Add `skipTeamFilter` option |
| `src/components/playground/ManageCampaignsDialog.tsx` | Add "Show All" toggle/button |
| `src/hooks/useAvailableCampaigns.ts` | Add refetch option with no filter |
| `src/components/playground/EditIntegrationDialog.tsx` | Allow clearing Team ID |

### Alternative Quick Fix

If you want to immediately see all campaigns, you can:
1. Edit your integration and clear the Team ID field (set to empty)
2. Refresh the Manage Campaigns dialog

This will fetch campaigns without the team filter.

### Technical Details

**Current behavior:**
```
GET /v1/campaigns?limit=100&page=1
Headers: X-Reply-Team-Id: 383171  ← Filters to one team
Response: 62 campaigns
```

**Proposed "Show All" behavior:**
```
GET /v1/campaigns?limit=100&page=1
Headers: (no team filter)
Response: All campaigns accessible by API key
```

### Recommended Approach

**Option A: Quick Fix** - Let users clear Team ID in Edit dialog
- Fastest to implement
- User manually controls filtering

**Option B: Toggle in Dialog** - "Show All Campaigns" button
- Better UX
- More explicit about what filtering is happening
- Shows warning about team filter being applied

