
## Root Cause: `paymentSuccess` Never Clears, Blocking Dashboard Children

### Why the White/Blank Screen Persists

When `navigate('/dashboard', { replace: true })` fires, the component is already at `/dashboard?checkout=success`. React Router strips the query param but does NOT unmount/remount `ProtectedRoute` — it just re-renders it in place. This means:

- `paymentSuccess` stays `true` (we removed the `setPaymentSuccess(false)` call to fix the previous white flash)
- The success screen render branch continues to return the checkmark UI
- `{children}` (the dashboard) **never renders**
- The user sees the success screen indefinitely — or if something clears state, a blank screen

This is the fundamental conflict: we need `paymentSuccess` to stay `true` long enough to prevent the white gap, but we also need it to become `false` AFTER the children are ready to render.

### The Correct Fix: Set `paymentSuccess = false` AFTER Navigation Settles

The solution is to restore `setPaymentSuccess(false)` inside the timeout — but call it AFTER `navigate()`, with a tiny additional delay so the route re-render has time to complete before we clear the success state:

```typescript
setPaymentSuccess(true);
setTimeout(() => {
  navigate('/dashboard', { replace: true });
  // Give React Router one tick to process the navigation before clearing
  // the success screen — prevents white gap while ensuring children render
  setTimeout(() => setPaymentSuccess(false), 100);
}, 2000);
```

The inner 100ms `setTimeout` gives React Router enough time to commit the URL change and begin rendering the children. By the time `paymentSuccess` flips to `false`, the dashboard children are already mounting — no white gap, and no infinite success screen lock.

### Why This Works

```
Timeline:
t=0ms    → polling confirms active → setPaymentSuccess(true) → success screen shown
t=2000ms → navigate('/dashboard', { replace: true }) fires
           React Router starts re-rendering, children begin mounting
t=2100ms → setPaymentSuccess(false) → ProtectedRoute renders {children}
           Children are already mid-mount, no visible flash
```

The 100ms inner delay is enough for React to process the navigation commit. The success screen remains visible for the full 2 seconds + 100ms, then smoothly gives way to the dashboard.

### Alternative: Use a `paymentSuccessDone` ref

An even more robust approach is to track completion with a ref that persists across renders, and render children when that ref is set AND navigation is done:

Instead of fighting the timing, restructure the render logic to show children even when `paymentSuccess` is true, but overlay the success screen on top using absolute positioning. When the 2 seconds expire, fade out the overlay — the dashboard is already rendered underneath.

However, the nested timeout approach is simpler and sufficient for this case.

### File to Change

Only `src/components/ProtectedRoute.tsx` — restore the nested `setPaymentSuccess(false)` call 100ms after navigation.

### Before / After

**Before (success screen never clears):**
```typescript
setPaymentSuccess(true);
setTimeout(() => {
  navigate('/dashboard', { replace: true });
  // paymentSuccess stays true forever — children never render
}, 2000);
```

**After (success screen clears 100ms post-navigation):**
```typescript
setPaymentSuccess(true);
setTimeout(() => {
  navigate('/dashboard', { replace: true });
  setTimeout(() => setPaymentSuccess(false), 100);
}, 2000);
```

This is the minimal, correct fix. One added line.

### Note on Preview vs Published

This bug occurs in both preview and published environments — it is not environment-specific. The navigation behavior (same-component re-render vs full unmount) is consistent in both. The fix resolves it in both.
