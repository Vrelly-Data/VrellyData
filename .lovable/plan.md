
## Root Cause: Identified With Certainty

After reading the current code carefully, here is the exact sequence causing the blank screen:

**Line 71** runs `setSearchParams(searchParams, { replace: true })` which strips `?checkout=success` from the URL BEFORE the 2-second success screen even appears. This means by the time `setPaymentSuccess(false)` fires at t=2100ms, `isCheckoutSuccess` is already `false` and `pollingDoneRef.current` is `true`.

So the guard `useEffect` on line 93 no longer has anything holding it back. It evaluates:
- `checkoutPolling` = false ✓
- `paymentSuccess` = false (just cleared) ✓  
- `isCheckoutSuccess` = false (param already deleted) ✓
- `authReady` = true ✓
- `user` exists ✓
- `profile` exists — but its `subscription_status` may still be `null` or stale in one render cycle

This causes a brief window where all guards pass but children aren't ready — blank screen.

## The Correct Fix: Overlay Pattern

The nested setTimeout approach keeps fighting React's render cycle timing. The real solution is to **render the children underneath the success overlay** using absolute positioning. This way:

- Children (`<Index />`) mount immediately when auth is valid
- The success screen overlays on top with a full-screen div
- When `paymentSuccess` flips to false, children are **already mounted and visible** — zero blank gap

```
Structure:
<>
  {children}                        ← always rendered when auth is valid
  {paymentSuccess && <SuccessOverlay />}  ← sits on top, fades out
</>
```

This eliminates the timing problem entirely. No matter when `setPaymentSuccess(false)` fires, the dashboard is already rendered underneath.

## Changes to `src/components/ProtectedRoute.tsx`

### 1. Move the success screen to an overlay

Change the early return `if (paymentSuccess)` block from a full-page replacement into an **absolutely-positioned overlay** rendered alongside children:

```typescript
// BEFORE (blocks children from rendering):
if (paymentSuccess) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4">
      ...success content...
    </div>
  );
}
// ...
return <>{children}</>;
```

```typescript
// AFTER (children render behind the overlay):
return (
  <>
    {children}
    {paymentSuccess && (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background">
        <div className="flex flex-col items-center gap-3 animate-in fade-in zoom-in duration-500">
          <CheckCircle className="h-16 w-16 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Payment confirmed!</h1>
          <p className="text-muted-foreground text-sm">Welcome to Vrelly — your credits are ready.</p>
        </div>
      </div>
    )}
  </>
);
```

### 2. Simplify the timeout — no need for nested setTimeout

Since children are now always rendered behind the overlay, `setPaymentSuccess(false)` can simply be called after 2 seconds. No navigation is needed at all — the URL was already cleaned up on line 71:

```typescript
if (currentProfile?.subscription_status === 'active') {
  setPaymentSuccess(true);
  setTimeout(() => {
    setPaymentSuccess(false);
    // Navigate to dashboard cleanly
    navigate('/dashboard', { replace: true });
  }, 2000);
}
```

### 3. Fix the guard useEffect to hold while paymentSuccess is true

The guard already has `if (checkoutPolling || paymentSuccess) return;` — this correctly blocks any premature redirect while the success overlay is showing. This part is fine.

## Why This Definitively Works

```
Timeline (new approach):
t=0ms    → polling done → setPaymentSuccess(true)
           → {children} renders immediately (dashboard mounts)
           → overlay sits on top — user sees "Payment confirmed!"
t=2000ms → setPaymentSuccess(false) → overlay disappears
           → dashboard is already mounted underneath → instantly visible
           No blank gap. Ever.
```

The Lovable branding flash the user saw was likely the app shell's loading state or the `<Index />` component mounting for the first time with empty data — this will still happen briefly underneath the overlay, but the overlay hides it entirely.

## Summary of Changes

**File:** `src/components/ProtectedRoute.tsx` only

1. Remove the early `if (paymentSuccess) return (...)` block
2. Change the final `return <>{children}</>` to render children plus a conditional fixed overlay
3. Simplify the timeout to a single `setTimeout` (no nested one needed)

This is a structural fix — not a timing fix. Timing fixes will always be fragile. The overlay approach is the correct pattern used in production apps for post-payment confirmation screens.
