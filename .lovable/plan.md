

## Fix Reply.io V3 Webhook 404 Error

### Problem Identified

The Reply.io V3 API is returning a 404 with an empty response body. Based on the documentation analysis, two potential issues:

1. **Header Case Mismatch**: Documentation shows `X-API-Key` (all caps "API"), but code uses `X-Api-Key`
2. **Missing Accept Header**: V3 APIs often require explicit `Accept: application/json` header

### Root Cause Analysis

From logs at `22:14:09Z`:
```
Payload: {"subscriptionLevel":"team","teamIds":[383893],...}
Reply.io V3 response: 404 (empty body)
```

The payload format is now correct, but the API is rejecting the request with a 404. An empty 404 typically indicates an authentication/authorization issue rather than a malformed request.

---

### Solution

Update `supabase/functions/setup-reply-webhook/index.ts` to:

1. Match the exact header casing from Reply.io documentation
2. Add `Accept: application/json` header
3. Add verbose logging to capture the full response for debugging

---

### Technical Changes

**File:** `supabase/functions/setup-reply-webhook/index.ts`

**Lines 131-138** - Update fetch headers:

```typescript
// Before
const response = await fetch(WEBHOOK_API_BASE, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Api-Key': apiKey,
  },
  body: JSON.stringify(payload),
});

// After
const response = await fetch(WEBHOOK_API_BASE, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-API-Key': apiKey,  // Match exact casing from Reply.io docs
  },
  body: JSON.stringify(payload),
});
```

**Also update delete requests (lines 85-95)** with matching header casing:

```typescript
headers: { 'X-API-Key': apiKey }  // Consistent casing
```

---

### Changes Summary

| Location | Change |
|----------|--------|
| Line 87 | `X-Api-Key` to `X-API-Key` |
| Line 94 | `X-Api-Key` to `X-API-Key` |
| Line 133-135 | Add `Accept: application/json` and fix `X-API-Key` casing |

---

### Expected Outcome

| Before | After |
|--------|-------|
| `X-Api-Key` header | `X-API-Key` header (matches docs) |
| No Accept header | `Accept: application/json` |
| 404 empty response | 201 with webhook ID |

---

### Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/setup-reply-webhook/index.ts` | Fix header casing, add Accept header |

