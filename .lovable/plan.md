
## Root Cause: Stripe Opens in a New Tab

The fundamental problem is one line in `src/hooks/useSubscription.ts`:

```typescript
window.open(data.url, '_blank');  // Opens Stripe in a NEW tab
```

When Stripe completes payment, it redirects **that new tab** to `/dashboard?checkout=success`. But the new tab:
1. Has a fresh browser context — auth session must re-hydrate from scratch
2. During hydration, `loading = true` and `user = null`
3. The navigation guard fires: `!loading && !user` → `navigate('/auth')`
4. This redirect happens BEFORE `checkoutPolling` can ever start, because polling only starts when `user` exists

So the user sees: Stripe tab closes/redirects → brief flash → login screen. The original `/choose-plan` tab is unaffected and still open, confused.

---

### The Fix: Three coordinated changes

**1. Open Stripe in the same tab** (`src/hooks/useSubscription.ts`)

Change `window.open(data.url, '_blank')` to `window.location.href = data.url`. This means Stripe's success redirect lands back in the same tab that already has a valid, hydrated auth session — no re-hydration race condition.

**2. Fix the navigation guard timing** (`src/components/ProtectedRoute.tsx`)

The current guard fires `navigate('/auth')` the moment `!loading && !user`. But on a fresh page load (same tab returning from Stripe), there's a brief moment where `loading` flips to `false` before the session is confirmed. We need to add a short "grace period" — if `checkout=success` is in the URL, we should never redirect to `/auth` immediately. We can check for the param before redirecting.

Also add a new `paymentSuccess` state that shows a proper success screen ("Payment confirmed! Welcome to Vrelly 🎉") for 2 seconds after `subscription_status` becomes `active`, then navigates to dashboard.

**3. Show a proper success message** (`src/components/ProtectedRoute.tsx`)

Instead of just clearing the `checkout` param and dumping the user on `/dashboard`, show a brief success screen:
- Green checkmark icon
- "Payment confirmed!" heading
- "Welcome to Vrelly — your credits are ready." subtext
- Auto-navigates to `/dashboard` after 2 seconds

---

### Files to Change

**`src/hooks/useSubscription.ts`** — 1 line change
```typescript
// BEFORE:
window.open(data.url, '_blank');

// AFTER:
window.location.href = data.url;
```

**`src/components/ProtectedRoute.tsx`** — Multiple changes:
1. Add `paymentSuccess` state (`useState(false)`)
2. When polling resolves with `active`, set `paymentSuccess = true` and show success screen for 2s, then navigate
3. Guard the "redirect to /auth" logic: if `checkout=success` is in the URL, don't redirect to `/auth` — wait for auth to settle
4. Update the loading/polling UI to show a branded "Verifying your payment..." screen
5. Add a success screen with `CheckCircle` icon from lucide-react

---

### What the User Experience Becomes

```text
1. User clicks "Subscribe" on /choose-plan
2. Page navigates (same tab) to Stripe checkout
3. User pays with test card
4. Stripe redirects same tab to /dashboard?checkout=success
5. ProtectedRoute detects checkout=success param
6. Shows: [spinner] "Verifying your payment..."
7. Polls check-subscription every 3s (up to 8 attempts = 24s)
8. Stripe confirms active subscription → DB updated
9. Shows: [green checkmark] "Payment confirmed! Welcome to Vrelly."
10. After 2 seconds → navigates to /dashboard (clean URL)
11. User sees the dashboard with full credits
```

---

### Why This Is the Complete Fix

| Problem | Cause | Fix |
|---|---|---|
| Redirected to /auth after payment | Stripe in new tab = fresh auth context, race condition with loading guard | Same-tab navigation keeps auth hydrated |
| No "verifying payment" shown | Race condition meant redirect to /auth fired before polling started | Same-tab navigation means user is already authenticated when they return |
| No success message | Polling immediately cleared and navigated | Add `paymentSuccess` state with 2s success screen |

No backend changes needed. Two frontend files only.
