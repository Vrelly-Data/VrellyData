
## The Definitive Fix: Break Out of the Iframe Correctly

### Why Everything Keeps Breaking

The core problem is a false dichotomy we've been stuck in:

- **Same tab** (`window.location.href`): Blocked by Lovable's iframe — page freezes
- **New tab** (`window.open(url, '_blank')`): Opens a fresh browser context in incognito/new tab — no auth session in localStorage — Stripe returns to `/dashboard?checkout=success` but `getSession()` returns null — guard redirects to `/auth`

Neither approach works reliably. The fix we keep missing is a **third option**.

### The Real Fix: `window.open(url, '_top')`

`window.open(data.url, '_top')` targets the **top-level browsing context** — the actual browser tab that contains the Lovable iframe. This is NOT blocked by the iframe (unlike `window.location.href` on the iframe itself), and it does NOT open a new tab (unlike `_blank`). It navigates the **same browser session** to Stripe checkout. When Stripe redirects back to `/dashboard?checkout=success`, the auth session is fully intact in localStorage.

This means:
- No iframe block
- No fresh auth context race
- No new tab auth isolation issue
- Works in both preview AND published site

### Changes

**`src/hooks/useSubscription.ts`** — Change one line:
```typescript
// BEFORE (broken in iframe, fresh context in new tab):
const inIframe = window.self !== window.top;
if (inIframe) {
  window.open(data.url, '_blank');
} else {
  window.location.href = data.url;
}

// AFTER (breaks out of iframe, keeps same session):
window.open(data.url, '_top');
```

`_top` always navigates the top-level window — whether running in an iframe or not. In the preview iframe it escapes the iframe and loads Stripe in the real browser tab. On the published site it behaves identically to `window.location.href`. One line, both environments solved.

**`src/components/ProtectedRoute.tsx`** — Two targeted fixes:

**Fix 1:** Remove the "already active" shortcut that short-circuits polling. When `checkout=success` is in the URL, we should ALWAYS run at least one poll against Stripe — not trust a potentially stale DB value. This prevents the "got to dashboard without paying" bug from stale state.

**Fix 2:** Add a small `setTimeout` guard (500ms) before the navigation-to-auth redirect fires on the first render. This gives the auth session just enough time to hydrate before the guard can send the user to `/auth`. This is a belt-and-suspenders fix for the edge case where `loading` flips to `false` fractionally before `getSession` has propagated the user.

### Full Flow After Fix

```
1. User signs up → lands on /choose-plan
2. Clicks "Subscribe" on a plan
3. create-checkout edge function returns Stripe URL
4. window.open(url, '_top') navigates the REAL browser tab to Stripe
5. User completes payment
6. Stripe redirects same tab to /dashboard?checkout=success
7. Auth session is intact (same localStorage) — user is immediately available
8. ProtectedRoute detects checkout=success, starts polling immediately
9. Shows: [spinner] "Verifying your payment..."
10. check-subscription hits Stripe → active → updates DB
11. fetchProfile() reads DB → subscription_status = 'active'
12. Shows: [green checkmark] "Payment confirmed! Welcome to Vrelly."
13. After 2 seconds → /dashboard (clean URL)
```

### Files to Change

| File | Change |
|---|---|
| `src/hooks/useSubscription.ts` | Replace iframe detection + window.open/_blank/location.href with single `window.open(url, '_top')` |
| `src/components/ProtectedRoute.tsx` | Remove "already active" early shortcut; always poll on checkout=success |

No backend changes. No new dependencies. Two surgical edits.
