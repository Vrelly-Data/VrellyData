

## Allow LinkedIn Stats Upload Without Prior Sync

### The Problem
Currently, the LinkedIn Stats Upload feature requires campaigns to already exist in the `synced_campaigns` table. Since the sync is stuck in "pending" and no campaigns exist, the Import button is disabled (`matchedCount === 0`).

### Solution
Modify the upload flow to **create campaigns from CSV data** if they don't already exist. This removes the dependency on Reply.io sync for importing historical LinkedIn stats.

### Changes Required

#### 1. Update `useLinkedInStatsUpload.ts`

**Current behavior**: Only updates campaigns that are matched (already exist in DB)
**New behavior**: Creates new campaigns from CSV if they don't exist

```typescript
// For unmatched campaigns, create them in synced_campaigns
for (const stat of stats) {
  if (!stat.matched) {
    // Create new campaign with LinkedIn stats
    const { data: newCampaign, error } = await supabase
      .from('synced_campaigns')
      .insert({
        team_id: userTeamId,
        integration_id: integrationId, // Could be null for manual imports
        external_campaign_id: `csv_import_${stat.campaignName}`,
        name: stat.campaignName,
        status: 'imported',
        stats: {
          linkedinMessagesSent: stat.linkedinMessagesSent,
          linkedinConnectionsSent: stat.linkedinConnectionsSent,
          linkedinReplies: stat.linkedinReplies,
          linkedinConnectionsAccepted: stat.linkedinConnectionsAccepted,
          linkedinDataSource: 'csv_upload',
          linkedinDataUploadedAt: new Date().toISOString(),
        },
      })
      .select()
      .single();
  }
}
```

#### 2. Update `LinkedInStatsUploadDialog.tsx`

**Current behavior**: 
- Import button disabled when `matchedCount === 0`
- Shows "matched" vs "not found" status

**New behavior**:
- Import button enabled if ANY campaigns exist in CSV
- Shows "will update" vs "will create" status
- All campaigns are importable

```typescript
// Change button logic
<Button 
  onClick={handleImport} 
  disabled={parsedStats.length === 0}  // Enable if any stats parsed
>
  Import {parsedStats.length} Campaign{parsedStats.length !== 1 ? 's' : ''}
</Button>
```

**Updated UI indicators**:
- Green check: "Will update existing campaign"
- Blue plus: "Will create new campaign"

#### 3. Handle Integration ID

Since users may upload LinkedIn stats before connecting an integration:

| Scenario | `integration_id` Value |
|----------|------------------------|
| Integration exists | Use existing integration ID |
| No integration | Use `null` or create placeholder |

**Approach**: Query for any existing Reply.io integration and use its ID, otherwise allow `null`.

### Files to Modify

| File | Changes |
|------|---------|
| `src/hooks/useLinkedInStatsUpload.ts` | Add logic to create campaigns for unmatched rows |
| `src/components/playground/LinkedInStatsUploadDialog.tsx` | Update button logic and status indicators |

### Database Consideration

The `synced_campaigns` table has these required columns:
- `integration_id` - NOT NULL constraint (need to check)
- `external_campaign_id` - NOT NULL 
- `name` - NOT NULL
- `team_id` - NOT NULL

If `integration_id` is required, we'll need to either:
1. Make it nullable via migration
2. Create a placeholder integration for manual imports
3. Require at least one integration to exist first

### Updated User Flow

1. User uploads Reply.io action report CSV
2. Parser aggregates actions by campaign
3. Preview shows:
   - "Campaign A (will update)" - already exists
   - "Campaign B (will create)" - doesn't exist yet
4. User clicks Import
5. System:
   - Updates existing campaigns with new stats
   - Creates new campaigns for unmatched rows
6. Dashboard shows all LinkedIn metrics

### Technical Notes

**Campaign Matching** (unchanged):
- Case-insensitive name matching
- Exact match required (no fuzzy matching)

**Stats Aggregation** (unchanged):
- Action counts remain additive
- Same action mappings apply

**New Campaign Defaults**:
```typescript
{
  name: campaignName,
  status: 'imported',  // Distinguish from synced campaigns
  external_campaign_id: `csv_${Date.now()}_${campaignName}`,
  stats: { ...linkedinMetrics }
}
```

