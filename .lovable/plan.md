

## Fix Reply.io Integration: Sync Stats Not Visible + Webhook 404 Error

### Problems Identified

| Issue | Symptom | Root Cause |
|-------|---------|------------|
| **Stats not updating** | Sync completes but dashboard doesn't show new stats | All 62 campaigns have `is_linked: false` - they aren't being included in dashboard aggregations |
| **Webhook 404** | "Enable Live" fails with 404 even after fallback to account-level | Reply.io V3 API requires `accountId` for account-level subscriptions, but we're not providing it |

---

### Investigation Findings

**Sync is working correctly** - the logs show all 62 campaigns synced with stats:
```
Fast sync complete: 62/62 campaigns processed
```

The database confirms campaigns have stats (e.g., `sent:22, replies:0, opens:0`), but **none are linked**:
```sql
SELECT is_linked FROM synced_campaigns → all false
```

**Webhook probe passes, creation fails**:
```
V3 probe result: 200 OK
Reply.io V3 response (account): 404 (empty body)
```

Per Reply.io V3 documentation, the `accountId` field is required for account-level subscriptions:
> `accountId` (integer): Specific account ID (when subscriptionLevel = 'account')

---

### Solution Overview

```text
┌─────────────────────────────────────────────────────────────────┐
│  FIX 1: Webhook Creation                                        │
│  ─────────────────────────                                      │
│  • Fetch accountId from V3 user/profile endpoint before         │
│    creating webhook                                             │
│  • Include accountId in payload for account-level subscriptions │
│  • Add detailed error logging for 404 responses                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  FIX 2: Campaign Visibility                                     │
│  ─────────────────────────                                      │
│  • Either auto-link all campaigns during sync, OR               │
│  • Surface "Manage Campaigns" more prominently after sync       │
│  • Show count of unlinked campaigns needing action              │
└─────────────────────────────────────────────────────────────────┘
```

---

### Technical Changes

#### File 1: `supabase/functions/setup-reply-webhook/index.ts`

**Change 1**: Fetch the account ID from Reply.io API before creating webhook

Add after the V3 probe succeeds (around line 167):

```typescript
// Fetch accountId for account-level subscriptions
let accountId: number | null = null;
try {
  const accountResponse = await fetch('https://api.reply.io/v1/actions/me', {
    headers: { 'X-Api-Key': apiKey },
  });
  if (accountResponse.ok) {
    const accountData = await accountResponse.json();
    accountId = accountData.id || accountData.accountId || null;
    console.log('Retrieved accountId:', accountId);
  }
} catch (e) {
  console.log('Could not fetch accountId, will try without it');
}
```

**Change 2**: Include accountId in account-level webhook payload

Modify `attemptWebhookCreation` function (lines 207-239):

```typescript
async function attemptWebhookCreation(
  subscriptionLevel: 'team' | 'account',
  teamIds?: number[],
  accountIdParam?: number | null
): Promise<{ response: Response; responseText: string }> {
  const payload: Record<string, unknown> = {
    targetUrl: webhookUrl,
    eventTypes: ALL_EVENT_TYPES,
    secret: webhookSecret,
    subscriptionLevel,
  };
  
  if (subscriptionLevel === 'team' && teamIds && teamIds.length > 0) {
    payload.teamIds = teamIds;
  }
  
  // Include accountId for account-level subscriptions
  if (subscriptionLevel === 'account' && accountIdParam) {
    payload.accountId = accountIdParam;
  }
  
  // ... rest of function
}
```

**Change 3**: Pass accountId to fallback calls

```typescript
// First attempt: team-level if reply_team_id is set
if (integration.reply_team_id) {
  const teamId = parseInt(integration.reply_team_id, 10);
  const result = await attemptWebhookCreation('team', [teamId]);
  // ...
  if (result.response.status === 404) {
    const fallbackResult = await attemptWebhookCreation('account', undefined, accountId);
    // ...
  }
} else {
  const result = await attemptWebhookCreation('account', undefined, accountId);
  // ...
}
```

---

#### File 2: `src/components/playground/IntegrationSetupCard.tsx`

**Change**: Show count of unlinked campaigns after sync

Add after sync completes - show a notification or badge indicating campaigns need to be linked:

```typescript
// In IntegrationRow, add unlinked campaign count display
{isReplyIo && integration.sync_status === 'synced' && (
  <span className="text-xs text-amber-600">
    Sync complete - use "Manage Campaigns" to link campaigns for dashboard
  </span>
)}
```

---

#### File 3: `supabase/functions/sync-reply-campaigns/index.ts` (Optional Enhancement)

**Alternative Approach**: Auto-link all campaigns during sync

If the user wants all campaigns to appear in stats automatically, modify the upsert to set `is_linked: true`:

```typescript
// Around line 195, change:
is_linked: existingCampaign?.is_linked ?? false  // preserve existing

// To (if auto-link is desired):
is_linked: true  // Auto-link all campaigns
```

---

### Files to Modify

| File | Priority | Changes |
|------|----------|---------|
| `supabase/functions/setup-reply-webhook/index.ts` | **Critical** | Fetch accountId, include in payload |
| `src/components/playground/IntegrationSetupCard.tsx` | Medium | Show campaign linking guidance |
| `supabase/functions/sync-reply-campaigns/index.ts` | Optional | Auto-link campaigns if desired |

---

### Expected Outcome

| Before | After |
|--------|-------|
| Webhook creation: 404 error | Webhook creation: 201 success with accountId |
| Stats appear empty after sync | Either auto-linked OR clear guidance to link campaigns |
| Generic error messages | Specific diagnostic errors with accountId info |

---

### Question for You

For the campaign linking behavior, which would you prefer?

1. **Auto-link all campaigns** - Every synced campaign automatically appears in dashboard stats
2. **Keep manual linking** - User selects which campaigns to include via "Manage Campaigns" (current behavior, but with better guidance)

