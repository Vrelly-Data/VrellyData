

## Fix Reply.io V3 Webhook API Payload Format

### Problem Identified

The V3 webhook creation is failing with a 404 because the payload format is incorrect:

| Current (Wrong) | Expected (V3 API) |
|-----------------|-------------------|
| `teamId: 383893` | `subscriptionLevel: "team"` + `teamIds: [383893]` |

The Reply.io V3 API requires:
- `subscriptionLevel` to specify the scope (`account`, `team`, `sequence`, or `organization`)
- `teamIds` (plural, array) when using team-level subscriptions

### Solution

Update the payload construction in `setup-reply-webhook/index.ts` to use the correct V3 format.

---

### Technical Changes

**File:** `supabase/functions/setup-reply-webhook/index.ts`

**Lines 112-122** - Update payload structure:

```typescript
// Before (incorrect)
const payload: Record<string, unknown> = {
  targetUrl: webhookUrl,
  eventTypes: ALL_EVENT_TYPES,
  secret: webhookSecret,
};

if (integration.reply_team_id) {
  payload.teamId = parseInt(integration.reply_team_id, 10);
}

// After (correct V3 format)
const payload: Record<string, unknown> = {
  targetUrl: webhookUrl,
  eventTypes: ALL_EVENT_TYPES,
  secret: webhookSecret,
};

if (integration.reply_team_id) {
  // V3 API requires subscriptionLevel + teamIds (plural, array)
  payload.subscriptionLevel = 'team';
  payload.teamIds = [parseInt(integration.reply_team_id, 10)];
} else {
  // Default to account-level if no team specified
  payload.subscriptionLevel = 'account';
}
```

---

### Expected Outcome

| Before | After |
|--------|-------|
| `{"teamId": 383893}` | `{"subscriptionLevel": "team", "teamIds": [383893]}` |
| 404 error | 201 success with webhook ID |

After this fix, clicking the refresh button will successfully register the V3 webhook with Reply.io.

