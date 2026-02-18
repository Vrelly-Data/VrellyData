
## What Went Wrong During Signup

The new user "Incrementums" was created successfully (their profile shows `credits: 25,000`, `subscription_status: active` — so the previous fixes worked). But the initial signup flow still broke at the checkout step before Stripe was even reached.

### Root Cause: Wrong Key in create-checkout

In `supabase/functions/create-checkout/index.ts`, line 22:

```typescript
// CURRENT (broken):
const supabaseClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_ANON_KEY") ?? ""  // ← WRONG KEY
);
```

The `SUPABASE_ANON_KEY` is the public key used by browsers. When an edge function uses it to call `supabaseClient.auth.getUser(token)`, it validates the JWT through the public auth API — which can fail or behave unexpectedly for brand-new sessions immediately after signup. The session logs confirm: `[CREATE-CHECKOUT] ERROR - {"message":"User not authenticated or email not available"}` at the exact moment the new Incrementums user tried to subscribe.

Compare this with `check-subscription` which correctly uses `SUPABASE_SERVICE_ROLE_KEY` — that's why check-subscription works fine while create-checkout fails.

### Why the Rest of the Flow Eventually Worked

Despite the checkout failure, the Incrementums test account shows `subscription_status: active` and `credits: 25,000` — because from the session replay, it appears a previous test payment from the same email address already existed in Stripe, and `check-subscription` picked it up on the next background poll.

### What Needs to Change

**File: `supabase/functions/create-checkout/index.ts`**

One-line fix — change `SUPABASE_ANON_KEY` to `SUPABASE_SERVICE_ROLE_KEY`:

```typescript
// FIXED:
const supabaseClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false } }
);
```

This makes the function consistent with `check-subscription` and ensures JWT validation works reliably for all users including brand-new signups.

### What This Fixes

| Symptom | Cause | After Fix |
|---|---|---|
| "User not authenticated or email not available" | Anon key can't reliably validate fresh JWTs | Service role key validates all JWTs reliably |
| Checkout silently fails after signup | Same as above | Checkout opens Stripe correctly |
| User redirected nowhere after clicking Subscribe | Checkout URL never returned | Stripe checkout page opens |

### What This Does NOT Change

- The Stripe webhook fix (already done — uses `constructEventAsync`)
- The credits fix (already done — `credits` field is set correctly)
- The silent error handling (already done — no false-alarm toasts)

### Summary

One file, one line changed. The `create-checkout` function needs to use the service role key for auth validation, not the anon key. This is the same pattern used by all other edge functions in this project.
