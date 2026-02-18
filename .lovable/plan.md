
## Fix: Silent Error Handling in Subscription Check

### What's Happening

The "Failed to check subscription status" error toast is triggered by `useSubscription.ts` whenever the `check-subscription` backend function returns any error — including harmless auth errors like a stale cached token. This is not a real failure for the user, but it looks alarming.

The actual subscription data DID get set correctly (25,000 credits). The error was cosmetic noise from a stale session during testing.

### The Root Issue

In `src/hooks/useSubscription.ts`, line 36-43:
```typescript
if (error) {
  console.error('Error checking subscription:', error);
  toast({
    title: 'Error',
    description: 'Failed to check subscription status',
    variant: 'destructive',
  });
}
```

This fires on any error — including:
- Stale/invalid JWT (user was deleted and re-signed up)
- Brief network errors
- The function cold-starting

None of these warrant a red error toast visible to the user.

### The Fix

**Change 1 — Remove the error toast from the background subscription poll.**

The periodic check (`useEffect` interval) should silently fail. Only show an error if the user explicitly triggered an action (like clicking "Subscribe") and it failed.

The subscription check is a passive background poll. If it fails once, it will retry in 60 seconds. Showing a toast every time it fails is noisy and misleading — especially since the subscription status is also synced via the profile (which comes from `check-subscription` writing to the database directly).

**Change 2 — Also suppress the toast for authentication errors from `check-subscription`.**

When `check-subscription` returns a 500 with "Authentication error: User from sub claim in JWT does not exist", that means the JWT is stale. The correct response is to silently skip that check and wait for the auth state to refresh — not to show an error.

### Technical Changes

**File: `src/hooks/useSubscription.ts`**

- Remove the `toast` import and error toast from `checkSubscription`
- Keep the `console.error` for debugging
- Only show user-visible errors from `createCheckoutSession` and `openCustomerPortal` (which are user-initiated actions)

This is a small change — removing about 6 lines from the `checkSubscription` function.

### Email Verification

Regarding your original question: email verification is **moderately important** for a paid B2B product like Vrelly, for these reasons:

- It prevents fake/typo email signups from consuming subscription slots
- It gives you a verified contact for billing issues
- It's standard practice for paid SaaS products

However, enabling it right now would mean existing users can still sign in, but new signups would need to click a verification link before accessing the app. Given you're in early testing, this is fine to add soon but isn't causing any current issues. The current "failed to check subscription status" error is unrelated to email verification.

### Summary

| Change | File | Impact |
|---|---|---|
| Remove error toast from background subscription poll | `src/hooks/useSubscription.ts` | No more false-alarm error popups |

The subscription system is working correctly. The credits fix from earlier is confirmed working (25,000 credits granted). This is purely a UX polish fix to stop the background check from alarming users with error toasts they can't act on.
