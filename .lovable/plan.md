

## Fix the New User Signup Flow

### Problems to Fix

1. **Misleading email verification toast** -- Auto-confirm is enabled, so no email is ever sent. The "Check your email!" message confuses users.
2. **Session lost after Stripe checkout** -- Users navigate away to Stripe, and when they return via the success URL, they're no longer logged in.
3. **Race condition on subscription check** -- After signing back in, the profile may still show `inactive` if the webhook hasn't fired yet, causing a redirect to `/choose-plan` even though the user just paid.

### Changes

**1. Update Auth page (`src/pages/Auth.tsx`)**
- Remove the "Check your email!" toast after signup
- Instead, since auto-confirm is on, the user is immediately signed in after signup -- detect this and redirect them to `/choose-plan` directly (or let `ProtectedRoute` handle it naturally)

**2. Update `create-checkout` success URL (`supabase/functions/create-checkout/index.ts`)**
- Change `success_url` from `/settings?success=true` to `/dashboard?checkout=success`
- This way, when the user returns and signs in, they land on the dashboard (and `ProtectedRoute` will handle subscription gating if the webhook hasn't fired yet)

**3. Add profile refresh with retry on `/choose-plan` (`src/pages/ChoosePlan.tsx`)**
- When the page detects a `checkout=success` query param (or when returning from Stripe), poll/refresh the profile a few times to catch the webhook update
- If `subscription_status` becomes `active` during polling, redirect to `/dashboard`

**4. Add a "completing payment" state to `ProtectedRoute` (`src/components/ProtectedRoute.tsx`)**
- When the URL contains `checkout=success`, show a loading spinner and re-fetch the profile every 2 seconds (up to 5 attempts) before redirecting to `/choose-plan`
- This gives the Stripe webhook time to update the profile before the subscription gate kicks in

**5. Update `ChoosePlan` to handle post-checkout state (`src/pages/ChoosePlan.tsx`)**
- If the user lands on `/choose-plan` with an already-active subscription (webhook caught up), immediately redirect them to `/dashboard`
- Show a "Verifying your payment..." state if coming from checkout

### Technical Details

- The `create-checkout` edge function will be updated to set `success_url` to `${origin}/dashboard?checkout=success`
- `ProtectedRoute` will check for `checkout=success` search param. If present, it will call `fetchProfile()` in a polling loop (every 2s, max 5 tries) before deciding to redirect to `/choose-plan`
- `Auth.tsx` signup handler: since auto-confirm is on, `supabase.auth.signUp` returns a session immediately. The existing `useEffect` watching `user` will navigate to `/dashboard`, and `ProtectedRoute` will then send them to `/choose-plan`
- The misleading "Check your email!" toast will be replaced with a simpler success message or removed entirely since the redirect happens automatically
- No database changes needed -- this is purely frontend flow fixes plus one edge function URL change
