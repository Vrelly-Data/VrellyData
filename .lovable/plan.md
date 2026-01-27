

## Plan: Implement Reply.io Webhooks for Real-Time Data Sync

### Why Webhooks Solve Our Problem

| Current Approach (Polling) | Webhook Approach |
|---------------------------|------------------|
| Manual sync button required | Automatic real-time updates |
| Rate limited by Reply.io API | No rate limits on incoming events |
| Missing LinkedIn send/reply counts | Full LinkedIn activity data available |
| `/steps` endpoint returns 404 | Events include step type directly |

### Reply.io Webhook Events We'll Subscribe To

| Event Type | What It Gives Us |
|------------|------------------|
| `email_sent` | Email delivery count |
| `email_replied` | Email reply count |
| `email_opened` | Email open count |
| `linkedin_connection_request_sent` | LinkedIn connection requests |
| `linkedin_message_sent` | LinkedIn messages sent |
| `linkedin_replied` | LinkedIn replies received |
| `contact_status_changed` | Status updates for all channels |

---

### Architecture Overview

```text
                                    ┌─────────────────────────────────────┐
                                    │           Reply.io                  │
                                    │  (User's campaigns and contacts)    │
                                    └────────────────┬────────────────────┘
                                                     │
                                    Webhook POST to each user's unique URL
                                                     │
                                                     ▼
    ┌────────────────────────────────────────────────────────────────────────┐
    │                    reply-webhook Edge Function                         │
    │                                                                        │
    │  1. Verify HMAC signature using integration's webhook_secret           │
    │  2. Extract integration_id from URL path                               │
    │  3. Update synced_campaigns / synced_contacts based on event type      │
    │  4. Log activity in webhook_events table for debugging                 │
    └────────────────────────────────────────────────────────────────────────┘
                                                     │
                                                     ▼
                              ┌──────────────────────────────────────┐
                              │           Supabase Database          │
                              │                                      │
                              │  synced_campaigns (updated stats)    │
                              │  synced_contacts (engagement data)   │
                              │  webhook_events (activity log)       │
                              └──────────────────────────────────────┘
```

---

### Phase 1: Database Schema Updates

**Add webhook tracking columns to `outbound_integrations`:**

```sql
ALTER TABLE outbound_integrations 
ADD COLUMN webhook_subscription_id TEXT,     -- Reply.io webhook subscription ID
ADD COLUMN webhook_secret TEXT,              -- HMAC secret for verification
ADD COLUMN webhook_status TEXT DEFAULT 'not_configured';  -- not_configured, active, error
```

**Create `webhook_events` table for activity logging:**

```sql
CREATE TABLE public.webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID NOT NULL REFERENCES outbound_integrations(id) ON DELETE CASCADE,
  team_id UUID NOT NULL,
  event_type TEXT NOT NULL,           -- e.g. 'email_sent', 'linkedin_replied'
  contact_email TEXT,
  campaign_external_id TEXT,
  event_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: Team members can view their webhook events
CREATE POLICY "Users can view team webhook events" ON webhook_events FOR SELECT
  USING (team_id = get_user_team_id(auth.uid()));

-- Enable realtime for live dashboard updates
ALTER PUBLICATION supabase_realtime ADD TABLE webhook_events;
```

---

### Phase 2: Create Webhook Handler Edge Function

**New file: `supabase/functions/reply-webhook/index.ts`**

This function will:
1. Parse the integration ID from the URL path (e.g., `/reply-webhook/{integration_id}`)
2. Verify the HMAC signature using the integration's `webhook_secret`
3. Route events to appropriate handlers based on `event_type`
4. Update `synced_campaigns` and `synced_contacts` in real-time

**Webhook URL format:**
```
https://srartzeqcbxbytfixeiv.supabase.co/functions/v1/reply-webhook/{integration_id}
```

**Event handling logic:**

```typescript
switch (eventType) {
  case 'email_sent':
    // Increment campaign stats.sent
    // Update contact engagement_data.lastEmailSent
    break;
  
  case 'email_replied':
    // Increment campaign stats.replies
    // Update contact engagement_data.replied = true
    // Update contact status to 'replied'
    break;
    
  case 'linkedin_connection_request_sent':
    // Increment campaign stats.linkedinConnectionsSent
    // Update contact engagement_data.linkedinConnectionSent = true
    break;
    
  case 'linkedin_replied':
    // Increment campaign stats.linkedinReplies
    // Update contact engagement_data.linkedinReplied = true
    break;
    
  // ... other events
}
```

---

### Phase 3: Webhook Registration on Integration Setup

**When user adds a Reply.io integration:**

1. Generate a random `webhook_secret` (32-byte hex string)
2. Call Reply.io v3 API to create webhook subscription:
   ```
   POST https://api.reply.io/v3/webhooks
   {
     "targetUrl": "https://{supabase}/functions/v1/reply-webhook/{integration_id}",
     "secret": "{webhook_secret}",
     "eventTypes": [
       "email_sent", "email_replied", "email_opened",
       "linkedin_connection_request_sent", "linkedin_message_sent", "linkedin_replied",
       "contact_status_changed"
     ],
     "subscriptionLevel": "account"
   }
   ```
