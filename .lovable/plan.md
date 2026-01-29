

## Fix: Count Unique People for LinkedIn Reply Stats

### Problem
The current action-based CSV parsing counts **every row** as +1 to the stat. When the same person replies multiple times to a campaign, each reply row adds to the count, inflating the reply total from 14 (unique people who replied) to 40+ (total reply actions).

### Current Logic (Wrong)
```typescript
// Line 215 - increments by 1 for EVERY row
existing[metric] += 1;
```

If Alice replies 3 times in Campaign A:
- Row 1: Campaign A, Replied Auto Connection, alice@email.com → +1
- Row 2: Campaign A, Replied Auto Message, alice@email.com → +1  
- Row 3: Campaign A, Replied Auto Connection, alice@email.com → +1
- **Result: 3 replies counted (wrong)**

### Solution: Deduplicate by Person
Track unique people per campaign per metric type, so each person is only counted once.

### Implementation

#### File: `src/components/playground/LinkedInStatsUploadDialog.tsx`

**Step 1: Add aliases to detect person identifier column**
```typescript
const PERSON_IDENTIFIER_ALIASES = [
  'email', 'contact email', 'person email', 'recipient email',
  'contact', 'person', 'recipient', 'name', 'contact name'
];
```

**Step 2: Change tracking data structure**

Instead of:
```typescript
const campaignStats = new Map<string, AggregatedStats>();
```

Use:
```typescript
// Track unique people per campaign per metric
interface CampaignTracking {
  // Set of person identifiers who performed each action type
  linkedinReplies: Set<string>;
  linkedinConnectionsSent: Set<string>;
  linkedinMessagesSent: Set<string>;
  linkedinConnectionsAccepted: Set<string>;
}
const campaignTracking = new Map<string, CampaignTracking>();
```

**Step 3: Update the parsing loop**
```typescript
for (const row of results.data as Record<string, unknown>[]) {
  const campaignName = String(row[campaignCol] || '').trim();
  if (!campaignName) continue;

  const action = String(row[actionCol] || '').trim();
  if (!action) continue;
  
  // Get person identifier (email or name)
  const personId = personCol 
    ? String(row[personCol] || '').toLowerCase().trim() 
    : `${campaignName}_row_${rowIndex}`; // Fallback: no dedup if no person column
  
  const metric = getMetricForAction(action);
  if (metric) {
    detectedSet.add(action.toLowerCase());
    const existing = campaignTracking.get(campaignName) || createEmptyTracking();
    
    // Only add if not already tracked for this person
    existing[metric].add(personId);
    campaignTracking.set(campaignName, existing);
  } else {
    unrecognizedSet.add(action.toLowerCase());
  }
}
```

**Step 4: Convert Sets to counts at the end**
```typescript
stats = Array.from(campaignTracking.entries()).map(([campaignName, tracking]) => ({
  campaignName,
  linkedinMessagesSent: tracking.linkedinMessagesSent.size,
  linkedinConnectionsSent: tracking.linkedinConnectionsSent.size,
  linkedinReplies: tracking.linkedinReplies.size,
  linkedinConnectionsAccepted: tracking.linkedinConnectionsAccepted.size,
  matched: !!matchedCampaign,
  campaignId: matchedCampaign?.id,
}));
```

### Expected Result

| Metric | Before (Counting Rows) | After (Counting Unique People) |
|--------|------------------------|-------------------------------|
| LinkedIn Replies | 40 | **14** |
| Connection Requests | 561 | 561 (or lower if duplicates) |
| Connection Acceptances | 116 | 116 (or lower if duplicates) |
| Messages Sent | 213 | 213 (or lower if duplicates) |

### Files to Modify

| File | Changes |
|------|---------|
| `src/components/playground/LinkedInStatsUploadDialog.tsx` | Add person identifier detection, change tracking to use Sets per metric, convert Set sizes to final counts |

### Fallback Behavior
If the CSV doesn't have a person identifier column (email/contact), the parser will fall back to row-based counting (current behavior) to avoid breaking imports.

