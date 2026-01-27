

## Fix: Reply.io Webhook Registration - Missing Account ID

### Problem Analysis

The webhook registration is failing with a **404 error** because the Reply.io v3 API requires specific parameters that are missing:

| Issue | Current State | Required |
|-------|--------------|----------|
| `subscriptionLevel` | `'account'` (provided) | Valid value |
| `accountId` | **Not provided** | **Required when level is 'account'** |
| Result | 404 Error | Needs account ID |

Looking at your logs, the `fetch-reply-teams` function returns "Final teams found: 0" because your email accounts don't have `teamId` fields. This means we need to discover your account ID through a different method.

---

### Solution: Fetch Account ID Before Registering Webhook

We'll modify the `setup-reply-webhook` Edge Function to:

1. **First call `/v1/accounts`** or `/v1/users/me` to get the current user's account ID
2. **Include that account ID** in the webhook registration payload
3. **Fall back** to trying without `subscriptionLevel` if account discovery fails

---

### Architecture Flow

```text
┌─────────────────────────────────────────────────────────────────┐
│                     User clicks "Enable Live"                   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              Step 1: Fetch Account ID                           │
│                                                                 │
│  GET https://api.reply.io/v1/accounts                           │
│  OR  https://api.reply.io/v1/users/me                           │
│                                                                 │
│  Extract: accountId from response                               │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              Step 2: Register Webhook with Account ID           │
│                                                                 │
│  POST https://api.reply.io/v3/webhooks                          │
│  {                                                              │
│    targetUrl: "...",                                            │
│    secret: "...",                                               │
│    subscriptionLevel: "account",                                │
│    accountId: 12345,           ← NEW: Include account ID        │
│    eventTypes: [...]                                            │
│  }                                                              │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              Step 3: Save webhook config to database            │
│                                                                 │
│  webhook_subscription_id, webhook_secret, webhook_status        │
└─────────────────────────────────────────────────────────────────┘
```

---

### Code Changes

**File: `supabase/functions/setup-reply-webhook/index.ts`**

**Changes:**
1. Add a new function to discover the account ID from Reply.io
2. Try multiple endpoints: `/v1/accounts`, `/v1/users/me`, `/v1/emailAccounts`
3. Include `accountId` in the webhook payload
4. Add a fallback path that tries without `subscriptionLevel` if account discovery fails

```typescript
// New function to discover account ID
async function discoverAccountId(apiKey: string): Promise<number | null> {
  // Try /v1/accounts endpoint
  try {
    const response = await fetch('https://api.reply.io/v1/accounts', {
      headers: { 'X-Api-Key': apiKey }
    });
    if (response.ok) {
      const data = await response.json();
      // Return first account ID found
      if (Array.isArray(data) && data.length > 0) {
        return data[0].id || data[0].accountId;
      }
      if (data.id || data.accountId) {
        return data.id || data.accountId;
      }
    }
  } catch (e) {
    console.log('Accounts endpoint failed:', e);
  }
  
  // Try /v1/users/me endpoint  
  try {
    const response = await fetch('https://api.reply.io/v1/users/me', {
      headers: { 'X-Api-Key': apiKey }
    });
    if (response.ok) {
      const data = await response.json();
      return data.accountId || data.account_id || data.teamId;
    }
  } catch (e) {
    console.log('Users/me endpoint failed:', e);
  }
  
  return null;
}
```

**Updated webhook payload logic:**

```typescript
// Discover account ID first
const accountId = await discoverAccountId(integration.api_key_encrypted);
console.log('Discovered account ID:', accountId);

// Build payload - include accountId if available
const webhookPayload: Record<string, unknown> = {
  targetUrl: webhookUrl,
  secret: webhookSecret,
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

// Only add subscription level and account ID if we discovered one
if (accountId) {
  webhookPayload.subscriptionLevel = 'account';
  webhookPayload.accountId = accountId;
} else {
  // Try without subscription level - let API default
  console.log('No account ID found, trying without subscriptionLevel');
}
```

---

### Fallback Strategy

If the v3 API still fails, we'll add a fallback to try:

1. **Without `subscriptionLevel`** - Let the API use its default
2. **Different event type names** - In case v3 uses different naming
3. **Log detailed error response** - For debugging

```typescript
if (!response.ok) {
  // Log full error for debugging
  console.error('Webhook registration failed:', {
    status: response.status,
    body: responseText,
    payload: webhookPayload,
  });
  
  // If 404 with subscriptionLevel, try without it
  if (response.status === 404 && webhookPayload.subscriptionLevel) {
    console.log('Retrying without subscriptionLevel...');
    delete webhookPayload.subscriptionLevel;
    delete webhookPayload.accountId;
    
    // Retry the request
    const retryResponse = await fetch('https://api.reply.io/v3/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': integration.api_key_encrypted,
      },
      body: JSON.stringify(webhookPayload),
    });
    
    // Handle retry response...
  }
}
```

---

### Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/setup-reply-webhook/index.ts` | Add account discovery, include `accountId` in payload, add fallback logic |

---

### Testing After Implementation

1. Click "Enable Live" again
2. Check edge function logs for:
   - "Discovered account ID: X" - Shows if we found an account ID
   - "Registering webhook with Reply.io v3: ..." - The webhook URL
   - Success or detailed error message

---

### Technical Details

**New Account Discovery Logic:**
- Tries `/v1/accounts` endpoint first
- Falls back to `/v1/users/me` 
- Extracts `id`, `accountId`, or `teamId` from response
- Returns `null` if no account ID can be determined

**Enhanced Error Handling:**
- Logs full payload and response for debugging
- Implements retry logic without `subscriptionLevel`
- Provides clear error messages to the user

**Backward Compatibility:**
- Works with agency accounts that have team IDs
- Works with single accounts that have account IDs
- Falls back gracefully if neither is available

