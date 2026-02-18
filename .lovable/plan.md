
## Root Cause: The `onAuthStateChange` SIGNED_OUT Event After Stripe Redirect

The session replay confirms the flow:
1. Stripe completes payment and redirects the browser to `/checkout-success`
2. The browser navigates away from Stripe back to the app (cross-origin)
3. Supabase's `onAuthStateChange` fires `SIGNED_OUT` briefly (this is normal Supabase behavior during cross-origin redirects — the session cookie is re-validated)
4. `AuthProvider` line 24: `setUser(session?.user ?? null)` → sets `user = null`
5. `ProtectedRoute` guard fires: `!user` → `navigate('/auth')` → user gets logged out

The `SIGNED_IN` event fires immediately after, but by then the navigation to `/auth` has already occurred.

## Why It Happens

The `onAuthStateChange` listener is too aggressive — it immediately sets `user = null` on ANY `SIGNED_OUT` event, even transient ones during page loads. This is a known Supabase behavior: after a cross-origin navigation, the auth recovery sequence emits `SIGNED_OUT` → `INITIAL_SESSION` (or `SIGNED_IN`). The app should not react to `SIGNED_OUT` by nulling out the user immediately.

Additionally, looking at the Lovable Stack Overflow pattern: `setLoading(false)` is only called once inside `getSession().then()` — but never inside `onAuthStateChange`. This means if the page loads fresh (as happens after Stripe redirect), `loading` starts as `true`, then `getSession()` fires and sets it to `false`. But then `onAuthStateChange` fires `SIGNED_OUT` → `user = null` → `ProtectedRoute` redirects to `/auth` (since `loading = false` already).

## The Fix: Two Changes to `AuthProvider.tsx`

### Change 1: Add a guard against transient SIGNED_OUT events

Only clear the user on `SIGNED_OUT` if the initial session load has completed AND `getSession` confirms there is truly no session. A simple approach: use a short debounce or check `event` type more carefully.

The cleanest fix is to **not react to `SIGNED_OUT` in `onAuthStateChange`** by setting user to null immediately. Instead, only clear state on explicit sign-out (which comes from the `signOut()` action in the store, which already clears state directly).

```typescript
supabase.auth.onAuthStateChange((event, session) => {
  // Don't clear user on SIGNED_OUT — let getSession() handle initial state.
  // The store's signOut() action handles explicit logout.
  if (event === 'SIGNED_OUT') return; // ← ADD THIS
  
  setSession(session);
  setUser(session?.user ?? null);
  
  if (session?.user && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION')) {
    setTimeout(() => fetchProfile(session.user.id), 0);
  }
});
```

**Important note on `setTimeout`**: Per the Supabase documentation and the Lovable Stack Overflow pattern, calling Supabase client methods (like `fetchProfile` which does a DB query) directly inside `onAuthStateChange` can cause deadlocks. Wrapping with `setTimeout(..., 0)` defers to the next tick, safely outside the auth listener.

### Change 2: Also handle `INITIAL_SESSION` for profile fetching

Currently the listener only fetches profile on `SIGNED_IN` or `TOKEN_REFRESHED`. When Stripe redirects back, Supabase emits `INITIAL_SESSION` (not `SIGNED_IN`) to restore the existing session. Adding `INITIAL_SESSION` ensures the profile is fetched in this case too.

## Files Changed

Only **`src/components/AuthProvider.tsx`** — 3 line changes:

1. Add `if (event === 'SIGNED_OUT') return;` to prevent transient logouts
2. Add `'INITIAL_SESSION'` to the profile fetch condition
3. Wrap `fetchProfile` in `setTimeout(..., 0)` to prevent Supabase deadlocks

## Why This Definitively Fixes It

```text
Before (broken):
  Stripe redirect → onAuthStateChange('SIGNED_OUT') 
  → setUser(null) → ProtectedRoute → navigate('/auth') → LOGGED OUT

After (fixed):
  Stripe redirect → onAuthStateChange('SIGNED_OUT') → return early (ignored)
  → onAuthStateChange('INITIAL_SESSION', session) 
  → setUser(session.user) → fetchProfile() 
  → ProtectedRoute → profile.subscription_status = 'active' → Dashboard ✓
```

The `signOut()` action in `authStore.ts` already handles explicit logout by calling `supabase.auth.signOut()` and clearing all state directly — so ignoring the `SIGNED_OUT` event in the listener does not break the logout button.
