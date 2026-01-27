

## Fix: Reply.io Webhook Registration (v2 → v3 API)

### What Went Wrong

When you clicked "Enable Live", the backend tried to register a webhook with Reply.io but got a **404 error**:

| Issue | Details |
|-------|---------|
| Wrong API Version | Code calls `https://api.reply.io/v2/webhooks` |
| Correct Endpoint | Should be `https://api.reply.io/v3/webhooks` |
| Result | 404 error, webhook not registered |

### The Fix

Update the `setup-reply-webhook` Edge Function to use the correct v3 API endpoint and add explicit `subscriptionLevel` parameter.

---

### Code Changes

**File: `supabase/functions/setup-reply-webhook/index.ts`**

```text
Change line 94:
FROM: const response = await fetch('https://api.reply.io/v2/webhooks', {
TO:   const response = await fetch('https://api.reply.io/v3/webhooks', {

Add subscriptionLevel to payload (line 77-90):
const webhookPayload = {
  targetUrl: webhookUrl,
  secret: webhookSecret,
  subscriptionLevel: 'account',  // ADD THIS LINE
  eventTypes: [
    'email_sent',
    'email_replied', 
    'email_opened',
    'email_bounced',
    'linkedin_connection_request_sent',
    'linkedin_message_sent',
    'linkedin_replied',
    'contact_status_changed',
  ],
};
```

---

### How It Will Work After The Fix

```text
┌─────────────────────────────────────────────────────────────────┐
│                     User clicks "Enable Live"                   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              setup-reply-webhook Edge Function                  │
│                                                                 │
│  1. Generate random webhook_secret                              │
│  2. POST to https://api.reply.io/v3/webhooks                    │
│     - targetUrl: your unique webhook URL                        │
│     - secret: HMAC signing key                                  │
│     - subscriptionLevel: "account"                              │
│     - eventTypes: email + LinkedIn events                       │
│  3. Store webhook_subscription_id in database                   │
│  4. Set webhook_status = 'active'                               │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Reply.io starts sending events                 │
│                                                                 │
│  Every email/LinkedIn activity triggers a POST to:              │
│  https://srartzeqcbxbytfixeiv.supabase.co/functions/v1/         │
│       reply-webhook/{your-integration-id}                       │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              reply-webhook Edge Function                        │
│                                                                 │
│  1. Verify HMAC signature                                       │
│  2. Parse event type (email_sent, linkedin_replied, etc.)       │
│  3. Update synced_campaigns.stats                               │
│  4. Update synced_contacts.engagement_data                      │
│  5. Log to webhook_events table                                 │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Dashboard shows live metrics!                   │
│                                                                 │
│  📧 Emails Sent: 709                                            │
│  🔗 LinkedIn Messages: 234                                      │
│  🔗 Connection Requests: 156                                    │
│                                                                 │
│  ✓ Real-time via webhooks                                       │
└─────────────────────────────────────────────────────────────────┘
```

---

### Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/setup-reply-webhook/index.ts` | Change v2 to v3 endpoint, add `subscriptionLevel: 'account'` |

---

### After Implementation

1. Click "Enable Live" again
2. The webhook should register successfully with Reply.io v3 API
3. You'll see the "Live" badge appear on your integration
4. Reply.io will start sending events to your webhook endpoint
5. LinkedIn metrics will populate in real-time as activity occurs

