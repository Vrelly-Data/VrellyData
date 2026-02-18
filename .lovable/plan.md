
## Root Cause: Two Separate Bugs

### Bug 1: Stripe redirect blocked in Lovable preview iframe
The `create-checkout` function is working perfectly — it returns a valid Stripe URL. The `window.location.href = data.url` call fires, but the **Lovable editor preview is an iframe** and iframes cannot navigate to external domains (cross-origin restriction). So the page appears frozen with a spinner.

This will work fine in a **real browser** (published URL), but for testing in the preview you need a workaround.

### Bug 2: User reaches dashboard without paying after refresh
When the user refreshes, the URL still has `?checkout=success` if they navigated away mid-flow, OR the 8-attempt polling timeout expires and the code currently does:
```typescript
} else {
  navigate('/choose-plan');  // ← This should work, but...
}
```
However, the `ProtectedRoute` wrapping `/dashboard` sees `checkout=success` in the URL, skips the `/auth` redirect guard (`if (isCheckoutSuccess) return;`), and renders the dashboard children regardless — because the guard exits early when `checkout=success` is present, even after polling gives up.

---

### The Fix: Three changes

**1. Open Stripe in a new tab for the preview environment (and as a fallback)**

Instead of `window.location.href`, use `window.open(url, '_blank')` — this opens Stripe in a new tab which is never blocked by iframe restrictions. The success redirect will land in that new tab at `/dashboard?checkout=success`, which will then run the polling flow.

Wait — this was the original approach we moved away from because of the auth hydration race. The real fix is: use `window.open` but open the **current window**, not a new tab, when we're NOT in an iframe context. We detect if we're in an iframe and handle accordingly:

```typescript
// Detect if running in an iframe (Lovable preview)
const inIframe = window.self !== window.top;
if (inIframe) {
  window.open(data.url, '_blank'); // New tab — works in iframe context
} else {
  window.location.href = data.url; // Same tab — preserves auth in real browser
}
```

This means:
- In the **Lovable preview**: opens Stripe in a new tab (avoids iframe restriction)
- In the **real browser** (published): same-tab navigation (preserves auth session, avoids hydration race)

**2. Fix the polling timeout — don't leave user on dashboard without payment**

When polling gives up (8 attempts, no active subscription), the `checkout=success` param needs to be cleared AND the guard needs to properly kick the user to `/choose-plan`. Currently the early-exit guard (`if (isCheckoutSuccess) return;`) prevents the subscription check from running even after polling is done.

Fix: After polling gives up, navigate to `/choose-plan` and also add a `toast` explaining what happened.

**3. Add a timeout guard in ProtectedRoute**

The `isCheckoutSuccess` early exit currently says "never redirect away from this page if checkout=success is in URL". This is too broad — after polling concludes, this flag should no longer block normal routing. Fix by tracking whether polling has **concluded** (success or failed) in a `pollingDoneRef`, and only using the early exit while polling is actively in progress.

---

### Files to Change

**`src/hooks/useSubscription.ts`**
- Detect iframe context and use `window.open` vs `window.location.href` accordingly

**`src/components/ProtectedRoute.tsx`**
- Add a `pollingDoneRef` to track when polling has concluded
- Only skip the auth/subscription guard while polling is actively running (not after it finishes)
- After polling timeout, clear `checkout` param, navigate to `/choose-plan`, and show a toast

---

### What the Experience Becomes

**In Lovable preview (iframe):**
1. Click Subscribe → Spinner briefly → Stripe opens in **new tab**
2. Complete payment in new tab → redirected to `/dashboard?checkout=success` in new tab
3. New tab shows "Verifying your payment..." while polling
4. Subscription confirmed → "Payment confirmed!" → Dashboard

**In real browser (published site):**
1. Click Subscribe → Same tab navigates to Stripe (auth preserved)
2. Complete payment → Returns to `/dashboard?checkout=success` in same tab
3. Same "Verifying your payment..." polling flow
4. "Payment confirmed!" → Dashboard

**If payment not completed / times out:**
- Polling gives up → toast "We couldn't verify your payment. Please try again." → redirected to `/choose-plan`
- No accidental dashboard access
