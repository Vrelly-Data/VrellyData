

# Fix Email Stats: Try V3 Reports Endpoint

## Problem Confirmed

After thorough investigation, email stats are not syncing because:

1. **V3 `/statistics/sequences/{id}`** → Returns 404 (may require higher subscription tier)
2. **V1 `/campaigns/{id}` single endpoint** → Returns 404 (deprecated or permission issue)
3. **V1 `/campaigns` list endpoint** → Works but only returns `peopleCount` (no detailed stats)

The logs show:
```
Could not fetch V3 stats for sequence 1419855: Reply.io V3 API error (404)
Could not fetch V1 stats for campaign 1419855: Reply.io V1 API error (404)
Stats: sent=0, replies=0
```

---

## Solution: Try V3 Reports Endpoint

Reply.io has a **Reports API** (`/v3/reports/sequences/{id}`) which is separate from the Statistics API. We'll add this as another fallback layer.

### Fallback Order:
1. V3 Statistics API (`/v3/statistics/sequences/{id}`) - Current approach (404)
2. **NEW: V3 Reports API** (`/v3/reports/sequences/{id}`) - May include stats
3. V1 Single Campaign (`/v1/campaigns/{id}`) - Current fallback (404)

If all APIs fail, we'll try one more thing: **remove the team header** from the V1 single campaign request, as the 404 might be caused by workspace-scoped API key restrictions.

---

## Implementation

### File: `supabase/functions/sync-reply-campaigns/index.ts`

1. **Add V3 Reports endpoint function:**
```typescript
async function fetchSequenceReport(
  sequenceId: number,
  apiKey: string,
  teamId?: string
): Promise<Record<string, number>> {
  try {
    const data = await fetchWithRetryV3(
      `/reports/sequences/${sequenceId}`, 
      apiKey, 
      teamId
    ) as Record<string, unknown>;
    
    // Reports API may use different field names
    return {
      sent: (data.delivered as number) || (data.sent as number) || 0,
      delivered: (data.delivered as number) || 0,
      replies: (data.replied as number) || (data.replies as number) || 0,
      opens: (data.opened as number) || (data.opens as number) || 0,
      clicks: (data.clicked as number) || (data.clicks as number) || 0,
    };
  } catch (err) {
    console.warn(`Could not fetch V3 report for sequence ${sequenceId}:`, err);
    return {};
  }
}
```

2. **Try V1 single campaign without team header:**
```typescript
async function fetchCampaignStatsV1NoTeam(
  campaignId: number,
  apiKey: string
): Promise<Record<string, number>> {
  try {
    // Try without team header - might work for non-agency accounts
    const data = await fetchWithRetryV1(`/campaigns/${campaignId}`, apiKey);
    const campaign = data as Record<string, unknown>;
    
    return {
      sent: (campaign.peopleSent as number) || (campaign.peopleDelivered as number) || 0,
      delivered: (campaign.peopleDelivered as number) || (campaign.peopleSent as number) || 0,
      replies: (campaign.peopleReplied as number) || 0,
    };
  } catch (err) {
    console.warn(`Could not fetch V1 stats (no team) for campaign ${campaignId}:`, err);
    return {};
  }
}
```

3. **Update sync loop with multi-fallback:**
```typescript
// Fetch stats - multiple fallback layers
console.log(`  Fetching stats from V3 Statistics API...`);
let apiStats = await fetchSequenceStats(sequence.id, apiKey, replyTeamId);

if (!apiStats.sent && !apiStats.replies) {
  console.log(`  V3 stats empty, trying V3 Reports API...`);
  apiStats = await fetchSequenceReport(sequence.id, apiKey, replyTeamId);
}

if (!apiStats.sent && !apiStats.replies) {
  console.log(`  V3 reports empty, trying V1 /campaigns/${sequence.id}...`);
  apiStats = await fetchCampaignStatsV1(sequence.id, apiKey, replyTeamId);
}

if (!apiStats.sent && !apiStats.replies) {
  console.log(`  V1 with team failed, trying V1 without team header...`);
  apiStats = await fetchCampaignStatsV1NoTeam(sequence.id, apiKey);
}

console.log(`  Final stats: sent=${apiStats.sent || 0}, replies=${apiStats.replies || 0}`);
```

---

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/sync-reply-campaigns/index.ts` | Add V3 Reports fallback, add V1 no-team fallback |

---

## Why This Might Work

- **V3 Reports API** is a different endpoint than Statistics - it may have different permission requirements
- **V1 without team header** - The 404 could be caused by the `X-Reply-Team-Id` header restricting access to a specific workspace that doesn't have stats permissions

---

## Expected Outcome

After deployment, the logs will show which fallback succeeds:
```
Fetching stats from V3 Statistics API... (404)
V3 stats empty, trying V3 Reports API... (succeeds or 404)
V3 reports empty, trying V1 /campaigns/1419855... (succeeds or 404)
V1 with team failed, trying V1 without team header... (succeeds or 404)
Final stats: sent=114, replies=2
```

---

## If All Fallbacks Fail

If all API endpoints return 404, the Reply.io account may not have API access to statistics (possibly a tier limitation). In that case, we would need to:

1. Contact Reply.io support about API access to statistics
2. Use webhooks (which we've disabled) to track stats in real-time
3. Allow manual entry of stats via CSV upload

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| All fallbacks fail | Graceful fallback to 0 (no crash), preserves existing stats |
| Rate limiting | Uses existing retry logic |
| Different field names | Checks multiple possible field names |
| Breaking existing logic | Only adds new fallback functions |

