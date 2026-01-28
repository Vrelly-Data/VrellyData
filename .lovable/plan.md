

## Test with Single Client First

### Current Situation
Your integration has `reply_team_id = null`, which means it tries to sync all 62 campaigns across all clients. This causes timeouts.

### Two-Step Testing Plan

#### Step 1: Reset Stuck Status and Set Team ID (Manual)
First, we need to:
1. **Reset the stuck "syncing" status** in the database
2. **Set a specific Team ID** for your integration to isolate to one client

**Database update to run:**
```sql
UPDATE outbound_integrations 
SET sync_status = 'pending',
    sync_error = NULL,
    updated_at = NOW()
WHERE id = 'ac749820-fa6d-4a85-8955-039d328bec97';
```

Then use the **Edit button** (pencil icon) in the UI to set your Team ID.

#### Step 2: Find Your Reply.io Team ID
To get the Team ID for your test client, you can either:
- **Option A**: Check Reply.io dashboard → Settings → Agency/Clients → Copy the client's team ID
- **Option B**: After resetting, I can call the `fetch-reply-teams` edge function to list available teams from your API key

### What This Fixes
With a Team ID set, the sync will:
- Only fetch campaigns for that specific client (maybe 5-10 instead of 62)
- Complete within the timeout window
- Allow proper testing before we optimize for all clients

### Files to Modify

| File | Change |
|------|--------|
| Database | Reset `sync_status` to `pending` for your integration |
| UI (manual) | Enter Team ID via Edit dialog |

### After Testing Works
Once single-client sync works reliably, we can:
1. Add the "Reset Stuck Sync" button for self-service recovery
2. Optimize the edge function for handling many campaigns (campaigns-only mode)
3. Consider separate integrations per client if needed

