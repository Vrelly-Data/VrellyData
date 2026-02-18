
## Root Cause: Polling Reads Stale Database, Never Queries Stripe

The timing breakdown from the logs explains everything:

```text
03:42:48  create-checkout completes, Stripe checkout page opens
~03:42:55  User completes payment, redirected to /dashboard?checkout=success
~03:42:55  ProtectedRoute polling starts: checks fetchProfile() every 2s, max 5 times (10 seconds)
~03:42:55  DB still has subscription_status = 'inactive' (webhook never fired for subscription.created)
~03:43:05  Polling gives up after 5 attempts. Sends user back to /choose-plan ← FAILURE POINT
03:43:35   check-subscription finally runs (60-second background poll) and updates DB to 'active'
```

The polling in `ProtectedRoute` only calls `fetchProfile()` — a database read. But the database doesn't know the subscription is active yet. The only function that queries Stripe and writes to the database is `check-subscription`, and it runs on a 60-second background timer from `useSubscription`. By the time it runs, the 10-second polling window has already closed.

---

### The Fix: Call `check-subscription` During Polling

The polling loop in `ProtectedRoute.tsx` needs to invoke `check-subscription` on each attempt, so it actively asks Stripe "is this subscription active?" and writes that answer to the database — not just read whatever stale value is already in the database.

**File: `src/components/ProtectedRoute.tsx`**

Changes:
1. Import `supabase` client
2. In the polling interval, call `supabase.functions.invoke('check-subscription')` before `fetchProfile()`
3. Increase polling window from 5 attempts × 2s to 8 attempts × 3s (24 seconds total) to give Stripe more time to settle

```typescript
// In the polling interval:
const interval = setInterval(async () => {
  pollCountRef.current += 1;
  
  // Actively query Stripe and update DB — don't just read stale DB state
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      await supabase.functions.invoke('check-subscription', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
    }
  } catch (e) {
    // Silent — we'll check the profile next regardless
  }
  
  await fetchProfile(); // Now the profile should have the updated status
  
  const currentProfile = useAuthStore.getState().profile;
  if (currentProfile?.subscription_status === 'active' || pollCountRef.current >= 8) {
    // resolve...
  }
}, 3000);
```

---

### Why the Stripe Webhook Is Not the Solution Here

The webhook is correctly configured and IS receiving events — but the events it received were `invoice.created`, `invoice.paid`, `payment_intent.created`, etc. None of these write `subscription_status = 'active'` to the database. Only `customer.subscription.created` does that, and it either wasn't sent to the webhook endpoint or was missed. This is why the `check-subscription` function (the Stripe-polling fallback) is the correct mechanism for the post-checkout flow — it just needs to be called actively during the polling window, not waited on for 60 seconds.

---

### Summary of Changes

| File | Change | Impact |
|---|---|---|
| `src/components/ProtectedRoute.tsx` | Call `check-subscription` on each poll iteration | DB gets updated during polling window |
| `src/components/ProtectedRoute.tsx` | Increase polling to 8 attempts × 3s = 24s | More time for Stripe to settle |

This is a one-file change, approximately 10 lines added to the polling interval. No backend changes needed.
