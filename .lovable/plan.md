

# Fix Email Stats Being Overwritten by Campaign Sync

## Root Cause

The email stats you uploaded yesterday (72 delivered for Plumbing, 42 delivered for HVAC) were correctly saved to the database. However, when the campaign sync ran ~5 minutes later, it **overwrote those values with zeros** from the Reply.io API.

Two compounding issues:

1. **Duplicate campaign rows** still exist (the earlier cleanup didn't remove them because both rows have contacts). The sync picks one row, the upload writes to another, causing data to get lost.

2. **The sync function doesn't preserve email upload data.** It preserves LinkedIn upload fields but has no equivalent protection for email upload fields like `sent`, `delivered`, `replies`, `emailDataSource`, `emailDataUploadedAt`.

## Fix

### 1. Preserve Email Upload Fields in Campaign Sync
**File:** `supabase/functions/sync-reply-campaigns/index.ts`

Add email CSV upload fields to the preservation list (same pattern as LinkedIn):

```text
EMAIL_UPLOAD_FIELDS = [
  'emailDataSource',
  'emailDataUploadedAt',
  'opens',        // only from CSV upload
  'clicked',      // only from CSV upload  
  'outOfOffice',
  'optedOut',
  'interested',
  'notInterested',
  'autoReplied',
]
```

When the API returns 0 for `sent`/`delivered`/`replies` but the existing stats have email upload data (`emailDataSource === 'csv_upload'`), prefer the existing uploaded values. This ensures manually uploaded data is never silently wiped by a sync that returns empty API results.

### 2. Merge Duplicate Campaign Rows
**Database cleanup (one-time):**

For each set of duplicates (same `external_campaign_id` + `team_id`):
- Pick the row that has the email upload data (or the oldest if neither has it)
- Move all contacts from the other row to the chosen one
- Delete the empty duplicate

This affects:
- Plumbing Campaign: merge `d1121832` into `d46b41a2` (which has email data)
- HVAC campaign: merge `d7ddcc9d` into `56abc8b4` (which has email data)

### 3. Add Unique Constraint
**Database migration:**

Add a unique constraint on `(team_id, external_campaign_id)` to prevent future duplicates at the database level.

## Files to Change

| File | Change |
|------|--------|
| `supabase/functions/sync-reply-campaigns/index.ts` | Add email upload field preservation, prefer uploaded values over API zeros |
| Database (one-time SQL) | Merge duplicate contacts and delete extra rows |
| Database (migration) | Add unique constraint on `(team_id, external_campaign_id)` |

## Expected Result

After these changes:
- Re-uploading the email CSV will persist correctly
- Running a sync afterward will NOT overwrite the uploaded stats
- No more duplicate campaign rows will be created
- Dashboard will show: 114 emails delivered, 2 replies (matching your CSV totals)

