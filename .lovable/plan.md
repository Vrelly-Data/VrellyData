
## The Real Fix: Skip Polling When Profile Is Already Active

After reviewing all the code and network logs carefully, the issue is now clear:

**What the network logs prove:**
The profile response shows `subscription_status: "active"` immediately on page load. The Stripe webhook already updated the database BEFORE the user returned to the app. So when the user lands on `/dashboard?checkout=success`, the profile is already correct.

**The actual deadlock being caused:**
1. Page loads, profile is already `active`
2. `isCheckoutSuccess = true` → polling trigger fires unconditionally → `setCheckoutPolling(true)`
3. `checkoutPolling = true` → line 119 renders the full-screen spinner, blocking the dashboard
4. After 3 seconds, poll completes, `paymentSuccess = true` → overlay shows for 2s
5. `paymentSuccess = false` → overlay hides → dashboard should show, but something re-triggers or the component is now in a bad state

The polling mechanism is the problem. It runs no matter what, even when the profile is already `active`. The 3-second spinner is unnecessary and the source of the stuck white screen.

**The fix: In the checkout polling trigger, if profile already shows `active`, skip polling entirely and go straight to the success overlay.**

```typescript
// Handle checkout=success polling
useEffect(() => {
  if (!user || loading) return;
  if (profileLoading && !profile) return;
  if (!isCheckoutSuccess) return;
  if (pollingDoneRef.current) return;

  // If profile is already active (webhook already fired), skip polling
  if (profile?.subscription_status === 'active') {
    pollingDoneRef.current = true;
    paymentVerifiedRef.current = true;
    searchParams.delete('checkout');
    setSearchParams(searchParams, { replace: true });
    setPaymentSuccess(true);
    setTimeout(() => setPaymentSuccess(false), 2000);
    return;
  }

  // Profile not yet active — start polling
  if (!checkoutPolling) {
    setCheckoutPolling(true);
    pollCountRef.current = 0;
  }
}, [user, loading, profileLoading, isCheckoutSuccess, profile]);
```

This means:
- If DB is already updated (most common case when webhook fires fast) → instant success overlay, no 3-second wait, no spinner blocking the dashboard
- If DB is NOT yet updated → polling starts as before

**Also: Remove `checkoutPolling` from the render spinner logic** — the spinner should only show during initial `loading`, not during the checkout verification. The children (dashboard) should render underneath while verification happens, and the success overlay appears on top. This prevents the "stuck white screen" entirely.

```typescript
// Change line 119 from:
if (loading || checkoutPolling) {

// To:
if (loading) {
```

The success overlay (`paymentSuccess`) already covers the full screen with `fixed inset-0 z-50`, so children rendering underneath is invisible to the user. No need to block children with a spinner during checkout polling.

## Files to Change

Only `src/components/ProtectedRoute.tsx`:

1. Add early-exit for already-active profile in the polling trigger `useEffect`
2. Remove `checkoutPolling` from the render gate (line 119) so dashboard renders underneath while the overlay is shown
