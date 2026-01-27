

## Hybrid LinkedIn Tracking: CSV Upload + Real-time Webhooks

### The Problem
Reply.io's polling API doesn't expose historical LinkedIn metrics, but you can see them in Reply.io's reports/exports. The solution is a **hybrid approach**:

| Data Source | Use Case |
|-------------|----------|
| **CSV Upload** | Import historical LinkedIn stats from Reply.io report exports |
| **Webhooks** | Capture real-time LinkedIn activity as it happens (already set up) |

---

### Solution Overview

```text
+---------------------------+     +---------------------------+
|   Reply.io Report Export  |     |    Reply.io Webhooks      |
|   (Historical Data)       |     |    (Real-time Data)       |
+---------------------------+     +---------------------------+
            |                                  |
            v                                  v
+---------------------------+     +---------------------------+
|   CSV Upload Dialog       |     |   reply-webhook function  |
|   (New Component)         |     |   (Already Built)         |
+---------------------------+     +---------------------------+
            |                                  |
            +----------------+-----------------+
                             |
                             v
              +------------------------------+
              |    synced_campaigns.stats    |
              |    (linkedinMessagesSent,    |
              |     linkedinConnectionsSent, |
              |     linkedinReplies)         |
              +------------------------------+
                             |
                             v
              +------------------------------+
              |   PlaygroundStatsGrid        |
              |   (Dashboard Display)        |
              +------------------------------+
```

---

### Implementation Details

#### 1. New Component: `LinkedInStatsUploadDialog.tsx`

A dialog allowing users to upload a CSV file containing LinkedIn metrics. The dialog will:

- Accept CSV with columns like: `Campaign Name`, `LinkedIn Messages Sent`, `LinkedIn Connection Requests`, `LinkedIn Replies`
- Auto-match campaign names to existing `synced_campaigns` records
- Merge uploaded stats into the `stats` JSONB field

**Expected CSV Format (from Reply.io export):**

| Campaign Name | LI Messages Sent | LI Connections | LI Replies |
|---------------|------------------|----------------|------------|
| Q1 Outreach   | 500              | 250            | 45         |
| Tech Founders | 320              | 180            | 28         |

#### 2. Add Upload Button to Dashboard

In `PlaygroundStatsGrid.tsx` or `IntegrationSetupCard.tsx`:
- Add "Upload LinkedIn Stats" button next to the Sync button
- Opens the new dialog when clicked

#### 3. Stats Merge Logic

When uploading:
1. Parse CSV and extract LinkedIn metrics per campaign
2. Match each row to existing `synced_campaigns` by name
3. Merge stats into the `stats` JSONB column (additive or replace based on user choice)
4. Invalidate stats query to refresh dashboard

---

### Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/components/playground/LinkedInStatsUploadDialog.tsx` | Create | Dialog for CSV upload + mapping |
| `src/components/playground/IntegrationSetupCard.tsx` | Modify | Add "Upload LinkedIn Stats" button |
| `src/hooks/useLinkedInStatsUpload.ts` | Create | Mutation hook for uploading and merging stats |

---

### Detailed Component Design

#### LinkedInStatsUploadDialog.tsx

**State Flow:**
1. **Upload** - Select CSV file
2. **Preview** - Show matched campaigns and values to be imported
3. **Confirm** - User confirms the import
4. **Success** - Stats merged, dashboard updated

**Key Features:**
- Uses existing `PapaParse` for CSV parsing (already installed)
- Campaign matching by exact name or fuzzy match
- Shows which campaigns matched vs not found
- Allows "Replace" or "Add to existing" mode

**UI Elements:**
- File dropzone (similar to existing CSVImportDialog)
- Preview table showing: Campaign Name, LI Messages, LI Connections, LI Replies, Status (Matched/Not Found)
- Import button with progress indicator

---

### Expected User Flow

1. User exports LinkedIn report from Reply.io dashboard (CSV)
2. In Data Playground, clicks "Upload LinkedIn Stats"
3. Selects the CSV file
4. Preview shows: "4 campaigns matched, 1 not found"
5. Clicks "Import"
6. Dashboard immediately shows LinkedIn metrics

---

### Technical Notes

**CSV Column Aliases (for auto-mapping):**

| Expected Field | Accepted Aliases |
|----------------|------------------|
| Campaign Name | `campaign`, `name`, `sequence`, `sequence name` |
| LinkedIn Messages Sent | `li messages`, `linkedin messages`, `messages sent` |
| LinkedIn Connections | `li connections`, `connection requests`, `connections sent` |
| LinkedIn Replies | `li replies`, `linkedin replies` |

**Stats Merge Strategy:**
```typescript
// Merge uploaded LinkedIn stats into existing campaign stats
const mergedStats = {
  ...existingStats,
  linkedinMessagesSent: uploadedData.linkedinMessagesSent,
  linkedinConnectionsSent: uploadedData.linkedinConnectionsSent,
  linkedinReplies: uploadedData.linkedinReplies,
  linkedinDataSource: 'csv_upload', // Track source for transparency
  linkedinDataUploadedAt: new Date().toISOString(),
};
```

---

### Webhook Integration (Already Working)

Once historical data is uploaded via CSV, future LinkedIn activity will be captured automatically via webhooks (already implemented):

| Event | Stat Updated |
|-------|--------------|
| `linkedin_message_sent` | `linkedinMessagesSent` += 1 |
| `linkedin_connection_request_sent` | `linkedinConnectionsSent` += 1 |
| `linkedin_message_replied` | `linkedinReplies` += 1 |
| `linkedin_connection_request_accepted` | `linkedinConnectionsAccepted` += 1 |

The numbers will stack: **Historical (CSV) + Real-time (Webhooks) = Total Shown**

---

### Summary

This hybrid approach gives you:

| Historical Data | Real-time Data |
|-----------------|----------------|
| Uploaded via CSV from Reply.io exports | Captured via webhooks (already enabled) |
| One-time import of past LinkedIn activity | Continuous updates as new activity occurs |
| Populates immediately after upload | Populates as events happen |

