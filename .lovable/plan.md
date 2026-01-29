

## Fix Active Campaigns Count

### Problem Analysis

**What the data shows:**
| Campaign Name | Status | is_linked |
|---------------|--------|-----------|
| HVAC campaign | paused | ✅ true |
| Plumbing Campaign | paused | ✅ true |
| Business owners... Advertising | finished | ✅ true |
| Business owners... Copy | finished | ✅ true |
| Already connected agency owners | archived | ✅ true |
| Business owners no connect message | finished | ✅ true |
| Various CSV imports... | imported | ❌ false |

**Two issues identified:**

1. **Stats query doesn't filter by `is_linked`** - Currently counting ALL campaigns including CSV import duplicates
2. **No campaigns have `active` status** - Your campaigns are correctly showing `paused`/`finished` because that's their actual Reply.io status

---

### Solution Options

**Option A: Fix the filter only (minimal change)**
- Add `is_linked = true` filter to the stats query
- Keep "Active Campaigns" showing only truly active campaigns (status = 'active')
- Current behavior is technically correct (0 active = 0 running)

**Option B: Show "Running Campaigns" instead**
- Rename to "Running Campaigns" 
- Count campaigns that are either `active` OR `paused` (still have people in queue)
- Excludes `finished`, `archived`, `completed`, `stopped`

**Recommended: Option A + B combined**
- Filter by `is_linked`
- Count `active` + `paused` as "running" (shows campaigns that are operational)
- This gives you a non-zero, meaningful number

---

### Implementation Details

**File**: `src/hooks/usePlaygroundStats.ts`

**Change 1: Filter by `is_linked`**
```typescript
const { data: campaigns, error: campaignsError } = await supabase
  .from('synced_campaigns')
  .select('id, status, stats')
  .eq('is_linked', true);  // ADD THIS FILTER
```

**Change 2: Count "running" campaigns (active + paused)**
```typescript
// Count campaigns that are still running (active or paused)
const runningStatuses = ['active', 'paused'];
if (runningStatuses.includes(campaign.status?.toLowerCase() || '')) {
  activeCampaigns++;
}
```

---

### UI Consideration (Optional)

To make it clearer what "Active" means, we could also update the card label:

| Current | Proposed |
|---------|----------|
| "Active Campaigns" | "Running Campaigns" (or keep as-is) |
| Description: "Currently running" | Description: "Active or paused" |

---

### Files to Modify

| File | Changes |
|------|---------|
| `src/hooks/usePlaygroundStats.ts` | Add `is_linked` filter, count `active` + `paused` as running |

---

### Expected Result

| Before | After |
|--------|-------|
| 0 Active Campaigns | 2 Active Campaigns (HVAC + Plumbing) |
| Counting all campaigns including CSV duplicates | Only counting linked campaigns |
| Strict "active" status only | Includes "paused" (still operational) |

