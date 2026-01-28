

## Fix Team Detection by Using Reply.io v3 API

### The Problem
The `fetch-reply-teams` function is checking for `ownerId` fields that don't exist in the Reply.io v1 API response. The logs show:

```
Sample campaign fields: [
  "id", "name", "created", "status", "emailAccount", "emailAccounts",
  "ownerEmail", "deliveriesCount", "opensCount", "repliesCount"...
]
Final teams found: 0 []
```

The v1 `/campaigns` endpoint returns `ownerEmail` (a string like `myall@incrementums.org`) but NOT `ownerId` or `ownerName` numbers.

However, the **Reply.io v3 API** (`/v3/sequences`) returns proper `teamId` and `ownerId` fields.

### The Solution
Switch from v1 `/campaigns` to v3 `/sequences` endpoint for team discovery. According to the Reply.io documentation, the v3 sequences endpoint returns:

```json
{
  "items": [
    {
      "id": 12345,
      "teamId": 12345,
      "ownerId": 12345,
      "name": "Sales Outreach",
      "status": "Active"
    }
  ]
}
```

### Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/fetch-reply-teams/index.ts` | Use v3 `/sequences` endpoint to extract `teamId`/`ownerId` properly |

### Implementation Details

**Current code (broken):**
```typescript
const campaignsResponse = await fetch(`${REPLY_API_BASE}/campaigns?limit=100`, ...);
// Looking for campaign.ownerId which doesn't exist in v1 response
const ownerId = campaign.ownerId || campaign.owner_id;
```

**Fixed code:**
```typescript
// Use v3 API which has proper teamId/ownerId fields
const REPLY_API_V3 = "https://api.reply.io/v3";
const sequencesResponse = await fetch(`${REPLY_API_V3}/sequences?limit=100`, ...);

// V3 response has real teamId and ownerId numbers
for (const sequence of sequencesData.items) {
  if (sequence.teamId && !seenTeamIds.has(sequence.teamId)) {
    seenTeamIds.add(sequence.teamId);
    teams.push({
      id: sequence.teamId,
      name: sequence.name || `Team ${sequence.teamId}`,
    });
  }
}
```

### Also Fix the Fallback
Additionally, for v1 compatibility, we should extract unique values from `ownerEmail` as a last-resort fallback (not ideal, but better than nothing):

```typescript
// If v3 fails, fall back to extracting unique ownerEmails
const ownerEmail = campaign.ownerEmail;
if (ownerEmail && !seenEmails.has(ownerEmail)) {
  seenEmails.add(ownerEmail);
  teams.push({
    id: ownerEmail,  // Use email as ID
    name: ownerEmail,
  });
}
```

### Expected Behavior After Fix
1. User clicks "Test Connection"
2. Edge function calls v3 `/sequences` endpoint
3. Extracts unique `teamId` values from the response
4. If multiple teams found, marks `isAgencyAccount = true`
5. User sees team dropdown and must select one before saving
6. Sync only fetches that team's campaigns, staying within time limits

### Why This Will Work
The v3 API is documented to return `teamId` and `ownerId` for every sequence. For your agency account with 62 campaigns across multiple clients, these sequences will have different `teamId` values that we can extract to populate the dropdown.

