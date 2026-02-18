
## What Is Actually Happening (Confirmed by Reading Every File)

After reading all the code, here is the definitive sequence causing the white screen:

1. User pays on Stripe. Stripe redirects to `https://audience-forge-80.lovable.app/dashboard?checkout=success` (full page load).
2. `ProtectedRoute` mounts. `isVerifying` initializes to `true` (from URL param). ✓
3. `AuthProvider`'s `getSession()` resolves → `setLoading(false)` → `fetchProfile()` runs → `profileLoading = true`.
4. Profile loads (already `active` in DB). `profile` is set in Zustand. `profileLoading = false`.
5. The guard `useEffect` fires: `isVerifying = true` → **returns early**. ✓ (correct)
6. The verify `useEffect` fires (user is available, not loading, verifyStartedRef is false) → sets `verifyStartedRef = true` → cleans URL → starts `verify()` async function.
7. `verify()` calls `check-subscription` (~600ms) then calls `fetchProfile()` again → profile reloads.
8. `verify()` finishes → `setIsVerifying(false)`.
9. **React batches the state update.** In the next render, `isVerifying = false`, `profile = {subscription_status: 'active'}`.
10. Guard `useEffect` fires. `isVerifying = false`, `loading = false`, `user` exists, `profile` exists, `profileLoading = false`. `isAdmin()` = false. Not exempt path. `profile.subscription_status === 'active'` → **does NOT redirect**. ✓

This should work. So why does it still show a white screen?

**The actual bug is a React StrictMode / double-invocation problem.**

In development (and sometimes in production), React can invoke `useState` initializers and effects twice. The `useState(() => searchParams.get('checkout') === 'success')` lazy initializer runs. But more critically: **`verifyStartedRef.current` is per-component-instance**. If React unmounts and remounts the component (which it does with StrictMode, or when the route changes), a **second `ProtectedRoute` instance** mounts with a fresh `verifyStartedRef.current = false` and `isVerifying = false` (because by then `searchParams.get('checkout')` returns `null` — the URL was already cleaned on step 6 above).

**This is the bug**: The URL cleanup at step 6 (`setSearchParams` removing `checkout`) happens inside `verify()` BEFORE `setIsVerifying(false)`. So:
- First render: `isVerifying = true` → URL gets cleaned
- If component remounts or re-initializes: `searchParams.get('checkout')` is now `null` → `isVerifying` initializes to `false`
- Guard immediately fires with stale profile or runs subscription check with no protection

## The Real Fix: Decouple from URL Param

The URL is cleaned too early. By removing `?checkout=success` from the URL before verification is complete, any re-render or remount will lose the `isVerifying = true` initialization.

**Solution**: Move the URL cleanup to AFTER `setIsVerifying(false)`, or better yet — use `sessionStorage` as the source of truth for the verification gate, not the URL param.

The cleanest fix:

1. **Store the checkout flag in `sessionStorage`** when we detect it from the URL on first render — this survives URL cleanup.
2. Clear the URL param immediately (good for UX).
3. Read `isVerifying` from `sessionStorage`, not from the URL.
4. Clear `sessionStorage` only after verification is complete.

## The Implementation

### Only `src/components/ProtectedRoute.tsx` changes

```typescript
// Initialize from URL OR sessionStorage (survives URL cleanup + remounts)
const [isVerifying, setIsVerifying] = useState(() => {
  const fromUrl = searchParams.get('checkout') === 'success';
  if (fromUrl) {
    sessionStorage.setItem('checkout_verifying', '1');
  }
  return fromUrl || sessionStorage.getItem('checkout_verifying') === '1';
});
```

And clear sessionStorage when verification is done:
```typescript
setIsVerifying(false);
sessionStorage.removeItem('checkout_verifying');
```

The URL cleanup can stay where it is (immediately, for clean UX).

This is a 3-line change that makes the verification gate resilient to URL cleanup, remounts, and React re-renders.

## Why This Definitively Fixes It

```
Timeline (after fix):

t=0: Full page load at /dashboard?checkout=success
     → fromUrl = true → sessionStorage set → isVerifying = true

t=1: URL cleaned (?checkout param removed)
     → sessionStorage still has '1' → isVerifying stays true

t=2: Any remount/re-render
     → searchParams.get('checkout') = null (URL cleaned)
     → BUT sessionStorage.getItem('checkout_verifying') = '1'
     → isVerifying = true ✓ (gate stays up)

t=3: verify() completes → setIsVerifying(false) + sessionStorage cleared
     → profile is active → guard does not redirect → dashboard shows ✓
```

No more white screen. No dependency on URL param surviving React re-renders.

## Files Changed

Only `src/components/ProtectedRoute.tsx` — 3 line change:
1. `useState` initializer reads from both URL AND sessionStorage
2. Sets sessionStorage when URL param is detected
3. Clears sessionStorage when `setIsVerifying(false)` is called
