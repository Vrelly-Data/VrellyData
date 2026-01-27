

## Fix: Reply.io Webhook API - Correct Endpoint URL

### Problem Analysis

Looking at the edge function logs, the key finding is:

| Observation | Value |
|-------------|-------|
| API Response | `404` with **empty body** |
| v1 endpoints | Working fine (emailAccounts returns 200) |
| v3/webhooks | Returns 404 |

An empty 404 response typically means **the endpoint URL itself doesn't exist**, not that the request is invalid.

### Root Cause

Based on the Reply.io API documentation link you provided, the webhook endpoint uses a different path structure:

| Current (Wrong) | Correct (Per Docs) |
|-----------------|-------------------|
| `POST /v3/webhooks` | `POST /v2/push/subscriptions` |

The Reply.io API uses `/v2/push/subscriptions` for webhook management, not `/v3/webhooks`.

---

### Solution

Update the `setup-reply-webhook` Edge Function to use the correct endpoint:

```text
FROM: https://api.reply.io/v3/webhooks
TO:   https://api.reply.io/v2/push/subscriptions
```

Also update the payload structure to match the v2 API format:

```typescript
// v2 push/subscriptions format
const webhookPayload = {
  url: webhookUrl,           // "url" not "targetUrl"
  events: [                  // "events" not "eventTypes"
    'email_sent',
    'email_replied', 
    'email_opened',
    'email_bounced',
    'linkedin_connection_request_sent',
    'linkedin_connection_request_accepted',
    'linkedin_message_sent',
    'linkedin_message_replied',
    'contact_finished',
    'contact_opted_out',
  ],
};
```

---

### Code Changes

**File: `supabase/functions/setup-reply-webhook/index.ts`**

1. **Change endpoint URL** (lines 174, 192):
   - FROM: `https://api.reply.io/v3/webhooks`
   - TO: `https://api.reply.io/v2/push/subscriptions`

2. **Update payload field names** (lines 143-161):
   - Change `targetUrl` to `url`
   - Change `eventTypes` to `events`
   - Remove `secret` if not supported by v2 (may need to store locally for verification)

3. **Update DELETE endpoint** (line 121):
   - FROM: `https://api.reply.io/v3/webhooks/${id}`
   - TO: `https://api.reply.io/v2/push/subscriptions/${id}`

---

### Updated Payload Structure

```typescript
const webhookPayload: Record<string, unknown> = {
  url: webhookUrl,
  events: [
    // Email events
    'email_sent',
    'email_replied', 
    'email_opened',
    'email_bounced',
    // LinkedIn events
    'linkedin_connection_request_sent',
    'linkedin_connection_request_accepted',
    'linkedin_message_sent',
    'linkedin_message_replied',
    // Contact lifecycle events
    'contact_finished',
    'contact_opted_out',
  ],
};
```

---

### Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/setup-reply-webhook/index.ts` | Change v3/webhooks to v2/push/subscriptions, update payload field names |

---

### Testing After Implementation

1. Click "Enable Live" on your Reply.io integration
2. Check edge function logs for:
   - `Reply.io webhook response: 200` or `201`
   - A subscription ID in the response
3. Verify the "Live" badge appears on the integration card

---

### Technical Notes

The Reply.io API documentation at the link you provided shows the Push Subscription endpoints use:
- `POST /v2/push/subscriptions` - Create subscription
- `GET /v2/push/subscriptions` - List subscriptions
- `DELETE /v2/push/subscriptions/{id}` - Delete subscription

The v3/webhooks path we were using appears to not exist in the Reply.io API, which explains the 404 with empty body.

