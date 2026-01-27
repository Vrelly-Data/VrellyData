

## Fix: Reply.io Webhook Registration - Invalid Event Type Names

### Root Cause Identified

Looking at the edge function logs, the webhook payload contains **invalid event type names**:

```json
{
  "eventTypes": [
    "email_sent",           // Valid
    "email_replied",        // Valid
    "email_opened",         // Valid
    "email_bounced",        // Valid
    "linkedin_connection_request_sent", // Valid
    "linkedin_message_sent",            // Valid
    "linkedin_replied",                 // INVALID - should be linkedin_message_replied
    "contact_status_changed"            // INVALID - not a valid event type
  ]
}
```

According to the Reply.io API documentation:

| Current (Invalid) | Correct Event Type |
|-------------------|-------------------|
| `linkedin_replied` | `linkedin_message_replied` |
| `contact_status_changed` | `contact_finished` or `contact_opted_out` |

The v3 API is returning 404 because it doesn't recognize these event type names.

---

### Solution

Update the event types array in `setup-reply-webhook` to use the correct names from the Reply.io documentation.

---

### Code Changes

**File: `supabase/functions/setup-reply-webhook/index.ts`**

Change lines 146-155 from:

```typescript
eventTypes: [
  'email_sent',
  'email_replied', 
  'email_opened',
  'email_bounced',
  'linkedin_connection_request_sent',
  'linkedin_message_sent',
  'linkedin_replied',              // WRONG
  'contact_status_changed',        // WRONG
],
```

To:

```typescript
eventTypes: [
  // Email events
  'email_sent',
  'email_replied', 
  'email_opened',
  'email_bounced',
  // LinkedIn events
  'linkedin_connection_request_sent',
  'linkedin_connection_request_accepted',  // NEW: Track accepts too
  'linkedin_message_sent',
  'linkedin_message_replied',              // FIXED: Was linkedin_replied
  // Contact lifecycle events
  'contact_finished',                       // FIXED: Was contact_status_changed
  'contact_opted_out',                      // NEW: Track opt-outs
],
```

---

### Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/setup-reply-webhook/index.ts` | Fix event type names in lines 146-155 |
| `supabase/functions/reply-webhook/index.ts` | Update event handlers to match new event names |

---

### Technical Summary

The Reply.io v3 Webhooks API strictly validates event type names. The current code uses two invalid names:

1. **`linkedin_replied`** - The correct name per the docs is `linkedin_message_replied`
2. **`contact_status_changed`** - This event doesn't exist; use `contact_finished` or `contact_opted_out`

Once these are corrected, the webhook should register successfully since:
- The endpoint URL is correct (`https://api.reply.io/v3/webhooks`)
- The API key is valid (other endpoints like `/v1/emailAccounts` return 200)
- The `subscriptionLevel` defaults to `account` when not specified (per docs)

---

### After Implementation

1. Deploy the updated edge function
2. Click "Enable Live" on your Reply.io integration
3. The webhook should register successfully
4. You'll see the "Live" badge appear

