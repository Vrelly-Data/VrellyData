

## Fix: Add LinkedIn Events to Webhook Subscriptions

### Current State

| What | Status |
|------|--------|
| Webhook API | Working (v2 at `/api/v2/webhooks`) |
| Subscriptions Created | `email_replied`, `email_sent` only |
| LinkedIn Events | NOT subscribed |
| Webhook IDs | `15041, 15042` |

The reason LinkedIn data isn't populating is simple: we chose "minimal first" and only subscribed to 2 email events. No LinkedIn events are being captured.

---

### Solution

Expand the webhook subscriptions to include LinkedIn events by updating `setup-reply-webhook/index.ts` and re-running "Enable Live":

```typescript
// Current (minimal)
const EVENTS_TO_SUBSCRIBE = [
  'email_replied',
  'email_sent',
];

// Expanded (with LinkedIn)
const EVENTS_TO_SUBSCRIBE = [
  // Email events
  'email_replied',
  'email_sent',
  'email_opened',
  'email_bounced',
  // LinkedIn events  
  'linkedin_message_sent',
  'linkedin_message_replied',
  'linkedin_connection_request_sent',
  'linkedin_connection_request_accepted',
  // Lifecycle events
  'contact_finished',
  'contact_opted_out',
];
```

---

### Also: Update Webhook Receiver to Handle LinkedIn Events

The `reply-webhook/index.ts` needs to process LinkedIn event types and store them properly:

```typescript
case 'linkedin_message_sent':
  stats.linkedinMessagesSent = (stats.linkedinMessagesSent || 0) + 1;
  break;
case 'linkedin_message_replied':
  stats.linkedinReplies = (stats.linkedinReplies || 0) + 1;
  break;
case 'linkedin_connection_request_sent':
  stats.linkedinConnectionsSent = (stats.linkedinConnectionsSent || 0) + 1;
  break;
case 'linkedin_connection_request_accepted':
  stats.linkedinConnectionsAccepted = (stats.linkedinConnectionsAccepted || 0) + 1;
  break;
```

---

### Implementation Steps

1. **Update `supabase/functions/setup-reply-webhook/index.ts`**
   - Expand `EVENTS_TO_SUBSCRIBE` array to include all LinkedIn event types

2. **Update `supabase/functions/reply-webhook/index.ts`**
   - Add switch cases for LinkedIn events
   - Store LinkedIn-specific metrics in campaign stats

3. **Re-deploy edge functions**

4. **Click "Enable Live" again**
   - This will delete old subscriptions (15041, 15042)
   - Create new subscriptions for all 10 events

---

### Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/setup-reply-webhook/index.ts` | Add LinkedIn + lifecycle events to `EVENTS_TO_SUBSCRIBE` |
| `supabase/functions/reply-webhook/index.ts` | Add handlers for LinkedIn event types |

---

### Testing After Implementation

1. Click "Enable Live" on your Reply.io integration
2. Check that webhook_subscription_id now contains ~10 IDs
3. In Reply.io, trigger a LinkedIn action (send connection request or message)
4. Check the `webhook_events` table for incoming data
5. Verify "Total Messages Sent" tooltip shows LinkedIn metrics

---

### Important Notes

- Each webhook is created separately (v2 API limitation)
- LinkedIn events will only capture NEW activity after webhook is set up
- Historical LinkedIn data is not available via API (Reply.io limitation)
- The tooltip breakdown will show "Not tracked" until first LinkedIn event arrives

