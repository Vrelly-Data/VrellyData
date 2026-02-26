

# Fix: Build Audience Edge Function Crash

## Problem
Line 90 in `supabase/functions/build-audience/index.ts` calls `supabase.rpc(...).catch(() => {})`. The Supabase JS client's `.rpc()` returns a `PromiseLike` (thenable) that does NOT have a `.catch()` method, causing `TypeError: supabase.rpc(...).catch is not a function` and crashing the entire function.

## Fix

**File:** `supabase/functions/build-audience/index.ts`

Remove lines 89-92 entirely. They were a failed attempt to set `statement_timeout` via a dummy RPC call -- this approach doesn't work anyway since each RPC call runs in its own transaction context. The timeout protection is already handled by the `Promise.race` wrappers around the actual RPC calls (lines ~105 and ~125).

Specifically, delete:
```typescript
// Set statement_timeout to prevent indefinite hangs
await supabase.rpc("deduct_credits", { p_user_id: "00000000-0000-0000-0000-000000000000", p_amount: 0 }).catch(() => {});
// Use a raw SQL approach via postgrest isn't possible, so we rely on the RPC's own timeout.
// Instead, we reduce the limit and add a fallback.
```

Then redeploy the `build-audience` edge function.

## Scope
- Only `supabase/functions/build-audience/index.ts` is modified (4 lines removed)
- No other files touched
- Main Audience Builder page is completely unaffected
