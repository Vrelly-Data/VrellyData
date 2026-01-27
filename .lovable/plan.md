
## Fix "Syncing" Status Getting Stuck

### Root Cause
The `sync-reply-campaigns` edge function encountered a Reply.io rate limit error while processing campaign 16 of 62. When this error occurred:
1. The function threw an exception
2. The catch block attempted to update `sync_status` to `"error"`
3. But this update appears to have failed, leaving the status stuck at `"syncing"`

Meanwhile, **17 campaigns were successfully synced** before the error, so the data is partially populated.

### Solution Overview
Two improvements are needed:
1. **Immediate Fix**: Manually reset the stuck integration status so the UI reflects reality
2. **Code Improvement**: Make the edge function more resilient so individual campaign failures don't crash the entire sync

### Changes Required

#### 1. Reset Stuck Integration Status (Database Fix)
Run a query to update the stuck integration:
```sql
UPDATE outbound_integrations 
SET sync_status = 'synced', 
    sync_error = NULL,
    last_synced_at = NOW()
WHERE sync_status = 'syncing';
```

#### 2. Improve Edge Function Error Handling
Update `supabase/functions/sync-reply-campaigns/index.ts` to:
- Continue processing other campaigns when one fails (don't throw on rate limit)
- Track partial success/failure counts
- Always update the status at the end (even with partial failures)

**Key changes:**
```typescript
// Instead of throwing on rate limit errors during people fetch:
} catch (error) {
  console.error(`Failed to fetch people for campaign ${campaign.id}:`, error);
  // Continue to next campaign instead of throwing
}

// At the end, mark as "synced" even if some campaigns had errors
// (or use a new status like "partial" if you prefer)
```

#### 3. UI Improvement (Optional)
Add a "Reset" button or auto-recovery in `IntegrationSetupCard.tsx` to handle stuck syncing states:
- After X minutes of "syncing", show a warning
- Allow manual reset to "pending" status

### Files to Modify

| File | Changes |
|------|---------|
| Database (manual) | Reset stuck `sync_status` from `syncing` to `synced` |
| `supabase/functions/sync-reply-campaigns/index.ts` | Wrap individual campaign processing in try-catch, continue on failure |
| `src/components/playground/IntegrationSetupCard.tsx` (optional) | Add stuck state detection and reset button |

### Why This Happened
The Reply.io API has strict rate limits (1 request per 10 seconds for some endpoints). The function has retry logic, but when retries are exhausted on the `people` endpoint, it throws an error that bubbles up and crashes the sync.

The sync function at line 410-411 shows:
```typescript
} catch (error) {
  console.error(`Failed to fetch people for campaign ${campaign.id}:`, error);
}
```

This SHOULD just log and continue, but the earlier `fetchAllPaginated` call (line 360) uses `fetchFromReplyio` directly without the `fetchWithRetry` wrapper, so rate limit errors aren't caught properly.

### Immediate User Experience Fix
After resetting the database status, the UI will show "Synced" and display the 17 campaigns that were successfully imported. The user can then re-sync later to get the remaining campaigns, or simply upload LinkedIn stats via CSV for any missing campaigns.
