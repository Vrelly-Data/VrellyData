

## Data Playground Enhancements - Expanding Reply.io Sync Capabilities

Based on my investigation, I've identified the issues and capabilities. Here's a comprehensive analysis and implementation plan.

---

## Current State Analysis

### 1. Campaign Status Issue (0 Active Campaigns)

**Root Cause Found**: Reply.io is returning status code `7` for some campaigns, which isn't mapped in the current status normalizer. The current code only handles:
- 0 = draft
- 1 = active
- 2 = paused
- 3 = completed
- 4 = archived

Status `7` is being stored as "unknown" in the database:

| Campaign | Raw Status | Stored Status |
|----------|------------|---------------|
| HVAC campaign | 2 | paused |
| Business owners no connect message | 7 | unknown |

**Fix**: Update the status mapping to handle all Reply.io status codes including `7` (which likely means "finished" or "stopped").

### 2. Contacts via API - YES, Fully Supported

Reply.io V3 API provides a dedicated endpoint to fetch contacts per sequence:
```
GET /v3/sequences/{id}/contacts/extended
```

Returns detailed contact data including:
- email, firstName, lastName, title
- Current step in sequence
- Status (Active, Finished, Replied, Bounced, Opened, Clicked)
- addedAt timestamp
- lastStepCompletedAt

**Current State**: The `synced_contacts` table exists but is **empty** - the sync function doesn't fetch contacts yet.

### 3. Copy/Templates via API - YES, Fully Supported

Reply.io V3 API provides sequence steps with full template content:
```
GET /v3/sequences/{id}/steps
```

Returns for each step:
- type (Email, LinkedIn Message, LinkedIn Connect, Call, SMS, WhatsApp, etc.)
- templates array with:
  - subject
  - body (HTML content)
  - id and templateId
- delayInMinutes
- executionMode (Automatic/Manual)

**Current State**: The `synced_sequences` table exists but is **empty** - the sync function doesn't fetch steps yet.

### 4. Completion Rate Calculation

**Current Logic** (in `usePlaygroundStats.ts`):
```typescript
completionPercentage = (totalPeopleFinished / totalPeopleCount) * 100
```

This is correct - it uses Reply.io's `peopleFinished` and `peopleCount` fields. However, accuracy depends on the API returning accurate values (which you mentioned may have issues with Reply.io's own dashboard).

---

## Implementation Plan

### Phase 1: Fix Campaign Status Mapping

**File**: `supabase/functions/sync-reply-campaigns/index.ts`

Update the `normalizeStatus` function to handle all Reply.io status codes:
```typescript
const statusMap: Record<number, string> = {
  0: 'draft',
  1: 'active',
  2: 'paused',
  3: 'completed',
  4: 'archived',
  5: 'stopped',
  6: 'error',
  7: 'finished',  // Add this mapping
};
```

### Phase 2: Sync Contacts from Reply.io

**New Approach**: Create a separate "deep sync" function for contacts to avoid timeout issues. The main fast sync handles campaign metadata; contacts are synced on-demand per campaign.

**File**: `supabase/functions/sync-reply-contacts/index.ts` (new)

Endpoint: `GET /v3/sequences/{sequenceId}/contacts/extended`

Data mapping to `synced_contacts` table:
| Reply.io Field | Database Column |
|----------------|-----------------|
| email | email |
| firstName | first_name |
| lastName | last_name |
| title | job_title |
| status.status | status |
| status.replied, delivered, bounced, opened | engagement_data (JSONB) |

### Phase 3: Sync Sequence Steps (Copy)

**File**: `supabase/functions/sync-reply-sequences/index.ts` (new)

Endpoint: `GET /v3/sequences/{sequenceId}/steps`

Data mapping to `synced_sequences` table:
| Reply.io Field | Database Column |
|----------------|-----------------|
| id | external_sequence_id |
| type | step_type |
| templates[0].subject | subject |
| templates[0].body | body_html |
| delayInMinutes | delay_days (convert) |

### Phase 4: Build "Copy" Tab UI

**File**: `src/components/playground/CopyTab.tsx` (new)

Display synced email templates with:
- Campaign name and step number
- Subject line
- Email body preview
- Step type badge (Email, LinkedIn Message, etc.)
- Option to copy or "remix" with AI

### Phase 5: Build "People" Tab UI

**File**: `src/components/playground/PeopleTab.tsx` (new)

Display synced contacts with:
- Contact details (name, email, company, title)
- Campaign association
- Engagement status (Active, Replied, Finished, Bounced)
- Filters by campaign and status

---

## Technical Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                     DATA PLAYGROUND                             │
├─────────────────────────────────────────────────────────────────┤
│ PLAYGROUND TAB                                                  │
│   ├── IntegrationSetupCard (Sync button)                       │
│   ├── PlaygroundStatsGrid (Overview metrics)                   │
│   └── CampaignsTable (Campaign list)                           │
├─────────────────────────────────────────────────────────────────┤
│ COPY TAB (NEW)                                                  │
│   ├── Sequence step browser                                     │
│   ├── Email template viewer                                     │
│   └── AI remix functionality                                    │
├─────────────────────────────────────────────────────────────────┤
│ PEOPLE TAB (NEW)                                                │
│   ├── Contact list with pagination                              │
│   ├── Campaign filter                                           │
│   └── Engagement status badges                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `supabase/functions/sync-reply-campaigns/index.ts` | Modify | Fix status mapping (add code 7) |
| `supabase/functions/sync-reply-contacts/index.ts` | Create | Fetch contacts per campaign |
| `supabase/functions/sync-reply-sequences/index.ts` | Create | Fetch email copy/steps per campaign |
| `src/components/playground/CopyTab.tsx` | Create | Display synced email templates |
| `src/components/playground/PeopleTab.tsx` | Create | Display synced contacts |
| `src/hooks/useSyncedSequences.ts` | Create | Hook to fetch sequence data |
| `src/pages/DataPlayground.tsx` | Modify | Wire up new tabs with real content |

---

## Sync Strategy (Avoiding Timeouts)

Given the 3-minute Edge Function timeout and potentially 1000+ contacts:

1. **Fast Sync** (existing): Campaign metadata and stats only - runs quickly
2. **Deep Sync** (new): Triggered per-campaign to fetch contacts and sequences
3. **Background Sync**: For large accounts, batch process with continuation tokens

---

## Expected Results After Implementation

| Metric | Current | After Fix |
|--------|---------|-----------|
| Active Campaigns | 0 | Accurate count |
| Total Contacts | Sum of peopleCount | Actual synced contacts |
| Copy/Templates | Empty | Real email content |
| People Tab | Placeholder | Full contact list |
| Completion Rate | Based on peopleFinished | Same (depends on API accuracy) |

