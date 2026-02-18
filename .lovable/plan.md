
## The Actual Root Cause (No More Guessing)

Reading the current file carefully, the problem is on **line 117**:

```typescript
if (loading || profileLoading || checkoutPolling) {
  return <Loader spinner />
}
```

`profileLoading` is a **global Zustand store value**. It gets set to `true` every time `fetchProfile()` is called — including from `AuthProvider`'s `onAuthStateChange` handler, which fires independently on token refreshes completely outside of the polling flow.

Here is the exact sequence causing the blank screen:

1. Polling completes → `setCheckoutPolling(false)` → `paymentVerifiedRef.current = true` → `setPaymentSuccess(true)` → overlay appears, children render underneath
2. 2 seconds later → `setPaymentSuccess(false)` → overlay disappears → dashboard should be visible ✓
3. BUT: Supabase fires a `TOKEN_REFRESHED` event at any point → `AuthProvider` calls `fetchProfile()` → `profileLoading = true` in the global store
4. Component re-renders → hits line 117 → `profileLoading` is `true` → renders the spinner **instead of children**
5. `profileLoading` goes back to `false` → guard `useEffect` re-runs → sees `paymentVerifiedRef.current = true` → returns early → renders children

This is the "blink to white" — it's not a blank forever, it's the spinner flash or a brief `null` render between states.

The reason it appears as a full blank screen is that the `profileLoading` spinner replaces `{children}` entirely while auth token refresh happens.

## The Fix: Stop Blocking Renders on `profileLoading` After Auth Is Established

The `profileLoading` guard on line 117 is correct for initial page load (before the user is known), but it must **not** block rendering when the user and profile are already loaded and valid. A background token refresh should never cause a full component unmount.

### Change 1: Split the loading gate

Instead of:
```typescript
if (loading || profileLoading || checkoutPolling) {
  return <spinner />
}
```

Change to:
```typescript
// Only show spinner on initial auth load or active checkout polling
// Never block on profileLoading alone when user + profile are already known
if (loading || checkoutPolling) {
  return <spinner />
}

// profileLoading mid-session (token refresh, background re-fetch) should not 
// unmount children. Only block on initial profileLoading when profile is null.
if (profileLoading && !profile) {
  return <spinner />
}
```

This means:
- First page load with no profile yet → spinner (correct)
- Background token refresh with profile already loaded → children stay rendered (correct)
- Checkout polling → spinner with "Verifying payment..." (correct)

### Change 2: Remove `profileLoading` from the polling trigger

Line 34: `if (!user || loading || profileLoading) return;`

This causes polling to be blocked or restarted when `profileLoading` toggles. Change to:

```typescript
if (!user || loading) return;
if (profileLoading && !profile) return; // Only block if profile truly not loaded yet
```

### Why This Definitively Fixes It

```
Timeline (after fix):
t=0ms    → user returns to /dashboard?checkout=success  
           → user known, profile known → children render immediately
           → polling starts (not blocked by profileLoading)
t=Xms    → TOKEN_REFRESHED fires → profileLoading = true
           → profile already exists → condition `profileLoading && !profile` = false
           → children STAY rendered, no spinner flash
t=Ys     → polling confirms active → overlay shows
t=Y+2s   → overlay hides → children already rendered underneath → dashboard visible
```

No more blank screen. No more spinner flash. Background token refreshes are completely invisible to the user.

## File to Change

Only `src/components/ProtectedRoute.tsx` — two small changes to the loading gate logic.
