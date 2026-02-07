

## Fix: Sync 0 Campaigns - V1 API Doesn't Return teamId

### Root Cause

The Reply.io V1 `/campaigns` endpoint does **NOT return `teamId`** in campaign objects:

```
Campaign 1606195 (HVAC campaign) has no teamId, excluding from sync
Campaign 1606099 (Plumbing Campaign) has no teamId, excluding from sync
...
After workspace filter: 0/6 campaigns belong to workspace 383893
```

The strict filtering we added is working correctly - it's just that V1 campaigns **never** have `teamId`.

However, the **V3 `/sequences` endpoint DOES include `teamId`** - this is how `fetch-reply-teams` successfully discovers workspaces.

### Solution

Switch `sync-reply-campaigns` from V1 API to V3 API:

| Current (Broken) | Fixed |
|------------------|-------|
| V1 `/campaigns` - no teamId | V3 `/sequences` - has teamId |
| All campaigns returned regardless of workspace | Can filter by teamId client-side |
| Strict filter excludes everything | Strict filter works correctly |

### Technical Changes

#### File: `supabase/functions/sync-reply-campaigns/index.ts`

**Change 1**: Update API endpoint from V1 to V3

```typescript
// Before:
const REPLY_API_BASE = "https://api.reply.io/v1";

// After:
const REPLY_API_V3 = "https://api.reply.io/v3";
```

**Change 2**: Update interface to match V3 sequence structure

```typescript
// V3 sequence fields (different from V1 campaign)
interface ReplyioSequence {
  id: number;
  name: string;
  status: string;       // "Active", "Paused", "Finished"
  teamId: number;       // This is what we need!
  ownerId: number;
  created: string;
  isArchived: boolean;
  // Stats may need separate fetch
}
```

**Change 3**: Update fetch to use V3 `/sequences` endpoint

```typescript
// Fetch from V3 sequences endpoint
const sequences = await fetchAllPaginated<ReplyioSequence>(
  "/sequences",
  apiKey,
  "items",  // V3 returns { items: [], info: { hasMore } }
  replyTeamId || undefined
);
```

**Change 4**: Filter by teamId (now works because V3 includes it)

```typescript
if (replyTeamId) {
  const teamIdNum = parseInt(replyTeamId, 10);
  sequences = sequences.filter(seq => seq.teamId === teamIdNum);
  console.log(`Filtered to ${sequences.length} sequences for workspace ${replyTeamId}`);
}
```

**Change 5**: Update status normalization for V3 format

```typescript
// V3 uses string status: "Active", "Paused", "Finished"
function normalizeStatus(status: string): string {
  return status.toLowerCase(); // "active", "paused", "finished"
}
```

**Change 6**: Handle stats differently

V3 sequences may not include inline stats like V1 campaigns. We may need to:
- Use the existing stats from upsert (preserve from CSV uploads)
- Or make additional API calls to get stats (slower but more accurate)

### Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/sync-reply-campaigns/index.ts` | Switch from V1 campaigns to V3 sequences |

### Expected Outcome

| Before | After |
|--------|-------|
| 0/6 campaigns synced (no teamId) | 6 sequences synced (filtered by teamId) |
| Strict filter excludes everything | Strict filter correctly isolates workspace |
| Uses V1 API (deprecated patterns) | Uses V3 API (modern, includes teamId) |

### Note on Terminology

Reply.io uses:
- **Campaigns** in V1 API - older concept
- **Sequences** in V3 API - newer concept with same purpose

Our database table is called `synced_campaigns` but will store V3 "sequences". The external_campaign_id will contain the V3 sequence ID.

