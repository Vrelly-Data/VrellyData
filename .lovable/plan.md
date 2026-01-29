

## Fix LinkedIn Stats "Replace" to Clear All Existing Data First

### Problem
The current "Replace" mode only updates campaigns that match names in the CSV. Campaigns not in the CSV still retain their old LinkedIn stats, causing inflated totals.

**Your expected totals after upload:**
- LinkedIn Replies: 14
- LinkedIn Messages Sent: 213
- Connection Acceptances: 116
- Connection Requests Sent: 561

**Current database totals (wrong):**
- LinkedIn Replies: 70 (includes old data from 4 campaigns not in your CSV)
- LinkedIn Messages Sent: 242
- Connection Acceptances: 248
- Connection Requests Sent: 980

### Root Cause
4 campaigns from an earlier upload (Jan 27) weren't in your new CSV, so their LinkedIn stats remained:
- Retail LI + Email
- Healthcare LI + Email
- Bournemouth locals LI + Email
- Rejuvenate IT LI only sequence

### Solution
Modify the "Replace" mode to first **clear ALL LinkedIn stats** from ALL campaigns in the team, then apply the new CSV data.

### Implementation

#### File: `src/hooks/useLinkedInStatsUpload.ts`

Add a new step at the beginning of the mutation when `mode === 'replace'`:

```text
1. Before processing any CSV rows:
   - Query ALL campaigns for the team
   - For each campaign, set LinkedIn fields to 0:
     - linkedinMessagesSent: 0
     - linkedinConnectionsSent: 0
     - linkedinReplies: 0
     - linkedinConnectionsAccepted: 0
   - Preserve all other stats (email deliveries, replies, etc.)

2. Then proceed with normal CSV processing
   - Update matched campaigns with new LinkedIn values
   - Create new campaigns for unmatched rows
```

**Key code change (after line 47, before the loop):**

```typescript
// For "replace" mode, first clear ALL LinkedIn stats from all team campaigns
if (mode === 'replace') {
  const { data: allCampaigns } = await supabase
    .from('synced_campaigns')
    .select('id, stats')
    .eq('team_id', membership.team_id);

  if (allCampaigns) {
    for (const campaign of allCampaigns) {
      const existingStats = (campaign.stats as Record<string, unknown>) || {};
      const clearedStats = {
        ...existingStats,
        linkedinMessagesSent: 0,
        linkedinConnectionsSent: 0,
        linkedinReplies: 0,
        linkedinConnectionsAccepted: 0,
        linkedinDataSource: null,
        linkedinDataUploadedAt: null,
      };
      
      await supabase
        .from('synced_campaigns')
        .update({ stats: clearedStats })
        .eq('id', campaign.id);
    }
  }
}
```

#### File: `src/components/playground/LinkedInStatsUploadDialog.tsx`

Update the mode description to be even clearer:

**Current:**
> "Overwrites existing LinkedIn stats with values from this CSV. Email stats are preserved."

**Updated:**
> "Clears ALL existing LinkedIn stats, then applies this CSV. Email stats are preserved."

Update the confirmation message:

**Current:**
> "This will overwrite LinkedIn stats for {matchedCount} existing campaigns."

**Updated:**
> "This will clear LinkedIn stats from ALL campaigns, then apply data from this CSV to {matchedCount} matched campaigns."

### Expected Result After Fix

When you upload a CSV in "Replace" mode:
1. All 12 campaigns have their LinkedIn stats reset to 0
2. Only the 7 campaigns in your CSV get the new LinkedIn values
3. Dashboard totals show exactly what's in your CSV:
   - LinkedIn Replies: 14
   - LinkedIn Messages Sent: 213
   - Connection Acceptances: 116  
   - Connection Requests Sent: 561

### Files to Modify

| File | Changes |
|------|---------|
| `src/hooks/useLinkedInStatsUpload.ts` | Add step to clear ALL LinkedIn stats before applying CSV data in "replace" mode |
| `src/components/playground/LinkedInStatsUploadDialog.tsx` | Update mode description and confirmation text to reflect global clear behavior |

