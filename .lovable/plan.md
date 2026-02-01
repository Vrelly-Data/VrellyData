
## Fix: Reply.io API Not Respecting Offset Parameter

### Problem Identified

The edge function logs prove that the Reply.io V3 API endpoint `/sequences/{id}/contacts/extended` is **not respecting the `offset` parameter**:

```
Page 1: fetched 100, new unique: 100, total unique: 100
Page 2: fetched 100, new unique: 0, total unique: 100
...
Page 100: fetched 100, new unique: 0, total unique: 100
Fetched 10000 total items, 100 unique contacts from Reply.io
```

Every page returns the **exact same 100 contacts**, regardless of the `offset` value. This is either:
1. A Reply.io API bug with this endpoint
2. The V3 contacts endpoint requires different pagination syntax

The campaign metadata shows Reply.io reports `peopleCount: 98` for Plumbing Campaign, but we should have 1,176 across all campaigns in the account.

---

### Solution Strategy

Based on Reply.io API documentation, we have two options:

**Option A: Try the V1 Campaign/Contacts Endpoint**
The sync-campaigns function uses the V1 API (`https://api.reply.io/v1/campaigns`). There may be a V1 endpoint for campaign contacts that works differently.

**Option B: Use Global Contacts Endpoint + Filter by Sequence**
Reply.io may have a `/v3/contacts` global endpoint that we can filter by sequence ID.

**Option C: Use Webhooks for Real-Time Updates**
Instead of polling, rely on the webhook system (already partially implemented) to capture contact additions and engagement events in real-time.

---

### Implementation Plan

#### Phase 1: Fix Contact Sync with Alternative API Approach

**1. Add V1 Contacts API endpoint support**
- File: `supabase/functions/sync-reply-contacts/index.ts`
- Try the V1 API: `GET /v1/campaigns/{id}/people` with pagination
- The V1 API may use `page` parameter instead of `offset`

**2. Modify pagination logic**
- Use `page=1, page=2, ...` instead of `offset=0, offset=100, ...`
- Check if V1 returns different results for different pages

#### Phase 2: Add "Sync All Linked Campaigns" Button

**3. Create frontend trigger for bulk sync**
- File: `src/components/playground/PeopleTab.tsx`
- Add "Sync All Campaigns" button that loops through linked campaigns
- Show progress indicator during bulk sync

**4. Update mutation to support bulk operations**
- Invalidate queries after all campaigns are synced
- Show aggregate success message

---

### Technical Details

**API Endpoint Change:**
```typescript
// BEFORE (V3 - broken pagination)
const REPLY_API_BASE = "https://api.reply.io/v3";
const endpoint = `/sequences/${sequenceId}/contacts/extended?limit=${limit}&offset=${offset}`;

// AFTER (V1 - try page-based pagination)
const REPLY_API_BASE = "https://api.reply.io/v1";
const endpoint = `/campaigns/${campaignId}/people?limit=${limit}&page=${page}`;
```

**V1 API uses:**
- `page` parameter (1-indexed)
- `limit` parameter (max 100)
- Different response structure (may need mapping)

**Bulk Sync UI:**
```typescript
// Add to PeopleTab.tsx
<Button onClick={syncAllCampaigns}>
  <RefreshCw className="h-4 w-4 mr-2" />
  Sync All Linked Campaigns
</Button>
```

---

### Expected Outcome

| Current State | After Fix |
|--------------|-----------|
| 200 contacts (100 per campaign x 2) | All 1,176+ contacts across account |
| V3 offset pagination broken | V1 page pagination working |
| Manual sync per campaign | Bulk sync all linked campaigns |
| Misleading "10000 fetched" logs | Accurate unique contact count |

---

### Verification Steps

1. Deploy updated edge function with V1 API
2. Click "Sync All Linked Campaigns" 
3. Check logs show actual unique contacts per page
4. Verify database count matches Reply.io account total
5. Confirm People tab shows all 1,176 contacts with pagination
