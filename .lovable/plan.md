

## Plan: Enhance Data Playground with LinkedIn vs Email Metric Differentiation

### Overview

This plan adds the ability to differentiate between LinkedIn and Email activities in the Data Playground. We'll capture step-level data from Reply.io, add hover tooltips to show breakdowns, and ensure no changes affect other parts of the app.

### Current Data Reality

Based on the synced data from Reply.io:

| Metric | Current Source | Limitation |
|--------|---------------|------------|
| `deliveriesCount` | Campaign API | Email-only (LinkedIn campaigns show 0) |
| `repliesCount` | Campaign API | Likely email-only |
| `outOfOfficeCount` | Campaign API | Already available and working |
| LinkedIn stats | Not captured | Need to fetch from steps/actions API |

### Phase 1: Database Schema Update

**Add `step_type` column to `synced_sequences`**

```sql
ALTER TABLE synced_sequences 
ADD COLUMN step_type TEXT;
```

This allows storing step types like: `email`, `linkedin_connect`, `linkedin_message`, `linkedin_view_profile`, `linkedin_inmail`, etc.

---

### Phase 2: Update Sync Function to Capture All Step Types

**File: `supabase/functions/sync-reply-campaigns/index.ts`**

1. Remove the email-only filter at line 318
2. Store ALL step types with their `step.type` value
3. Add logging to see what step types exist in the data

```typescript
// BEFORE
for (const step of steps) {
  if (step.type !== "email") continue; // Remove this

// AFTER  
for (const step of steps) {
  console.log(`  Step ${step.number}: type=${step.type}`);
  // Store step_type in the upsert
```

---

### Phase 3: Calculate Channel-Specific Metrics

**New file: `src/hooks/useChannelMetrics.ts`**

Query `synced_sequences` to calculate:
- Email steps count
- LinkedIn Connection Request steps count
- LinkedIn Message steps count
- LinkedIn InMail steps count

```typescript
interface ChannelMetrics {
  emailSteps: number;
  linkedinConnectSteps: number;
  linkedinMessageSteps: number;
  linkedinViewSteps: number;
}
```

---

### Phase 4: Add Hover Tooltips to Stat Cards

**File: `src/components/playground/PlaygroundStatsGrid.tsx`**

Wrap stat cards with `Tooltip` to show breakdowns on hover:

**Total Replies Card:**
```
┌───────────────────────────────┐
│  Total Replies: 10            │
│  ─────────────────            │
│  Hover shows:                 │
│  • Email Replies: 8           │
│  • LinkedIn Replies: 2        │
└───────────────────────────────┘
```

**Total Messages Sent Card:**
```
┌───────────────────────────────┐
│  Total Messages Sent: 962     │
│  ─────────────────────────    │
│  Hover shows:                 │
│  • Emails Sent: 627           │
│  • Connection Requests: 200   │
│  • LinkedIn Messages: 135     │
│  • Connections Accepted: ???  │
└───────────────────────────────┘
```

---

### Phase 5: Update Stats Hook with Channel Breakdown

**File: `src/hooks/usePlaygroundStats.ts`**

Add new fields to `PlaygroundStats`:

```typescript
interface PlaygroundStats {
  // Existing
  totalMessagesSent: number;
  totalReplies: number;
  // New breakdowns
  emailsSent: number;
  emailReplies: number;
  linkedinConnectionsSent: number;
  linkedinMessagesSent: number;
  linkedinReplies: number;
  connectionsAccepted: number; // May need additional API endpoint
}
```

---

### Known Limitations & Next Steps

**Reply.io API Limitations:**
- The `/campaigns` endpoint doesn't provide LinkedIn-specific metrics at the campaign level
- `connectionsAccepted` may require calling a different API endpoint (e.g., `/people/{id}/activities` or `/actions`)
- We need to run a sync and check the logs to see what `step.type` values Reply.io returns

**Investigation Needed:**
After implementing Phase 2 and running a sync, we'll see the actual step types in the logs. Common Reply.io step types include:
- `email`
- `linkedin_connect` 
- `linkedin_message`
- `linkedin_view_profile`
- `linkedin_inmail`
- `call`
- `manual_task`

---

### Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| Database migration | Create | Add `step_type` column to `synced_sequences` |
| `supabase/functions/sync-reply-campaigns/index.ts` | Modify | Capture all step types, log what we find |
| `src/hooks/useChannelMetrics.ts` | Create | Calculate channel-specific counts from sequences |
| `src/hooks/usePlaygroundStats.ts` | Modify | Add channel breakdown fields |
| `src/components/playground/PlaygroundStatsGrid.tsx` | Modify | Add tooltips showing channel breakdowns |

---

### Isolation Confirmation

All changes are isolated to the Data Playground feature:
- Only touches `synced_*` tables (not `people_records`, `company_records`)
- Only modifies files in `src/components/playground/` and `src/hooks/usePlayground*.ts`
- Edge function `sync-reply-campaigns` is specific to Data Playground
- No changes to main app navigation, authentication, or core features

---

### Technical Details

**Tooltip Implementation:**
```tsx
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

<TooltipProvider>
  <Tooltip>
    <TooltipTrigger asChild>
      <Card className="cursor-pointer hover:bg-accent/50">
        {/* StatCard content */}
      </Card>
    </TooltipTrigger>
    <TooltipContent>
      <div className="space-y-1 text-sm">
        <div className="flex justify-between gap-4">
          <span>Email Replies:</span>
          <span className="font-medium">{stats.emailReplies}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span>LinkedIn Replies:</span>
          <span className="font-medium">{stats.linkedinReplies}</span>
        </div>
      </div>
    </TooltipContent>
  </Tooltip>
</TooltipProvider>
```

