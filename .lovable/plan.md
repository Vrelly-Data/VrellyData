

# Fix Contact Sync API Response Parsing

## Problem Identified

### Root Cause 1: API Response Format Mismatch
The `sync-reply-contacts` edge function expects the Reply.io V1 `/campaigns/{id}/people` endpoint to return a plain array:
```typescript
const response = await fetchWithRetry(endpoint, apiKey, replyTeamId || undefined);
contacts = (response as V1Contact[]) || [];  // WRONG - expects array
```

But the logs show:
```
Fetched undefined contacts, raw total: NaN
TypeError: Cannot read properties of undefined (reading 'email')
```

This means `response` is an **object** (e.g., `{ people: [...] }` or `{ contacts: [...] }`), not an array. When cast directly as `V1Contact[]`, it becomes `undefined` for array operations.

### Root Cause 2: No Defensive Parsing
The code doesn't handle the nested response format. Looking at the working `fetch-available-campaigns` code:
```typescript
const campaigns = (response.campaigns || response || []) as ReplyioCampaign[];
```
It properly handles both `{ campaigns: [...] }` and `[...]` formats.

### Impact
- Contact sync fails for ALL 6 campaigns (0 of 6 successful)
- No contacts saved to `synced_contacts` table (verified: count = 0)
- Engagement stats (emails sent, replied) are never derived
- Dashboard shows 0/0 for message metrics

---

## Solution

### 1. Fix the API response parsing in `sync-reply-contacts`

Update the response handling to match the actual V1 API format:

```typescript
// Before (broken)
const response = await fetchWithRetry(endpoint, apiKey, replyTeamId || undefined);
contacts = (response as V1Contact[]) || [];

// After (fixed)
const response = await fetchWithRetry(endpoint, apiKey, replyTeamId || undefined) as Record<string, unknown>;

// Handle both { people: [...] } and [...] formats
let rawContacts: unknown;
if (Array.isArray(response)) {
  rawContacts = response;
} else if (response && typeof response === 'object') {
  rawContacts = response.people || response.contacts || response.items || response;
}
contacts = (Array.isArray(rawContacts) ? rawContacts : []) as V1Contact[];
```

### 2. Add defensive null checks in getPageSignature

The function crashes when `contacts[0]` is undefined:
```typescript
function getPageSignature(contacts: V1Contact[]): string {
  if (contacts.length === 0) return 'empty';
  if (!contacts[0]?.email) return 'invalid_first';  // Add this check
  const first = contacts[0].email;
  const last = contacts[contacts.length - 1]?.email || first;
  return `${first}|${last}|${contacts.length}`;
}
```

### 3. Add logging to debug the actual response format

```typescript
console.log(`API response type: ${typeof response}, isArray: ${Array.isArray(response)}`);
if (!Array.isArray(response) && response !== null && typeof response === 'object') {
  console.log(`Response keys: ${Object.keys(response as object).join(', ')}`);
}
```

---

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/sync-reply-contacts/index.ts` | Fix response parsing, add null checks, add debug logging |

---

## Expected Result After Fix

1. Contact sync will successfully parse the API response
2. Contacts will be saved to `synced_contacts` table
3. Engagement flags (opened, replied, delivered) will be extracted
4. Dashboard will show:
   - **Emails Sent**: Derived from contacts with engagement activity
   - **Replies**: Derived from contacts with `replied: true`
5. Sync will report "X of 6 campaigns synced successfully"

---

## Why This Is Low Risk

- Only touches one file (`sync-reply-contacts/index.ts`)
- Adds defensive checks, doesn't change core logic
- Uses the same pattern that works in `fetch-available-campaigns`
- No database schema changes needed
- No frontend changes needed

---

## Verification Steps

1. Deploy the updated edge function
2. Click "Sync" on the Reply.io integration
3. Check edge function logs - should see successful contact counts instead of `undefined`
4. Verify `synced_contacts` table has records
5. Confirm dashboard shows email metrics

