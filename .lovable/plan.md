
## Fix LinkedIn Stats Not Showing After Refresh

### Problem Identified

Your LinkedIn metrics (connection requests, connections accepted) are stored in a **different database row** than the one being displayed:

| Campaign | is_linked | LinkedIn Data | Source |
|----------|-----------|---------------|--------|
| HVAC campaign (`e2ffeb62...`) | true | None | Reply.io sync |
| HVAC campaign (`a9caf789...`) | false | 13 sent, 1 accepted | CSV upload |

The dashboard only queries campaigns where `is_linked = true`, so the LinkedIn data from the CSV upload (stored in a separate row) is never retrieved.

### Root Cause

The CSV upload feature creates its own campaign rows with `external_campaign_id` like `csv_import_...` instead of matching and updating existing Reply.io campaigns. This means:
1. LinkedIn stats go into the CSV row (not linked)
2. Reply.io sync refreshes the linked row (no LinkedIn stats)
3. Dashboard queries linked rows only (misses the LinkedIn stats)

---

### Solution

**Merge the LinkedIn stats from CSV import rows into their matching Reply.io campaign rows**, then delete the duplicate CSV rows.

This is a one-time data fix followed by an update to the CSV upload logic to prevent this from happening again.

---

### Implementation

#### Step 1: One-time database migration

Run a SQL migration that:
1. For each CSV-imported campaign with LinkedIn stats, find a matching Reply.io campaign by name
2. Copy the LinkedIn fields from the CSV row to the linked Reply.io row
3. Delete the orphaned CSV import rows

#### Step 2: Update CSV upload logic

Modify the LinkedIn stats CSV upload component to:
1. Match campaigns by name (case-insensitive) first
2. Update existing linked campaigns instead of creating new rows
3. Only create new rows if no match is found

---

### Files to Modify

| File | Purpose |
|------|---------|
| New migration SQL | Merge LinkedIn stats from CSV rows into linked campaigns, then clean up duplicates |
| `src/components/playground/LinkedInStatsUploadDialog.tsx` | Update to match existing linked campaigns by name instead of creating new rows |

---

### Expected Result

After fix:
- HVAC campaign (`is_linked: true`) will have `linkedinConnectionsSent: 13`, `linkedinConnectionsAccepted: 1`
- No more duplicate CSV import rows
- Dashboard will display correct LinkedIn metrics
- Future CSV uploads will update existing campaigns, not create duplicates

---

### Technical Details

**Migration SQL logic:**
```sql
-- Merge LinkedIn stats from CSV rows into matching linked campaigns
UPDATE synced_campaigns target
SET stats = target.stats || jsonb_build_object(
  'linkedinMessagesSent', (source.stats->>'linkedinMessagesSent')::int,
  'linkedinConnectionsSent', (source.stats->>'linkedinConnectionsSent')::int,
  'linkedinConnectionsAccepted', (source.stats->>'linkedinConnectionsAccepted')::int,
  'linkedinReplies', (source.stats->>'linkedinReplies')::int,
  'linkedinDataSource', source.stats->>'linkedinDataSource',
  'linkedinDataUploadedAt', source.stats->>'linkedinDataUploadedAt'
)
FROM synced_campaigns source
WHERE target.is_linked = true
  AND source.is_linked = false
  AND source.external_campaign_id LIKE 'csv_import_%'
  AND lower(trim(target.name)) = lower(trim(source.name))
  AND source.stats->>'linkedinConnectionsSent' IS NOT NULL;

-- Remove duplicate CSV import rows after merge
DELETE FROM synced_campaigns
WHERE is_linked = false
  AND external_campaign_id LIKE 'csv_import_%'
  AND EXISTS (
    SELECT 1 FROM synced_campaigns linked
    WHERE linked.is_linked = true
      AND lower(trim(linked.name)) = lower(trim(synced_campaigns.name))
  );
```
