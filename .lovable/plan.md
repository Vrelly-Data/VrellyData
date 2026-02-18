
## Root Cause: Finally Found

After reading all the code carefully, the real cause is a gap in the redirect guard logic at line 105-110 of `ProtectedRoute.tsx`.

Here is the exact sequence:

1. User returns from Stripe to `/dashboard?checkout=success`
2. `AuthProvider`'s `onAuthStateChange` fires a `SIGNED_IN`/`TOKEN_REFRESHED` event, calling `fetchProfile()` — this sets `profileLoading: true` and fetches the profile, which at this point may have a stale `subscription_status` (not yet `'active'`)
3. Polling starts, runs `check-subscription`, updates the DB, calls `fetchProfile()` again — now `profile.subscription_status = 'active'`
4. `pollingDoneRef.current = true`, `setPaymentSuccess(true)` — overlay appears
5. After 2 seconds, `setPaymentSuccess(false)` — re-render triggers
6. The guard `useEffect` (line 92) fires. It sees `paymentSuccess = false`, `isCheckoutSuccess = false` (param was deleted), `pollingDoneRef.current = true` — **but has no logic to skip the subscription check just because polling succeeded**
7. If `profileLoading` happens to be `true` at this moment (from another auth event's `fetchProfile` call), the component renders the spinner. When loading completes, the guard fires again — and if `profile.subscription_status` is stale in this new fetch cycle, it redirects to `/choose-plan` → white screen, or the redirect itself causes the blank

**The fix: use `pollingDoneRef` to skip the subscription gate after a successful checkout**

When `pollingDoneRef.current` is `true` and polling confirmed an active subscription, we should never redirect to `/choose-plan`. Add a `paymentVerifiedRef` that specifically tracks whether polling confirmed `active`, and skip the subscription redirect when it's set.

## The Fix: One Additional Ref + One Guard Line

### Change 1: Add `paymentVerifiedRef` to track confirmed active subscription

```typescript
const paymentVerifiedRef = useRef(false);
```

### Change 2: Set it when polling confirms active

Inside the polling interval, when `subscription_status === 'active'`:
```typescript
if (currentProfile?.subscription_status === 'active') {
  paymentVerifiedRef.current = true;  // ← add this
  setPaymentSuccess(true);
  setTimeout(() => {
    setPaymentSuccess(false);
  }, 2000);
}
```

### Change 3: Skip the subscription redirect guard if payment was verified

In the guard `useEffect`, before redirecting to `/choose-plan`, check if payment was just verified:
```typescript
if (!loading && user && !profileLoading && profile) {
  if (isAdmin()) return;
  if (paymentVerifiedRef.current) return;  // ← add this — skip gate after confirmed payment
  const isExempt = SUBSCRIPTION_EXEMPT_PATHS.some(p => location.pathname.startsWith(p));
  if (!isExempt && profile.subscription_status !== 'active') {
    navigate('/choose-plan');
  }
}
```

This is a targeted, minimal fix. If polling confirmed the payment, the gate never fires — no matter what state `profile` is in during subsequent re-renders while auth events are settling.

## Why This Works

```
Timeline (after fix):
t=0ms    → polling confirms active → paymentVerifiedRef.current = true
           → setPaymentSuccess(true) → overlay appears
           → children already mounted underneath
t=2000ms → setPaymentSuccess(false) → guard useEffect fires
           → sees paymentVerifiedRef.current = true → returns early
           → NO redirect to /choose-plan
           → overlay disappears → dashboard visible
```

The `paymentVerifiedRef` persists across re-renders (it's a ref, not state) and is never reset. Once the payment is confirmed, the gate is permanently bypassed for this component instance — which is correct, because the user just paid.

## File Changed

Only `src/components/ProtectedRoute.tsx` — three small additions.
