
## Three Issues, One Root Cause

Everything traces back to a single bug in the Stripe webhook function.

---

### Issue 1: Wrong credits (25 instead of 25,000) — CRITICAL

The webhook function uses `stripe.webhooks.constructEvent()` (synchronous), but the Deno runtime used by edge functions requires the async version. Every webhook event Stripe has ever sent has crashed with:

```
SubtleCryptoProvider cannot be used in a synchronous context.
Use `await constructEventAsync(...)` instead of `constructEvent(...)`
```

This means the webhook has **never successfully run a single time**. The database confirms this — the "Incrementums" test user shows `credits: 25` (the hardcoded default from profile creation) but `monthly_credit_limit: 25000` and `subscription_status: active`. The `monthly_credit_limit` was set by `check-subscription` (which reads directly from Stripe and bypasses the webhook), but the actual spendable `credits` field was never populated by the webhook.

**Fix:** Change `stripe.webhooks.constructEvent(body, signature, webhookSecret)` to `await stripe.webhooks.constructEventAsync(body, signature, webhookSecret)`.

---

### Issue 2: Redirected to sign-in page after payment

After Stripe checkout, users are sent to `/dashboard?checkout=success`. The `ProtectedRoute` then polls the profile to wait for `subscription_status === 'active'`. The polling works (because `check-subscription` correctly reads from Stripe directly and updates the database), but then after the polling succeeds, the user needs to be authenticated — they ARE authenticated. 

However, there's a UX gap: after Stripe redirect, if the user's browser session was lost or the Stripe redirect opened in a new tab and the original tab was on a different state, the user might land on `/dashboard` not logged in. Additionally, the `check-subscription` function correctly sets `subscription_status` to `active` BUT the `credits` field is never being set to the plan's credit value — it stays at 25.

The credit grant logic needs to run. The fix for the webhook will also fix this, but we should also ensure `check-subscription` sets the `credits` field when it finds an active subscription (not just `monthly_credit_limit`).

---

### Issue 3: Email verification — Low priority for now

Email verification is currently disabled (auto-confirm is on, per the project memory). For a paid B2B product like Vrelly, this is worth enabling eventually, but it's not causing the current payment flow issues. The more pressing fix is the webhook. Once the site is more stable, re-enabling email verification can be done as a separate step.

---

### Technical Implementation

**File to change:** `supabase/functions/stripe-webhook/index.ts`

**Change 1 — Fix async signature verification (line 50):**
```typescript
// BEFORE (broken):
const event = stripe.webhooks.constructEvent(body, signature, webhookSecret);

// AFTER (fixed):
const event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
```

**Change 2 — Also set `credits` when webhook processes subscription.created:**

When `customer.subscription.created` fires, in addition to updating `monthly_credit_limit`, also set `credits` to the plan's credit value so users have spendable credits from the start.

```typescript
// In the 'customer.subscription.created' branch, add credits to updates:
if (event.type === 'customer.subscription.created') {
  updates.credits_used_this_month = 0;
  updates.credits = credits;  // Grant the actual credits
}
```

**File to change:** `supabase/functions/check-subscription/index.ts`

**Change 3 — Also set `credits` when check-subscription detects a new subscription:**

The `check-subscription` function updates the profile with subscription info but also never sets `credits`. Add it to the update so the polling fallback after checkout also grants credits:

```typescript
// In the shouldResetCredits block, also grant the credits:
if (shouldResetCredits) {
  updateData.credits_used_this_month = 0;
  updateData.credits = credits;  // Grant credits
}
```

**After the fix:** Manually update the existing "Incrementums" test user's credits from 25 to 25,000 to reflect what they paid for.

---

### Summary of Changes

| File | Change | Impact |
|---|---|---|
| `stripe-webhook/index.ts` | `constructEventAsync` instead of `constructEvent` | Webhooks start working |
| `stripe-webhook/index.ts` | Set `credits` on subscription.created | New signups get correct credits |
| `check-subscription/index.ts` | Set `credits` on new billing period | Checkout polling grants credits as fallback |
| Database (manual) | Set Incrementums credits to 25,000 | Fix existing test user |

### Email Verification

Not causing payment issues. Can be re-enabled separately when you're ready — it would require users to click a verification link before logging in, which adds friction but is good practice for a paid product.
