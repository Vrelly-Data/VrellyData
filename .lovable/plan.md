
# Fix: Aggregate Contact-Level CSV Rows Before Updating Campaign Stats

## Problem

The Reply.io CSV export has one row per contact (164 rows), not one row per campaign. The current code updates the database for every single row, so the last contact's values (typically `delivered: 1`) overwrite all previous ones. This is why "Total Messages Sent" and "Total Replies" show near-zero despite uploading 164 rows.

## Changes

### 1. Aggregate rows in the upload hook
**File:** `src/hooks/useEmailStatsUpload.ts`

Before the database write loop, group all `EmailStatsRow` entries by their matched campaign ID and sum all numeric metrics (`delivered`, `replies`, `opens`, `clicked`, `bounced`, `outOfOffice`, `optedOut`, `interested`, `notInterested`, `autoReplied`). Then perform one database update per campaign with the aggregated totals.

### 2. Aggregate rows in the dialog preview
**File:** `src/components/playground/EmailStatsUploadDialog.tsx`

After CSV parsing, group rows by campaign name and sum metrics. The preview table will show one row per campaign with totals (e.g., "Plumbing - 72 delivered") instead of 164 individual contact rows. The button will say "Import 2 Result(s)" instead of "Import 164 Result(s)".

## Technical Details

**Aggregation logic (useEmailStatsUpload.ts):**
- Build a `Map<string, AggregatedStats>` keyed by campaign ID
- For each `EmailStatsRow`, look up or create the entry and add numeric fields
- Iterate the map instead of the raw array when performing DB updates

**Dialog aggregation (EmailStatsUploadDialog.tsx):**
- After parsing, reduce rows into a `Map<string, EmailStatsRow>` keyed by campaign name
- Convert back to array for display
- `matchedCount` reflects unique matched campaigns, not individual contacts

## Expected Result

| Metric | Before | After |
|--------|--------|-------|
| Preview rows shown | 164 contacts | 2 campaigns |
| Button text | Import 164 Result(s) | Import 2 Result(s) |
| Plumbing delivered | 1 | 72 |
| HVAC delivered | 1 | 42 |
| Total Messages Sent | ~2 | 114+ |
| Total Replies | ~0 | actual reply count |
