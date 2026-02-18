
## The Actual Root Cause (Finally Found)

After reading every file carefully, the problem is **not in `ProtectedRoute.tsx`** — the current code there is logically correct. The issue is in **`AuthProvider.tsx`**.

Here is what happens on the published site after Stripe redirects back:

```
AuthProvider.tsx line 6-10:
supabase.auth.getSession().then(({ data: { session } }) => {
  setSession(session);
  setUser(session?.user ?? null);
  if (session?.user) {
    fetchProfile(session.user.id);  // ← async, NOT awaited
  }
  setLoading(false);  // ← fires IMMEDIATELY while profile is still loading
});
```

`setLoading(false)` fires before `fetchProfile` completes. This means there is a window where:
- `loading = false`
- `user = <exists>`
- `profile = null`
- `profileLoading = false` (it starts as false in the store, only becomes true when fetchProfile starts)

In that tiny window, the guard `useEffect` in `ProtectedRoute` fires:
- `isVerifying = true` → returns early ✓ (correct, no redirect)

But then there's a second timing issue. The guard `useEffect` dependency array includes `profileLoading`. When `fetchProfile` eventually sets `profileLoading = true` then `false` again, the effect re-fires. At the moment it re-fires after profile loads:

- `isVerifying` might now be `false` if `setIsVerifying(false)` was called **before** the profile re-rendered (race between verify() completing and profile loading)
- Profile could show stale data `subscription_status: 'inactive'` from a cached Supabase realtime client

**But the session replay and logs prove something even more specific**: The user `dennis.t0333@gmail.com` had their profile showing `subscription_status: 'active'` according to the DB update logs — check-subscription ran at timestamp `1771449234` and the profile was already active. The issue is the page **goes blank and stays blank** — this is not a redirect to `/choose-plan`. A redirect to `/choose-plan` would be visible. A white/blank page means the component returns `null` or crashes.

Looking at line 96: `if (!user) return null;`

This fires if `user` becomes null. When does `user` become null? When `onAuthStateChange` fires with a `SIGNED_OUT` event. **This is the real culprit**: navigating the same tab through Stripe's checkout (`window.open(url, '_top')`) navigates away from the app entirely. When Stripe redirects BACK, Supabase's `onAuthStateChange` listener fires with `INITIAL_SESSION` but sometimes emits a brief `SIGNED_OUT` → `SIGNED_IN` sequence during cross-origin navigation recovery. This causes `user` to be temporarily `null`, which triggers `return null` on line 96, resulting in a completely blank white page.

## The Fix: Two Small Changes

### Fix 1: Change `success_url` to go to a dedicated `/checkout-success` route

Instead of going to `/dashboard?checkout=success` (a protected route that runs the auth guard), redirect to a simple unprotected page that does the verification then navigates to dashboard.

### Fix 2 (simpler alternative — one file change): Don't return null while auth is still recovering

The `if (!user) return null` line fires when user is briefly null during auth recovery. Change it to show a spinner instead, with a brief delay before actually redirecting to `/auth`.

**This is the fix** — change `ProtectedRoute.tsx` line 96:

```typescript
// BEFORE (causes blank white page when user is briefly null):
if (!user) return null;

// AFTER (shows spinner, lets auth recover):
// (Remove this line entirely — the guard useEffect handles the /auth redirect)
```

And change the spinner condition at line 85 to also show during brief user=null moments when we know we might be recovering from checkout:

```typescript
// Line 85 — also hold spinner if user is null but we were verifying
if (loading || (profileLoading && !profile) || (!user && sessionStorage.getItem('checkout_verifying') === '1')) {
  return <spinner />;
}
```

Actually the cleanest fix is to remove the `if (!user) return null` entirely and let the `useEffect` guard handle the redirect to `/auth`. The `useEffect` already does `navigate('/auth')` when `!user`. Returning `null` here is redundant and causes the blank screen.

## Exact Changes to `src/components/ProtectedRoute.tsx`

Remove line 96 (`if (!user) return null;`) entirely.

The guard `useEffect` already handles unauthenticated users by calling `navigate('/auth')`. The `return null` on line 96 causes a blank white flash before the navigation completes and is entirely responsible for the white screen when auth briefly recovers during post-checkout page load.

The render logic becomes:
1. `loading` or `(profileLoading && !profile)` → spinner
2. `isVerifying` → "Verifying your payment..." spinner  
3. Otherwise → render children (guard useEffect handles redirect if needed)

No more `return null`. No more blank screen.

## Why This Fixes It

```
Timeline after fix:

Stripe redirects to /dashboard?checkout=success (full page load)
→ loading = true → spinner shown
→ Auth recovers (may briefly show user=null during SIGNED_OUT→SIGNED_IN)  
→ Previously: return null → BLANK WHITE SCREEN
→ After fix: loading=true still shows spinner, no null return
→ user loads → loading=false → isVerifying=true → "Verifying payment..." spinner
→ verify() runs → check-subscription → fetchProfile → profile is active
→ setIsVerifying(false) → children render → dashboard shows ✓
```

## Only File Changed

`src/components/ProtectedRoute.tsx` — remove 1 line (`if (!user) return null`).
