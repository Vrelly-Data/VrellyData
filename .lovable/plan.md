

## Improve Team Detection During API Key Validation

### Current Problem
When you click "Test Connection" in the Add Integration dialog:
1. API key validation passes ✅
2. Team discovery runs but returns empty because dedicated endpoints (`/emailAccounts`, `/teams`, `/agency/clients`) don't return team data for your account type
3. Result: Agency account is NOT detected, so you can save without selecting a team
4. Later sync times out because it tries to process 62+ campaigns across all clients

### The Solution
Add campaign-based team extraction as a fallback in `fetch-reply-teams` (used during Add Integration). This extracts unique teams from the first page of campaigns.

**User Experience After Fix:**
- Normal user (5-20 campaigns): Validation passes, no teams found → saves normally → sync works
- Agency user (60+ campaigns across clients): Validation passes, teams ARE detected → must select a team → saves with team ID → sync only fetches that client's campaigns → works

### Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/fetch-reply-teams/index.ts` | Add campaign-based team extraction as fallback method |

### Implementation

**Current flow (lines 136-167):**
```typescript
// Try 4: Extract unique owners from campaigns as fallback
// Currently just LOGS the data but doesn't add to teams list
```

**Updated flow:**
```typescript
// Try 4: Extract unique teams from campaigns (ACTUALLY add them)
const campaignsResponse = await fetch(`${REPLY_API_BASE}/campaigns?limit=100`, ...);
const campaigns = await campaignsResponse.json();

// Extract unique ownerId/ownerName from campaigns
const ownerMap = new Map();
for (const campaign of campaigns) {
  // Reply.io campaigns have ownerId and ownerName fields
  if (campaign.ownerId && !seenTeamIds.has(campaign.ownerId)) {
    seenTeamIds.add(campaign.ownerId);
    ownerMap.set(campaign.ownerId, {
      id: campaign.ownerId,
      name: campaign.ownerName || `User ${campaign.ownerId}`,
    });
  }
}

// Add discovered owners as "teams"
teams.push(...ownerMap.values());
```

### Why This Works

Reply.io campaigns include:
- `ownerId`: The user ID that owns/created the campaign  
- `ownerName`: The display name of that user

For agency accounts, different clients will have different `ownerId` values. By extracting unique owners from the first 100 campaigns, we can build a list of "clients" to choose from.

### Edge Cases

| Scenario | Result |
|----------|--------|
| Single user, 10 campaigns | 1 unique owner → not treated as agency → syncs all |
| Agency, 3 clients, 100 campaigns | 3 unique owners → agency detected → must select one |
| Agency, 1 client active | 1 unique owner → not treated as agency → syncs all (correct) |

### Technical Notes
- Only fetches first page (100 campaigns) to keep validation fast
- No pagination needed - we just need to detect multiple owners
- Same logic should be added to `fetch-integration-teams` for consistency in Edit dialog

