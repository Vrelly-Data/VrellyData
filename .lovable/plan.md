

# Add "Upload Email Stats" Feature

## Overview
Add an "Upload Email Stats" button next to the existing "Upload LinkedIn Stats" button. This allows manual upload of email engagement metrics from Reply.io CSV exports to fill in the dashboard accurately when the API sync doesn't capture all data.

## Data We Can Capture from Email CSV

### Primary Metrics (from Sequence-based CSV)
| Metric | CSV Column | Dashboard Display |
|--------|------------|-------------------|
| Emails Delivered | `Delivered count` | "Emails Sent" in breakdown |
| Email Replies | `Replied count` | "Email Replies" in breakdown |
| Email Opens | `Opened count` | New stat (optional) |
| Reply Rate | `Reply rate %` | Percentage in tooltip |
| Open Rate | `Open rate %` | Percentage in tooltip |
| Bounced | `Bounced count` | Health indicator |
| Clicked | `Clicked count` | Engagement metric |
| Out of Office | `OutOfOffice count` | Already tracked |
| Opted Out | `OptedOut count` | Suppression tracking |
| Interested | `Interested count` | Sentiment tracking |
| Active/Paused | `Active count` / `Paused count` | Contact status |

### Nice-to-Have (from Contact-specific CSV)
- Per-contact engagement update for People tab
- Delivery timestamps for activity timeline
- Could update individual `synced_contacts.engagement_data`

## Implementation Plan

### 1. Create Email Stats Upload Hook
**File:** `src/hooks/useEmailStatsUpload.ts`

Similar to `useLinkedInStatsUpload.ts`:
- Parse CSV with email-specific columns
- Match campaigns by name or Sequence Id
- Merge email stats into `synced_campaigns.stats` JSONB
- Support "Replace" mode (clear existing email stats first) and "Add" mode

Stats to merge:
```typescript
interface EmailStats {
  sent: number;           // Delivered count
  delivered: number;      // Same as sent for consistency
  replies: number;        // Replied count
  opens: number;          // Opened count
  clicked: number;        // Clicked count
  bounced: number;        // Bounced count
  outOfOffice: number;    // OutOfOffice count
  optedOut: number;       // OptedOut count
  interested: number;     // Interested count
  notInterested: number;  // NotInterested count
  autoReplied: number;    // AutoReplied count
  // Metadata
  emailDataSource: 'csv_upload';
  emailDataUploadedAt: string;
}
```

### 2. Create Email Stats Upload Dialog
**File:** `src/components/playground/EmailStatsUploadDialog.tsx`

Similar to `LinkedInStatsUploadDialog.tsx`:
- File upload with CSV parsing
- Preview table showing:
  - Campaign name
  - Delivered
  - Opened
  - Replied
  - Bounced
  - Match status
- Mode selector (Replace / Add)
- Import button

Column detection aliases:
```typescript
const CAMPAIGN_NAME_ALIASES = ['sequence name', 'sequence', 'campaign', 'name'];
const SEQUENCE_ID_ALIASES = ['sequence id', 'sequence_id', 'campaign id'];
const DELIVERED_ALIASES = ['delivered count', 'delivered', 'emails delivered'];
const REPLIED_ALIASES = ['replied count', 'replied', 'replies', 'email replies'];
const OPENED_ALIASES = ['opened count', 'opened', 'opens'];
const BOUNCED_ALIASES = ['bounced count', 'bounced'];
const CLICKED_ALIASES = ['clicked count', 'clicked', 'clicks'];
```

### 3. Update IntegrationSetupCard UI
**File:** `src/components/playground/IntegrationSetupCard.tsx`

Add the new button next to LinkedIn upload:
```tsx
<div className="flex items-center gap-2">
  <Button variant="outline" size="sm" onClick={() => setEmailUploadOpen(true)}>
    <Upload className="h-4 w-4 mr-2" />
    Upload Email Stats
  </Button>
  <Button variant="outline" size="sm" onClick={() => setLinkedInUploadOpen(true)}>
    <Upload className="h-4 w-4 mr-2" />
    Upload LinkedIn Stats
  </Button>
  <Button onClick={() => setDialogOpen(true)} size="sm">
    <Plus className="h-4 w-4 mr-2" />
    Connect Platform
  </Button>
</div>
```

### 4. Update usePlaygroundStats Hook
**File:** `src/hooks/usePlaygroundStats.ts`

Already reads from campaign stats - no changes needed! The email stats will flow through once uploaded since:
- `emailDeliveries` reads from `stats.sent || stats.delivered`
- `emailReplies` reads from `stats.replies`

### 5. Update PlaygroundStatsGrid (Optional Enhancement)
**File:** `src/components/playground/PlaygroundStatsGrid.tsx`

Add opens/bounced to the popover breakdown:
```tsx
<div className="flex items-center justify-between gap-4">
  <span>Opens:</span>
  <span>{stats.opens?.toLocaleString() ?? 0}</span>
</div>
<div className="flex items-center justify-between gap-4">
  <span>Bounced:</span>
  <span>{stats.bounced?.toLocaleString() ?? 0}</span>
</div>
```

---

## File Changes Summary

| File | Action |
|------|--------|
| `src/hooks/useEmailStatsUpload.ts` | **CREATE** - New hook for email CSV upload |
| `src/components/playground/EmailStatsUploadDialog.tsx` | **CREATE** - New dialog component |
| `src/components/playground/IntegrationSetupCard.tsx` | **MODIFY** - Add upload button |
| `src/hooks/usePlaygroundStats.ts` | **MODIFY** - Add opens/clicked/bounced fields |
| `src/components/playground/PlaygroundStatsGrid.tsx` | **MODIFY** - Show additional email metrics |

---

## User Flow

1. User exports "Sequence-based" report from Reply.io
2. Clicks "Upload Email Stats" button
3. Selects CSV file
4. Preview shows matched campaigns with email metrics
5. Chooses Replace or Add mode
6. Clicks Import
7. Dashboard immediately reflects accurate email stats

---

## Technical Considerations

### Merge Strategy
When uploading email stats in "Replace" mode:
1. First clear email-specific stats (`sent`, `delivered`, `replies`, `opens`, etc.) for ALL team campaigns
2. Preserve LinkedIn stats (`linkedinMessagesSent`, etc.)
3. Apply new email stats from CSV

This mirrors the LinkedIn upload behavior.

### Campaign Matching
Use both approaches for reliable matching:
1. **By Sequence Id** if present (exact match to `external_campaign_id`)
2. **By Name** using existing `findMatchingCampaign` fuzzy logic

### Data Preservation
LinkedIn stats should NEVER be touched by email upload, and vice versa.

