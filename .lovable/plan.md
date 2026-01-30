

## Fix Webhook Handler to Process LinkedIn Events

### Problems Found

| Issue | Expected | Actual |
|-------|----------|--------|
| Event type format | `linkedin_connection_request_sent` | `LinkedInConnectionRequestSent` |
| Campaign ID location | `event.campaignId` | `event.sequence_fields.id` |
| Event type storage | Just the type string | Entire event object JSON |

This is why webhooks are logged but stats aren't updating in real-time.

---

### Solution

Update the `reply-webhook` edge function to:

1. **Extract event type correctly** - Use `event.event?.type` which contains the PascalCase type
2. **Handle PascalCase event types** - Map Reply.io's format to our switch cases
3. **Extract campaign ID correctly** - Look in `event.sequence_fields?.id`
4. **Store clean event type** - Just the type string, not the whole object

---

### Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/reply-webhook/index.ts` | Fix event parsing, add PascalCase support, extract campaign ID from sequence_fields |

---

### Code Changes

```typescript
// BEFORE (broken)
const eventType = event.event || event.type || 'unknown';
const campaignId = event.campaignId || event.campaign_id || event.data?.campaignId;

// AFTER (fixed)
const eventType = event.event?.type || event.type || 'unknown';
const campaignId = event.sequence_fields?.id || event.campaignId || event.campaign_id;
```

And update the switch statement to handle PascalCase:

```typescript
switch (eventType) {
  case 'EmailSent':
  case 'email_sent':
    stats.sent = (stats.sent || 0) + 1;
    break;
  case 'LinkedInConnectionRequestSent':
  case 'linkedin_connection_request_sent':
    stats.linkedinConnectionsSent = (stats.linkedinConnectionsSent || 0) + 1;
    break;
  // ... etc
}
```

---

### Expected Result

After this fix:
- Real-time LinkedIn events will update campaign stats
- New connection requests/acceptances will increment counters
- Email replies will be tracked via webhooks
- Dashboard will show live data without needing CSV uploads

