

## Campaign Linking Flow Redesign

### Current Problem
- Current flow blindly syncs ALL campaigns from Reply.io
- For agency accounts (60+ campaigns), this causes timeouts and syncs irrelevant data
- Users have no control over which campaigns are tracked

### New Flow: "Link Campaigns First, Then Sync"

```text
+------------------+    +---------------------+    +------------------+
|  1. Connect      |    |  2. Fetch Campaign  |    |  3. Link         |
|     Platform     |--->|     List (Fast)     |--->|     Campaigns    |
|                  |    |     ~5 seconds      |    |     (Select)     |
+------------------+    +---------------------+    +------------------+
                                                            |
                                                            v
+------------------+    +---------------------+    +------------------+
|  5. View Stats   |<---|  4. Sync Only       |<---|  Linked          |
|     & Content    |    |     Linked Campaigns|    |  Campaigns       |
+------------------+    +---------------------+    +------------------+
```

### Database Changes

**Add `is_linked` column to `synced_campaigns`:**

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `is_linked` | boolean | false | Whether user wants to track this campaign |

This allows:
- Store ALL campaigns from Reply.io (just names/IDs - fast)
- Only sync detailed data for linked campaigns
- User can link/unlink at any time

### New User Experience

**Step 1: Connect Platform** (unchanged)
- Enter API key → Test Connection → Connect

**Step 2: Fetch Available Campaigns** (new)
- After connecting, show a "Manage Campaigns" button
- Opens a dialog showing ALL campaigns from Reply.io
- Checkboxes for each campaign
- "Select All" / "Deselect All" buttons
- Search/filter by name

**Step 3: Link Campaigns**
- User checks campaigns they want to track
- Clicks "Save" → updates `is_linked` in database

**Step 4: Sync**
- Sync button only processes campaigns where `is_linked = true`
- Much faster for large accounts

**Step 5: Manage Over Time**
- "Manage Campaigns" button always available
- Can add/remove campaigns from tracking anytime
- Unlinked campaigns stay in database but aren't synced

### Technical Implementation

**1. Database Migration**
- Add `is_linked` boolean column to `synced_campaigns` table
- Default: `false`

**2. New Edge Function: `fetch-available-campaigns`**
- Lightweight fetch: only campaign ID, name, status from Reply.io
- No contacts, no steps, no delays
- Returns list for UI to display

**3. New Dialog: `ManageCampaignsDialog.tsx`**
- Shows all available campaigns with checkboxes
- Select All / Deselect All
- Search filter
- Save button updates `is_linked` status

**4. Update `sync-reply-campaigns`**
- Only sync campaigns where `is_linked = true`
- Skip unlinked campaigns entirely

**5. Update `CampaignsTable.tsx`**
- Only show linked campaigns
- Add "Manage Campaigns" action

**6. New Hook: `useAvailableCampaigns.ts`**
- Fetches available campaigns from edge function
- Manages linking/unlinking mutations

### UI Mockup

```text
+-----------------------------------------------------------+
| Connected Platforms                    [Manage Campaigns] |
+-----------------------------------------------------------+
| 📧 Reply.io Account                                       |
|    Status: Synced · Last synced 2 minutes ago             |
|    Tracking: 5 of 62 campaigns                            |
|    [Sync] [Enable Live] [...]                             |
+-----------------------------------------------------------+

+-- Manage Campaigns Dialog --------------------------------+
| Manage Campaigns                              [X] Close   |
+-----------------------------------------------------------+
| [Search campaigns...]                                     |
| [✓] Select All  [  ] Deselect All                         |
+-----------------------------------------------------------+
| [✓] Sales Outreach Q1        Active    245 contacts       |
| [✓] Follow-up Sequence       Active    120 contacts       |
| [  ] Old Campaign 2023       Archived   50 contacts       |
| [✓] Enterprise Demo Flow     Active     80 contacts       |
| [  ] Test Campaign           Draft       5 contacts       |
| ...                                                       |
+-----------------------------------------------------------+
| Linked: 3 campaigns                     [Cancel] [Save]   |
+-----------------------------------------------------------+
```

### Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `supabase/functions/fetch-available-campaigns/index.ts` | Create | Lightweight campaign list fetch |
| `src/components/playground/ManageCampaignsDialog.tsx` | Create | Campaign selection UI |
| `src/hooks/useAvailableCampaigns.ts` | Create | Hook for fetching/linking campaigns |
| `supabase/functions/sync-reply-campaigns/index.ts` | Modify | Only sync linked campaigns |
| `src/components/playground/IntegrationSetupCard.tsx` | Modify | Add "Manage Campaigns" button |
| `src/components/playground/CampaignsTable.tsx` | Modify | Show linked count |
| `src/hooks/useSyncedCampaigns.ts` | Modify | Filter to linked only |

### Database Migration

```sql
-- Add is_linked column to synced_campaigns
ALTER TABLE synced_campaigns 
ADD COLUMN is_linked boolean NOT NULL DEFAULT false;

-- Add index for filtering
CREATE INDEX idx_synced_campaigns_is_linked 
ON synced_campaigns(team_id, is_linked) 
WHERE is_linked = true;
```

### Benefits

1. **No More Timeouts**: Fetch campaign list is fast (no contacts/steps)
2. **User Control**: Choose exactly which campaigns to track
3. **Scalable**: Works for 5 or 500 campaigns
4. **Flexible**: Add/remove campaigns anytime
5. **Accurate Data**: Only tracking what matters

