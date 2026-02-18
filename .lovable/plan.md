
## Fix: Ensure Cancellation Takes Effect at Billing Period End

### What's Currently Happening

When Richard Dawson cancelled via the Stripe Customer Portal, Stripe set `cancel_at_period_end: true` on his subscription. This means:
- His subscription stays **active in Stripe until March 17, 2026**
- On March 17, Stripe fires `customer.subscription.deleted`
- The stripe-webhook should then set his profile to `canceled`/`free`

This is actually correct behavior -- a user who cancels should retain access until the period they paid for ends.

### The Problem: Stripe Webhook Isn't Being Called

The stripe-webhook logs show only a single "shutdown" entry -- no actual event processing. This means the webhook URL is either not registered in Stripe's dashboard, or it's pointed at the wrong URL.

This matters because when March 17 arrives, the `customer.subscription.deleted` event won't reach the app, and Richard Dawson will keep his `active` status in the database indefinitely.

The `check-subscription` function (called every minute per session) IS a reliable fallback -- it queries Stripe directly and will catch the cancellation -- but only when the user is actively logged in.

### Changes Required

**1. Fix the stripe-webhook to handle `cancel_at_period_end` (stripe-webhook edge function)**

Currently when a subscription is updated to `cancel_at_period_end: true`, the webhook fires `customer.subscription.updated` with `cancel_at_period_end: true`. The existing handler processes this and sets `subscription_status: active` (correct). We need to also save a `cancel_at_period_end` flag and `cancel_at` date to the profile so the UI can show a warning.

We'll add a `cancel_at_period_end` boolean and `cancel_at` timestamp to the profile update logic in the webhook handler.

**2. Update `check-subscription` to detect `cancel_at_period_end`**

The function currently only looks at `status: "active"` subscriptions and returns `subscribed: true`. We need it to also return `cancel_at_period_end` and `cancel_at` so the UI can inform the user their cancellation is pending.

**3. Show cancellation warning in `ChoosePlan` / Settings UI**

When `cancel_at_period_end` is true, show a banner like: "Your subscription will end on March 17, 2026. You'll lose access after that date."

**4. Add a database column `cancel_at_period_end` to profiles**

A boolean column (default `false`) so the cancellation state persists between sessions, independent of the real-time Stripe check.

### Technical Details

**Database migration:**
```sql
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS cancel_at timestamp with time zone;
```

**stripe-webhook update** -- in the `customer.subscription.updated` handler, add:
```typescript
updates.cancel_at_period_end = subscription.cancel_at_period_end;
updates.cancel_at = subscription.cancel_at 
  ? new Date(subscription.cancel_at * 1000).toISOString() 
  : null;
```

**check-subscription update** -- return `cancel_at_period_end` and `cancel_at` in the response, and save them to the profile:
```typescript
// In the hasActiveSub block:
updateData.cancel_at_period_end = subscription.cancel_at_period_end;
updateData.cancel_at = subscription.cancel_at 
  ? new Date(subscription.cancel_at * 1000).toISOString() 
  : null;
```

**`customer.subscription.deleted` webhook handler** -- already sets `subscription_status: 'canceled'` and `subscription_tier: 'free'`. We'll also clear `cancel_at_period_end` and `cancel_at` here.

**`ChoosePlan.tsx`** -- add a banner that reads from the profile's `cancel_at_period_end` and `cancel_at` fields when the user is on an `active` subscription with a pending cancellation.

### What This Achieves

- Users who cancel retain access until their billing period ends (correct)
- A clear warning banner tells them when they'll lose access
- The database correctly reflects the pending cancellation state
- When the period ends, both the webhook AND the `check-subscription` polling will catch it and revoke access