3. Store `webhook_subscription_id` and `webhook_secret` in `outbound_integrations`
4. Set `webhook_status = 'active'`

**New Edge Function: `supabase/functions/setup-reply-webhook/index.ts`**

This function handles the v3 API call to register the webhook with Reply.io.

---

### Phase 4: Update Stats Aggregation

**Enhanced `synced_campaigns.stats` schema:**

```typescript
interface CampaignStats {
  // Email metrics (from API + webhooks)
  sent: number;
  delivered: number;
  opens: number;
  replies: number;
  bounces: number;
  
  // LinkedIn metrics (from webhooks)
  linkedinConnectionsSent: number;
  linkedinConnectionsAccepted: number;
  linkedinMessagesSent: number;
  linkedinReplies: number;
  
  // General
  peopleCount: number;
  peopleFinished: number;
}
```

**Update `usePlaygroundStats` to aggregate new fields:**

```typescript
const linkedinMessagesSent = campaigns.reduce(
  (sum, c) => sum + (c.stats?.linkedinMessagesSent || 0), 0
);
const linkedinConnectionsSent = campaigns.reduce(
  (sum, c) => sum + (c.stats?.linkedinConnectionsSent || 0), 0
);
const linkedinReplies = campaigns.reduce(
  (sum, c) => sum + (c.stats?.linkedinReplies || 0), 0
);
```

---

### Phase 5: Update UI to Show Real LinkedIn Metrics

**Updated "Total Messages Sent" tooltip:**

```text
┌──────────────────────────────────────────┐
│  Messages Breakdown                      │
│  ──────────────────                      │
│                                          │
│  📧 Emails Sent: 709                     │
│  🔗 LinkedIn Messages: 234               │
│  🔗 Connection Requests: 156             │
│                                          │
│  ✓ Real-time via webhooks                │
└──────────────────────────────────────────┘
```

**Updated "Total Replies" tooltip:**

```text
┌──────────────────────────────────────────┐
│  Replies Breakdown                       │
│  ────────────────                        │
│                                          │
│  📧 Email Replies: 10                    │
│  🔗 LinkedIn Replies: 5                  │
│                                          │
│  ✓ Real-time via webhooks                │
└──────────────────────────────────────────┘
```

---

### Phase 6: UI for Webhook Management

**Add webhook status indicator to `IntegrationSetupCard`:**

- Show "Webhooks: Active ✓" badge when configured
- Show "Enable Webhooks" button if not configured
- Show "Webhooks: Error" with retry button if registration failed

**Webhook status in integration details:**

```tsx
{integration.webhook_status === 'active' && (
  <Badge variant="outline" className="text-green-600 border-green-600">
    <Zap className="h-3 w-3 mr-1" />
    Live Updates
  </Badge>
)}
```

---

### Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `supabase/migrations/xxx.sql` | Create | Add webhook columns + webhook_events table |
| `supabase/functions/reply-webhook/index.ts` | Create | Receive and process Reply.io webhook events |
| `supabase/functions/setup-reply-webhook/index.ts` | Create | Register webhook with Reply.io v3 API |
| `supabase/config.toml` | Modify | Add `verify_jwt = false` for reply-webhook |
| `src/hooks/useOutboundIntegrations.ts` | Modify | Add webhook fields + setup mutation |
| `src/hooks/usePlaygroundStats.ts` | Modify | Aggregate new LinkedIn metric fields |
| `src/components/playground/IntegrationSetupCard.tsx` | Modify | Add webhook status indicator |
| `src/components/playground/PlaygroundStatsGrid.tsx` | Modify | Show actual LinkedIn counts instead of "Not tracked" |

---

### Implementation Order

1. **Database migration** - Add webhook tracking columns and events table
2. **reply-webhook Edge Function** - Build the webhook receiver with HMAC verification
3. **setup-reply-webhook Edge Function** - Register webhook with Reply.io
4. **Frontend integration** - Trigger webhook setup when adding integration
5. **Stats aggregation** - Update hooks to use new LinkedIn fields
6. **UI updates** - Show live LinkedIn metrics with "Real-time" indicator

---

### Security Considerations

- **HMAC Verification**: Every incoming webhook is verified using the integration's `webhook_secret`
- **Integration-Specific URLs**: Each integration has its own webhook URL with `integration_id` in the path
- **No JWT Required**: The webhook endpoint uses `verify_jwt = false` since Reply.io can't send JWTs, but HMAC verification provides security
- **RLS on Events Table**: Team members can only view their team's webhook events

---

### Benefits Over Current Approach

| Metric | Before (Polling) | After (Webhooks) |
|--------|------------------|------------------|
| LinkedIn Messages Sent | ❌ Not tracked | ✅ Real count |
| LinkedIn Connection Requests | ❌ Not tracked | ✅ Real count |
| LinkedIn Replies | ❌ Not tracked | ✅ Real count |
| Data freshness | Manual sync | Real-time |
| API rate limits | Hit frequently | Not applicable |
| User action required | Click "Sync" | Automatic |

