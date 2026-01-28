

## Add Team Dropdown to Edit Integration Dialog

### The Problem
When editing an existing Reply.io integration, you can only manually type a Team ID. There's no dropdown to select from available teams like there is when adding a new integration.

### The Solution
Create a new edge function that fetches teams using the stored API key, then update the Edit dialog to show a dropdown.

### Implementation

#### 1. New Edge Function: `fetch-integration-teams`
This function takes an `integrationId`, retrieves the stored API key from the database, and calls `fetch-reply-teams` logic internally.

**Location:** `supabase/functions/fetch-integration-teams/index.ts`

```text
Request: { integrationId: "uuid" }
Response: { teams: [{ id: number, name: string }], isAgencyAccount: boolean }
```

**Flow:**
1. Authenticate user via JWT
2. Fetch integration from DB (includes encrypted API key)
3. Call Reply.io API endpoints to discover teams
4. Return teams list

#### 2. Update `EditIntegrationDialog.tsx`
- Add "Load Teams" button that calls the new edge function
- Show dropdown when teams are loaded
- Keep manual input as fallback if team discovery fails
- Show loading state while fetching

**New UI flow:**
1. User opens Edit dialog
2. User clicks "Load Teams" button
3. Teams load into dropdown
4. User selects a team and saves

### Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/fetch-integration-teams/index.ts` | NEW - Edge function to fetch teams using stored API key |
| `supabase/config.toml` | Add config for new function |
| `src/components/playground/EditIntegrationDialog.tsx` | Add teams dropdown with "Load Teams" button |

### Technical Details

**Edge Function Auth:**
```typescript
// Get integration with API key (requires auth)
const { data: integration } = await supabaseClient
  .from('outbound_integrations')
  .select('id, api_key_encrypted, platform')
  .eq('id', integrationId)
  .single();

// Use API key to fetch teams from Reply.io
const teams = await fetchTeamsFromReplyIO(integration.api_key_encrypted);
```

**Updated Dialog UI:**
- "Load Teams" button appears next to the Team ID field
- When clicked, shows loading spinner
- On success, shows dropdown with available teams
- On failure, shows error toast and keeps manual input

### Why This Approach?
- **Security:** API key stays server-side, never exposed to client
- **Reuses existing logic:** Same team discovery logic as `fetch-reply-teams`
- **Fallback:** Manual input still available if API discovery fails
- **User-friendly:** No need to look up Team IDs in Reply.io dashboard

