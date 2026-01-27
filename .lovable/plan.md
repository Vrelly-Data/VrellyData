

## Fix: Support Reply.io Action-Based CSV Format

### The Problem

The current CSV parser expects this format (aggregated per campaign):
| Campaign Name | LI Messages Sent | LI Connections | LI Replies |
|---------------|------------------|----------------|------------|
| Q1 Outreach   | 500              | 250            | 45         |

But Reply.io exports this format (one row per action):
| Sequence | Action | ... |
|----------|--------|-----|
| Q1 Outreach | Sent auto message | ... |
| Q1 Outreach | Sent auto connection note | ... |
| Q1 Outreach | Replied auto message | ... |

### Solution

Update `LinkedInStatsUploadDialog.tsx` to detect and support BOTH formats:

1. **Format Detection**: Check if the CSV has an "action" column
2. **Action Parsing**: Map action values to LinkedIn metric categories
3. **Aggregation**: Group rows by campaign and count actions per category

### Action Value Mappings

| Action Value (case-insensitive) | Metric |
|---------------------------------|--------|
| `replied auto connection note` | `linkedinReplies` |
| `replied auto message` | `linkedinReplies` |
| `accepted auto connection` | `linkedinConnectionsAccepted` |
| `sent auto connection note` | `linkedinConnectionsSent` |
| `sent auto message` | `linkedinMessagesSent` |

### Implementation Details

#### 1. Add Action Column Detection

```typescript
// New aliases for action-based format
const ACTION_COLUMN_ALIASES = ['action', 'activity', 'step', 'action type'];
const SEQUENCE_NAME_ALIASES = ['sequence', 'sequence name', 'campaign', 'campaign name'];

// Action value to metric mapping
const ACTION_MAPPINGS: Record<string, keyof LinkedInStats> = {
  'replied auto connection note': 'linkedinReplies',
  'replied auto message': 'linkedinReplies',
  'accepted auto connection': 'linkedinConnectionsAccepted',
  'sent auto connection note': 'linkedinConnectionsSent',
  'sent auto message': 'linkedinMessagesSent',
};
```

#### 2. Update Parsing Logic

When an "action" column is detected:
1. Loop through all rows
2. For each row, identify the action type and campaign name
3. Aggregate counts per campaign per metric type
4. Convert aggregated data to the existing `LinkedInStatsRow[]` format

```typescript
// Pseudocode for action-based parsing
const campaignStats = new Map<string, {
  linkedinMessagesSent: number;
  linkedinConnectionsSent: number;
  linkedinReplies: number;
  linkedinConnectionsAccepted: number;
}>();

for (const row of results.data) {
  const campaignName = row[sequenceCol];
  const action = normalizeAction(row[actionCol]);
  const metric = ACTION_MAPPINGS[action];
  
  if (metric && campaignName) {
    const stats = campaignStats.get(campaignName) || { ... };
    stats[metric] += 1;
    campaignStats.set(campaignName, stats);
  }
}
```

#### 3. Update Hook to Support Connection Acceptances

Add `linkedinConnectionsAccepted` to the stats merge in `useLinkedInStatsUpload.ts`.

### Files to Modify

| File | Changes |
|------|---------|
| `src/components/playground/LinkedInStatsUploadDialog.tsx` | Add action-based CSV format detection and parsing |
| `src/hooks/useLinkedInStatsUpload.ts` | Add `linkedinConnectionsAccepted` to the interface and merge logic |

### Updated User Flow

1. User uploads Reply.io action report CSV
2. Parser detects "action" column format
3. Rows are aggregated by campaign:
   - "Q1 Outreach": 50 messages, 30 connections, 12 replies
4. Preview shows aggregated stats per campaign
5. User clicks Import
6. Stats merged into `synced_campaigns.stats`

### Technical Details

#### Format Detection Logic

```typescript
function detectCSVFormat(headers: string[]): 'aggregated' | 'action-based' {
  const hasActionCol = findMatchingColumn(headers, ACTION_COLUMN_ALIASES);
  return hasActionCol ? 'action-based' : 'aggregated';
}
```

#### Action Normalization

```typescript
function normalizeAction(action: unknown): string {
  if (typeof action !== 'string') return '';
  return action.toLowerCase().trim();
}

function getMetricForAction(action: string): keyof LinkedInStats | null {
  const normalized = normalizeAction(action);
  return ACTION_MAPPINGS[normalized] || null;
}
```

#### Aggregation Structure

```typescript
interface AggregatedCampaignStats {
  campaignName: string;
  linkedinMessagesSent: number;
  linkedinConnectionsSent: number;
  linkedinReplies: number;
  linkedinConnectionsAccepted: number;
}

// After parsing, convert Map to array for preview
const stats: LinkedInStatsRow[] = Array.from(campaignStats.entries()).map(
  ([campaignName, metrics]) => ({
    campaignName,
    ...metrics,
    matched: !!campaigns.find(c => c.name.toLowerCase() === campaignName.toLowerCase()),
    campaignId: campaigns.find(c => c.name.toLowerCase() === campaignName.toLowerCase())?.id,
  })
);
```

### Preview Table Update

Add a new column for "Connections Accepted" in the preview table to show all 4 metrics.

### Summary

This update makes the CSV upload support Reply.io's native action-based export format by:
1. Detecting the format automatically (action column vs. aggregated columns)
2. Mapping action values to LinkedIn metric categories
3. Aggregating individual actions into per-campaign totals
4. Displaying and importing the aggregated stats

