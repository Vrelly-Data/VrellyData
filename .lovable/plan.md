

# Fix Email Stats and Contact Count Issues

## Root Cause Analysis

### Issue 1: Email Stats at 0
The V3 extended API now returns a `status` object (confirmed in `raw_data`), but all engagement flags are `false` from Reply.io itself. This is happening because:

- The campaigns in your account appear to be **LinkedIn-only sequences** (no email steps)
- For LinkedIn campaigns, Reply.io returns `delivered: false`, `replied: false`, etc. because those flags are email-specific
- The ~114 sent / ~2 replies you expected likely came from **email campaigns** that either:
  - Are not currently linked/synced, OR
  - Are in a different workspace than the one configured

### Issue 2: Contact Count Dropping (593 vs expected 1,053)
Looking at the database, there are duplicate campaign records for the same `external_campaign_id`:

| Campaign Name | Contacts in DB | People Count Stat |
|--------------|----------------|-------------------|
| HVAC campaign (9f16bb51) | 100 | 100 |
| HVAC campaign (56abc8b4) | 0 | 264 |
| Plumbing Campaign (01346012) | 100 | 100 |
| Plumbing Campaign (d46b41a2) | 0 | 98 |

The V3 pagination with `limit=100` per page capped contact syncing. Many campaigns also have duplicate rows causing sync to go to wrong campaign IDs.

---

## Solution: Two-Part Fix

### Part A: Fix Contact Pagination (Restore Full Sync)
**File**: `supabase/functions/sync-reply-contacts/index.ts`

The recent changes broke pagination. We need to:
1. Remove the 100-page artificial limit (`offset < maxPages * limit`) which caps at 10,000 contacts
2. The current code syncs correctly but the offset-based pagination with V3 may be returning fewer contacts than expected

Actually, looking more carefully: the sync IS working but syncing to the wrong campaign UUIDs (the duplicate rows). We need to deduplicate campaigns.

### Part B: Prevent Duplicate Campaigns
**File**: `supabase/functions/sync-reply-campaigns/index.ts`

Add deduplication logic:
1. Before upserting, check for existing campaigns with the same `external_campaign_id` AND `team_id`
2. Only create one campaign record per external ID per team
3. Use the existing record's UUID when syncing contacts

---

## Technical Implementation

### 1. Campaign Deduplication in sync-reply-campaigns
```typescript
// Before upsert, find ANY existing campaign with this external_id for this team
// (not scoped to integration_id to catch orphaned duplicates)
const { data: existingAny } = await supabase
  .from("synced_campaigns")
  .select("id, stats, is_linked")
  .eq("team_id", teamId)
  .eq("external_campaign_id", String(sequence.id))
  .order("created_at", { ascending: true })
  .limit(1)
  .maybeSingle();

// Use existing campaign's ID to prevent duplicates
const campaignUuid = existingAny?.id || crypto.randomUUID();
```

### 2. Contact Sync Pagination Check
The current V3 pagination should work but may need:
- Remove the artificial 10,000 contact limit for large accounts
- Add better logging to trace which campaign UUID contacts are syncing to

### 3. Verify Campaign Type
To confirm whether email stats should exist:
- Check if `synced_sequences` has email steps for these campaigns
- If all steps are LinkedIn, then `delivered=0` is correct behavior

---

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/sync-reply-campaigns/index.ts` | Add team-level deduplication for campaigns |
| `supabase/functions/sync-reply-contacts/index.ts` | Add diagnostic logging for campaign UUID being synced to |

---

## Database Cleanup (One-Time)
Delete orphaned duplicate campaign rows that have 0 contacts:
```sql
DELETE FROM synced_campaigns sc
WHERE NOT EXISTS (
  SELECT 1 FROM synced_contacts c WHERE c.campaign_id = sc.id
)
AND EXISTS (
  SELECT 1 FROM synced_campaigns other 
  WHERE other.external_campaign_id = sc.external_campaign_id 
  AND other.team_id = sc.team_id 
  AND other.id != sc.id
);
```

---

## Expected Outcome
1. Contact count matches `peopleCount` from Reply.io (1,053 total across campaigns)
2. If campaigns have email steps: Email Sent and Replies will show actual values
3. If campaigns are LinkedIn-only: Email Sent stays 0 (correct behavior)

---

## Verification Steps
1. Run the SQL cleanup to remove duplicate campaigns
2. Deploy updated edge functions
3. Sync integration
4. Check People tab shows correct total contact count
5. Sync a sequence's steps (via Copy tab) to verify if email steps exist

