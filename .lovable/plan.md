
## Root Cause: `window.open(url, '_top')` is Silently Blocked in the Preview

### What the Evidence Shows

The edge function logs are clear: `create-checkout` successfully creates a Stripe session and returns a URL every time. The session replay confirms the spinner appears and disappears. The button just resets. No error is thrown.

This is a silent browser security block. When code inside an iframe calls `window.open(url, '_top')`, the browser treats it as a cross-origin frame trying to navigate the top-level page — and **blocks it without throwing any error**. The function returns `null`. On the published site (no iframe), `_top` works correctly.

### The Fix: One Line Change in `useSubscription.ts`

Detect whether the app is running inside an iframe. If yes, open in a new tab (`_blank`). If no (published site), navigate the top-level context (`_top`).

```typescript
const inIframe = window.self !== window.top;
if (inIframe) {
  window.open(data.url, '_blank'); // Preview: new tab, no block
} else {
  window.open(data.url, '_top');   // Published: same tab, auth preserved
}
```

This is actually what was implemented two iterations ago — but was replaced with the single `_top` call thinking it would work in the iframe context. It does not.

### Why the New Tab (Preview) Path Now Works

The previous concern with `_blank` was: "new tab = fresh auth context = race condition = redirect to /auth". That concern is now addressed by the current `ProtectedRoute`:

1. The 500ms `authReady` guard delays any redirect before the auth session can hydrate from localStorage
2. `if (isCheckoutSuccess && !pollingDoneRef.current) return;` prevents premature `/auth` redirects while checkout is being verified
3. Polling always runs on `checkout=success` — no early shortcut trusting stale DB state

So for the **preview testing flow**:
1. Subscribe clicked → new tab opens to Stripe (not blocked)
2. User completes payment → Stripe redirects new tab to `/dashboard?checkout=success`
3. Auth hydrates from localStorage (same domain, session is available)
4. 500ms guard + `isCheckoutSuccess` guard hold back any premature redirect
5. Polling starts, `check-subscription` confirms active → success screen → dashboard

For the **published site flow**:
1. Subscribe clicked → `_top` navigates same tab to Stripe (no iframe to block)
2. Payment → returns to same tab with session intact
3. Polling confirms → success screen → dashboard

### What Changes

Only **one file, one code block** in `src/hooks/useSubscription.ts`:

Replace:
```typescript
window.open(data.url, '_top');
```

With:
```typescript
const inIframe = window.self !== window.top;
if (inIframe) {
  window.open(data.url, '_blank');
} else {
  window.open(data.url, '_top');
}
```

No changes to `ProtectedRoute.tsx` — the current logic already handles both paths correctly.

### Why This Is the Complete and Final Fix

| Environment | Previous Behavior | After Fix |
|---|---|---|
| Lovable preview (iframe) | `_top` silently blocked, button resets | `_blank` opens new tab, works |
| Published site (no iframe) | `_top` works correctly | `_top` still works correctly |
| Auth after new tab payment | Would race to /auth | 500ms guard + isCheckoutSuccess guard holds |
| Auth after same-tab payment | Session intact, polling runs | Session intact, polling runs |
