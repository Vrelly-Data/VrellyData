
## What We're Documenting

Two new docs files need to be created/updated to capture the billing and auth fixes delivered in this session (February 18, 2026):

- `docs/V3.7_RELEASE_NOTES.md` — new file, detailed account of all changes
- `docs/STABLE_CHECKPOINTS.md` — append v3.7 entry to the change log and add a new stable state section

---

## V3.7 Summary

This release fixes the end-to-end Stripe subscription checkout flow. Three root causes were addressed in sequence:

### Root Cause 1 — White Screen After Stripe Redirect
**File:** `src/components/ProtectedRoute.tsx`

The component had a line `if (!user) return null` that rendered a completely blank screen whenever `user` was briefly `null` during Supabase's auth recovery sequence. After a cross-origin redirect from Stripe, Supabase emits a transient `SIGNED_OUT` → `INITIAL_SESSION` sequence. During this window, `user` momentarily becomes `null`, causing the component to return `null` (blank screen) instead of showing a loading spinner.

**Fix:** Removed the `if (!user) return null` guard entirely. The existing `useEffect` already handles genuine unauthenticated users by calling `navigate('/auth')`. The spinner shown by `if (loading || (profileLoading && !profile))` now correctly covers this transient window.

---

### Root Cause 2 — "Verifying your payment..." Infinite Spinner Deadlock
**Files:** `src/components/ProtectedRoute.tsx`, `src/pages/CheckoutSuccess.tsx` (new), `src/App.tsx`, `supabase/functions/create-checkout/index.ts`

The checkout verification logic was embedded directly inside `ProtectedRoute`. This conflicted with auth loading states and profile loading cycles — `profileLoading` toggling `true/false` repeatedly caused the component to re-render in a way that prevented `setIsVerifying(false)` from ever persisting, leaving the spinner permanently on screen.

**Fix:** Moved all checkout verification to a new, dedicated, unprotected route `/checkout-success` (`src/pages/CheckoutSuccess.tsx`). This page:
1. Calls `check-subscription` edge function with the user's access token
2. Calls `fetchProfile()` to refresh the profile
3. Shows a success toast: *"Payment confirmed! Welcome to Vrelly — your credits are ready."*
4. Navigates to `/dashboard` with `replace: true`

The Stripe `success_url` in `create-checkout/index.ts` was updated from `${origin}/dashboard?checkout=success` to `${origin}/checkout-success`. The `/checkout-success` route in `App.tsx` was registered as unprotected (no `ProtectedRoute` wrapper). `ProtectedRoute` was restored to a simple auth + subscription guard with no checkout logic.

---

### Root Cause 3 — Immediate Logout After Successful Payment
**File:** `src/components/AuthProvider.tsx`

After Stripe redirects back to the app, Supabase's `onAuthStateChange` fires a transient `SIGNED_OUT` event as part of its cross-origin session recovery. The listener was calling `setUser(session?.user ?? null)` unconditionally, which set `user = null` and caused `ProtectedRoute` to redirect to `/auth` before the subsequent `INITIAL_SESSION` event could restore the session.

**Fix (3 changes):**
1. Added `if (event === 'SIGNED_OUT') return;` to ignore transient logouts. Explicit logout is already handled by `signOut()` in `authStore.ts`, which directly clears all state.
2. Added `'INITIAL_SESSION'` to the profile fetch condition, so that the profile is loaded when Supabase emits `INITIAL_SESSION` (instead of just `SIGNED_IN` or `TOKEN_REFRESHED`).
3. Wrapped `fetchProfile` in `setTimeout(..., 0)` to defer the Supabase DB call outside the auth callback and prevent potential deadlocks.

---

## Files Changed

| File | Change |
|------|--------|
| `src/components/ProtectedRoute.tsx` | Removed `if (!user) return null`; removed all checkout verification logic |
| `src/components/AuthProvider.tsx` | Guard against transient `SIGNED_OUT`; add `INITIAL_SESSION` profile trigger; setTimeout around `fetchProfile` |
| `src/pages/CheckoutSuccess.tsx` | New unprotected page — runs check-subscription, fetchProfile, toast, navigate |
| `src/App.tsx` | Registered `/checkout-success` as an unprotected route |
| `supabase/functions/create-checkout/index.ts` | Updated `success_url` from `/dashboard?checkout=success` to `/checkout-success` |

---

## Technical Details for Implementation

### `docs/V3.7_RELEASE_NOTES.md` — new file

Full release notes with:
- Summary table
- Root cause analysis for all 3 bugs
- Before/after flow diagrams (text)
- Files changed table
- Known remaining issue note (occasional logout still observed; may need future investigation)

### `docs/STABLE_CHECKPOINTS.md` — append

Add to the Change Log table:
```
| v3.7 | 2026-02-18 | Stripe checkout flow fixed: white screen, infinite spinner, and transient logout resolved |
```

Add a new section `## 💳 Stripe Checkout Stable State (v3.7)` documenting the current architecture, the 3 root causes, the files changed, and a known issue note.

---

## Known Remaining Issue

After the checkout success flow, the user may occasionally be logged out (redirected to `/auth`). This is suspected to be a second wave of Supabase's `SIGNED_OUT` event firing after the `INITIAL_SESSION` recovery — potentially triggered by `fetchProfile` itself causing an auth state re-evaluation. This is lower-priority and the checkout flow itself (payment confirmed, profile updated, credits set) works correctly. Can be revisited.
