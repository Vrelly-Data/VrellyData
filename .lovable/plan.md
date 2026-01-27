

## Fix: Reply.io Webhook API v2 - Correct Endpoint Path and Single-Event Subscriptions

### Root Cause Found

The Reply.io API documentation shows the webhook endpoint is:

| Current (WRONG) | Correct (per API docs) |
|-----------------|------------------------|
| `https://api.reply.io/v3/webhooks` | `https://api.reply.io/api/v2/webhooks` |

Notice the `/api/` segment in the path that was missing! Also, v2 uses **one event per subscription**, not an array.

### Current Logs

```
"Reply.io webhook response: 404 " (empty body)
```

This is because `/v3/webhooks` doesn't exist - it should be `/api/v2/webhooks`.

---

### Solution

Rewrite `setup-reply-webhook` to use the correct v2 API:

1. **Correct endpoint**: `POST https://api.reply.io/api/v2/webhooks`
2. **Single event per call**: Create multiple subscriptions (one per event type)
3. **v2 payload format**:
   ```json
   {
     "event": "email_replied",
     "url": "https://...webhook-url..."
   }
   ```
4. **For minimal approach (per your preference)**: Start with just 2 events:
   - `email_replied`
   - `linkedin_message_replied` (if supported)

5. **Store webhook IDs**: Save all created subscription IDs (comma-separated) in `webhook_subscription_id`

---

### Implementation Changes

#### File: `supabase/functions/setup-reply-webhook/index.ts`

1. **Change base URL**:
   - FROM: `https://api.reply.io/v3/webhooks`
   - TO: `https://api.reply.io/api/v2/webhooks`

2. **Change delete URL**:
   - FROM: `https://api.reply.io/v3/webhooks/{id}`
   - TO: `https://api.reply.io/api/v2/webhooks/{id}` (may be DELETE or different endpoint)

3. **Change payload to v2 format** (single event):
   ```typescript
   // v2 format - one event per subscription
   const webhookPayload = {
     event: 'email_replied',
     url: webhookUrl,
   };
   ```

4. **Create multiple subscriptions** (minimal set first):
   - Loop through events and create one subscription per event
   - Store all subscription IDs

5. **Remove v3-specific fields**:
   - Remove `targetUrl` (use `url`)
   - Remove `eventTypes` (use `event`)
   - Remove `secret` (v2 doesn't support HMAC)
   - Remove `subscriptionLevel`, `teamIds`, `accountId`

6. **Simplify webhook receiver**:
   - Remove HMAC signature verification (v2 doesn't support it)
   - Keep basic event processing

---

### Simplified Payload Comparison

| v3 (Wrong) | v2 (Correct) |
|------------|--------------|
| `targetUrl` | `url` |
| `eventTypes: [...]` | `event: "..."` (single string) |
| `secret` | Not supported |
| `subscriptionLevel` | Not applicable |

---

### Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/setup-reply-webhook/index.ts` | Use `/api/v2/webhooks`, v2 payload format, loop for multiple events |
| `supabase/functions/reply-webhook/index.ts` | Remove HMAC verification (optional simplification) |

---

### Code Structure (Minimal Approach)

```typescript
const WEBHOOK_API_BASE = 'https://api.reply.io/api/v2/webhooks';

// Minimal events for debugging
const eventsToSubscribe = [
  'email_replied',
  'email_sent',  // Optional: add more later
];

const webhookIds: string[] = [];

for (const event of eventsToSubscribe) {
  const response = await fetch(WEBHOOK_API_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify({
      event,
      url: webhookUrl,
    }),
  });
  
  if (response.ok) {
    const data = await response.json();
    webhookIds.push(data.id);
  }
}

// Store all IDs
await supabase
  .from('outbound_integrations')
  .update({
    webhook_subscription_id: webhookIds.join(','),
    webhook_status: webhookIds.length > 0 ? 'active' : 'error',
  })
  .eq('id', integrationId);
```

---

### Testing After Implementation

1. Click "Enable Live" on your Reply.io integration
2. Check edge function logs for:
   - `Reply.io webhook response: 201` (created)
   - Subscription ID in response
3. Verify the "Live" badge appears
4. Once working, expand to include more events

---

### Technical Notes

- v2 API requires the `/api/` path segment
- Each subscription is for a single event
- No HMAC signature support in v2 (per your preference for no verification)
- Team ID not required for basic webhook registration

