
## Fix Reply.io Webhooks - Upgrade to V3 API

### Problem Identified

The webhook system stopped working because:

1. **Using deprecated V2 API**: The setup function uses `https://api.reply.io/api/v2/webhooks` but Reply.io now uses V3
2. **Reply.io disables webhooks after 5 consecutive failures** or no successful delivery in 48 hours
3. **V2 webhooks may no longer be supported** by Reply.io, causing delivery failures

Evidence:
- Webhooks were working until ~8 hours ago (last event at 13:03:49 UTC)
- Database shows 10 webhook subscription IDs (one per event type - V2 style)
- V3 API supports multiple event types per subscription and HMAC signing

---

### Solution Overview

Upgrade the webhook setup to use Reply.io V3 API with:
1. Single subscription for all event types (instead of 10 separate ones)
2. HMAC signature verification for security
3. Better error handling and logging
4. Re-registration flow in the UI

---

### Technical Implementation

**File 1: Update Setup Webhook Function**
`supabase/functions/setup-reply-webhook/index.ts`

Changes:
- Switch from V2 to V3 API: `https://api.reply.io/v3/webhooks`
- Use `eventTypes` array instead of single `event` per subscription
- Generate and store HMAC `secret` for payload verification
- Use `subscriptionLevel: 'account'` or `'team'` based on configuration

```typescript
// Before (V2 - one subscription per event)
const WEBHOOK_API_BASE = 'https://api.reply.io/api/v2/webhooks';
const payload = { event: 'email_replied', url: webhookUrl };

// After (V3 - all events in one subscription)
const WEBHOOK_API_BASE = 'https://api.reply.io/v3/webhooks';
const payload = {
  targetUrl: webhookUrl,
  eventTypes: ['email_replied', 'email_sent', 'email_opened', ...],
  secret: generatedHmacSecret,  // For signature verification
  subscriptionLevel: 'account'
};
```

**File 2: Add HMAC Signature Verification**
`supabase/functions/reply-webhook/index.ts`

Changes:
- Verify `X-Reply-Signature` header using HMAC-SHA256
- Reject requests without valid signature
- Add timing-safe comparison to prevent timing attacks

```typescript
import { createHmac, timingSafeEqual } from 'node:crypto';

// Verify webhook signature
const signature = req.headers.get('x-reply-signature');
const webhookSecret = integration.webhook_secret;

if (webhookSecret && signature) {
  const expectedSig = createHmac('sha256', webhookSecret)
    .update(payload)
    .digest('hex');
  
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
    return new Response('Invalid signature', { status: 401 });
  }
}
```

**File 3: Update Integration Hook**
`src/hooks/useOutboundIntegrations.ts`

Changes:
- Add better error messages for webhook setup failures
- Add "Re-enable Webhooks" button when status is error/inactive

**File 4: Update UI**
`src/components/playground/IntegrationSetupCard.tsx`

Changes:
- Show webhook status badge (Active/Error/Inactive)
- Add "Re-enable Live Updates" button when webhooks are disabled
- Show last successful webhook timestamp if available

---

### Migration Steps

1. Deploy updated edge functions
2. Click "Re-enable Live Updates" in the UI
3. System will:
   - Delete old V2 webhook subscriptions
   - Create new V3 subscription with all event types
   - Store HMAC secret for verification
4. Verify new webhook is active in Reply.io

---

### Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/setup-reply-webhook/index.ts` | Upgrade to V3 API, single subscription, HMAC secret |
| `supabase/functions/reply-webhook/index.ts` | Add HMAC signature verification |
| `src/hooks/useOutboundIntegrations.ts` | Better error handling for webhook status |
| `src/components/playground/IntegrationSetupCard.tsx` | Webhook status UI and re-enable button |

---

### Expected Outcome

| Current State | After Fix |
|--------------|-----------|
| V2 API (deprecated) | V3 API (current) |
| 10 separate subscriptions | 1 subscription for all events |
| No signature verification | HMAC-SHA256 verification |
| Webhooks disabled by Reply.io | Active webhooks with retry support |
| No way to re-enable | "Re-enable Live Updates" button |
