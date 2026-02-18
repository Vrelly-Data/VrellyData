
## Root Cause — Definitively

The entire problem is one line in the guard `useEffect` (line 96):

```typescript
if (checkoutPolling || paymentSuccess) return;
```

This guard is supposed to prevent the subscription redirect during checkout. But look at the sequence on a full page reload (which is what happens on the published site when Stripe redirects back):

1. Page loads fresh — `loading = true`, `checkoutPolling = false`, `paymentSuccess = false`
2. `loading` goes `false` — user is found in session
3. `profileLoading = true` → profile fetch starts
4. Profile loads with **stale** `subscription_status` (DB not yet updated by Stripe)
5. Guard `useEffect` fires: `checkoutPolling = false` (polling hasn't started yet!), `paymentSuccess = false` → **falls through to the redirect check**
6. `profile.subscription_status !== 'active'` → **navigates to `/choose-plan`** — blank/wrong screen

The polling hasn't started yet because it's gated on the profile loading. By the time polling would start, the guard has already fired and redirected the user away.

**The fix is dead simple**: When `checkout=success` is in the URL, **never redirect to `/choose-plan`** in the guard. Full stop. The polling mechanism is authoritative — if it fails after 8 attempts, it does its own redirect to `/choose-plan`. The guard should stay out of the way entirely while `isCheckoutSuccess` is true.

## The Fix: One Line Change in the Guard

**Current code (line 95-115):**
```typescript
useEffect(() => {
  if (checkoutPolling || paymentSuccess) return;
  if (isCheckoutSuccess && !pollingDoneRef.current) return;  // ← this guard
  if (!authReady) return;
  ...
```

The problem: `isCheckoutSuccess && !pollingDoneRef.current` is already there as a guard — but it only applies to the `navigate('/auth')` check. The subscription redirect check at line 108 only checks `paymentVerifiedRef.current`, not `isCheckoutSuccess`.

**Change the guard `useEffect` to also skip the subscription redirect when `isCheckoutSuccess` is true:**

```typescript
if (!loading && user && !profileLoading && profile) {
  if (isAdmin()) return;
  if (paymentVerifiedRef.current) return;
  if (isCheckoutSuccess) return;  // ← ADD THIS: never redirect during checkout flow
  const isExempt = SUBSCRIPTION_EXEMPT_PATHS.some(p => location.pathname.startsWith(p));
  if (!isExempt && profile.subscription_status !== 'active') {
    navigate('/choose-plan');
  }
}
```

Also, the top-level early return needs to cover the checkout URL case too:

```typescript
// Top of the guard useEffect — also block if checkout=success is in URL
if (checkoutPolling || paymentSuccess) return;
if (isCheckoutSuccess && !pollingDoneRef.current) return;  // already exists
```

The existing `if (isCheckoutSuccess && !pollingDoneRef.current) return;` already returns before the `!user` check, but it returns **before any of the checks** — wait, actually reading the code again, line 99 returns BEFORE the auth check. But there are TWO early returns and then the subscription check at line 108 which does NOT have an `isCheckoutSuccess` guard.

## Summary of Changes to `src/components/ProtectedRoute.tsx`

**Single change:** Add `if (isCheckoutSuccess) return;` inside the subscription gate block:

```typescript
if (!loading && user && !profileLoading && profile) {
  if (isAdmin()) return;
  if (paymentVerifiedRef.current) return;
  if (isCheckoutSuccess) return;  // ← NEW: never kick to /choose-plan during checkout
  const isExempt = SUBSCRIPTION_EXEMPT_PATHS.some(p => location.pathname.startsWith(p));
  if (!isExempt && profile.subscription_status !== 'active') {
    navigate('/choose-plan');
  }
}
```

## Why This Works

```
Timeline (after fix):

Full page reload at /dashboard?checkout=success:
  → loading=true → spinner
  → user found, loading=false
  → profileLoading=true → spinner (profile loading)
  → profile loads (stale, subscription_status='inactive')
  → guard fires → isCheckoutSuccess=true → RETURNS EARLY, no redirect
  → polling trigger fires → checkoutPolling=true → spinner + "Verifying payment..."
  → poll #1: check-subscription updates DB → subscription_status='active'
  → polling done → paymentVerifiedRef.current=true → paymentSuccess=true
  → overlay shows for 2s → clears → dashboard visible

No redirect to /choose-plan. Ever.
```

The polling mechanism already handles the failure case (after 8 attempts, it redirects to `/choose-plan` itself). The guard doesn't need to interfere at all when `checkout=success` is in the URL.

## Only File Changed

`src/components/ProtectedRoute.tsx` — one line added inside the subscription redirect block.
