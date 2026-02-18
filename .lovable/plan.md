
## Root Cause: Definitively Identified

The entire problem is a single line: `navigate('/dashboard', { replace: true })` on line 77.

Here is exactly what happens:

1. User returns from Stripe to `/dashboard?checkout=success`
2. The `/dashboard` `ProtectedRoute` instance starts polling
3. Polling confirms `subscription_status: active`
4. `setCheckoutPolling(false)` — spinner stops
5. `searchParams.delete('checkout')` — URL becomes `/dashboard` (no remount yet)
6. `setPaymentSuccess(true)` — overlay appears
7. After 2 seconds: `setPaymentSuccess(false)` then `navigate('/dashboard', { replace: true })`

**Step 7 is the problem.** `navigate('/dashboard', { replace: true })` — even though the URL is already `/dashboard` — causes React Router to re-process the route. This forces `ProtectedRoute` to re-render. The guard `useEffect` (line 93) fires with `paymentSuccess = false`, `pollingDoneRef.current = true`, `isCheckoutSuccess = false`, and `authReady = true`. All guards clear. It checks the profile — and for one render cycle, the profile's `subscription_status` may not yet be confirmed in the new render context, so the component hits `return null` (line 127) or flickers to a loading state. White screen.

The user sees: spinner → success screen for 2 seconds → white screen.

## The Fix: Remove `navigate('/dashboard', { replace: true })`

The user is **already on `/dashboard`**. The URL has already been cleaned (line 70-71 deletes the `?checkout=success` param). There is nothing to navigate to. The overlay just needs to disappear, revealing the dashboard children that are already rendered underneath it (the overlay pattern is correct — `{children}` renders alongside the overlay).

**Change lines 75-78 from:**
```typescript
setTimeout(() => {
  setPaymentSuccess(false);
  navigate('/dashboard', { replace: true });
}, 2000);
```

**To:**
```typescript
setTimeout(() => {
  setPaymentSuccess(false);
}, 2000);
```

That is the entire fix. Delete the `navigate` call. One line removed.

## Why This Works

```
Timeline (after fix):
t=0ms    → polling done → setPaymentSuccess(true)
           → {children} renders immediately (dashboard already mounted)
           → overlay covers it
t=2000ms → setPaymentSuccess(false) → overlay disappears
           → dashboard was already mounted underneath → instantly visible
           No remount. No white screen. Ever.
```

The `{children}` (dashboard) is already rendered beneath the `paymentSuccess` overlay because the current return structure is:
```tsx
return (
  <>
    {children}           ← dashboard renders here immediately
    {paymentSuccess && <overlay />}  ← just covers it
  </>
);
```

When `paymentSuccess` becomes `false`, the overlay is removed and the dashboard is immediately visible — because it never stopped rendering.

## File Changed

**`src/components/ProtectedRoute.tsx`** — remove `navigate('/dashboard', { replace: true })` from the setTimeout. One line deleted.
