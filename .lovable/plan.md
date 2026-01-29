

## Fix: Preserve LinkedIn Stats During Reply.io Sync

### Problem Identified
The `sync-reply-campaigns` Edge Function completely **overwrites** the `stats` column when syncing campaigns from Reply.io:

```typescript
// Current code (line 245-256) - OVERWRITES everything
stats: {
  sent: campaign.deliveriesCount || 0,
  delivered: campaign.deliveriesCount || 0,
  replies: campaign.repliesCount || 0,
  // ... NO LinkedIn fields preserved!
}
```

When you sync, the LinkedIn stats uploaded via CSV are completely lost because the sync creates a new `stats` object that only contains email metrics.

### Solution: Merge Stats Instead of Replace

The sync function needs to:
1. **Fetch existing campaign stats** before updating
2. **Preserve LinkedIn-specific fields** that were uploaded via CSV
3. **Only update email-related fields** from the Reply.io API

### Implementation

#### File: `supabase/functions/sync-reply-campaigns/index.ts`

**Step 1: Define which fields come from which source**
```typescript
// LinkedIn fields - preserved from CSV uploads, never overwritten by sync
const LINKEDIN_FIELDS = [
  'linkedinMessagesSent',
  'linkedinConnectionsSent', 
  'linkedinReplies',
  'linkedinConnectionsAccepted',
  'linkedinDataSource',
  'linkedinDataUploadedAt',
];
```

**Step 2: Fetch existing stats before upsert**
```typescript
// Before upserting, fetch existing campaign to preserve LinkedIn stats
const { data: existingCampaign } = await supabase
  .from('synced_campaigns')
  .select('stats')
  .eq('integration_id', integrationId)
  .eq('external_campaign_id', String(campaign.id))
  .maybeSingle();

const existingStats = (existingCampaign?.stats as Record<string, unknown>) || {};
```

**Step 3: Merge stats, preserving LinkedIn data**
```typescript
// Preserve LinkedIn fields from existing stats
const linkedinStats: Record<string, unknown> = {};
for (const field of LINKEDIN_FIELDS) {
  if (existingStats[field] !== undefined) {
    linkedinStats[field] = existingStats[field];
  }
}

// Build merged stats object
const mergedStats = {
  // Email stats from Reply.io API
  sent: campaign.deliveriesCount || 0,
  delivered: campaign.deliveriesCount || 0,
  replies: campaign.repliesCount || 0,
  opens: campaign.opensCount || 0,
  bounces: campaign.bouncesCount || 0,
  optOuts: campaign.optOutsCount || 0,
  peopleCount: campaign.peopleCount || 0,
  peopleActive: campaign.peopleActive || 0,
  peopleFinished: campaign.peopleFinished || 0,
  outOfOffice: campaign.outOfOfficeCount || 0,
  // Preserve LinkedIn stats from CSV upload
  ...linkedinStats,
};
```

### Data Flow After Fix

```text
┌─────────────────────────────────────────────────────────────┐
│                     synced_campaigns.stats                  │
├─────────────────────────────────────────────────────────────┤
│ EMAIL STATS (from Reply.io API sync):                       │
│   sent, delivered, replies, opens, bounces, optOuts,        │
│   peopleCount, peopleActive, peopleFinished, outOfOffice    │
├─────────────────────────────────────────────────────────────┤
│ LINKEDIN STATS (from CSV upload - PRESERVED during sync):   │
│   linkedinMessagesSent, linkedinConnectionsSent,            │
│   linkedinReplies, linkedinConnectionsAccepted,             │
│   linkedinDataSource, linkedinDataUploadedAt                │
└─────────────────────────────────────────────────────────────┘
```

### Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/sync-reply-campaigns/index.ts` | Fetch existing campaign stats before upsert, preserve LinkedIn fields during merge |

### Expected Result

After this fix:
1. **Sync** → Updates email stats (sent, delivered, replies, etc.) from Reply.io API
2. **LinkedIn Upload** → Updates LinkedIn stats (connections, messages, etc.) from CSV
3. **Sync again** → Email stats updated, **LinkedIn stats preserved**

Both data sources can coexist peacefully in the same `stats` column.

