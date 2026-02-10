

# Change "Campaigns" to "Results" in Email Stats Upload

Two small text changes needed:

## 1. Dialog Button Text
**File:** `src/components/playground/EmailStatsUploadDialog.tsx` (line 308)
- Change: `Import {matchedCount} Campaign(s)` 
- To: `Import {matchedCount} Result(s)`

## 2. Toast Notification Text
**File:** `src/hooks/useEmailStatsUpload.ts` (line 171)
- Change: `` `Updated ${updatedCount} campaign(s)` ``
- To: `` `Updated ${updatedCount} result(s)` ``

---

Additionally, you mentioned that the import "doesn't actually update the dashboard." I'd like to investigate that after making these text changes -- it may be a separate issue with how the stats are being matched or merged. We can debug that once you re-upload after the fix.

