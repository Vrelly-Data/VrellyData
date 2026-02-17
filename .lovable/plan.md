

## Paid-Only Signup with Monthly Credit Refill

### Overview

Remove the free tier entirely. New users must pick a plan and pay during signup. Existing users without an active subscription get redirected to a paywall. Monthly credits automatically refill when each billing period renews.

### Flow

1. User clicks "Get Started" on the landing page
2. Lands on `/auth?tab=signup` -- signs up with name, email, password
3. After signup and email verification, user signs in
4. `ProtectedRoute` detects no active subscription and redirects to a new `/choose-plan` page
5. User picks Starter/Professional/Enterprise, gets redirected to Stripe Checkout
6. After payment, Stripe webhook fires, sets `subscription_tier`, `monthly_credit_limit`, `credits_used_this_month = 0`, and `billing_period_start/end`
7. User is redirected back to `/settings?success=true`, which refreshes their profile, and they now pass the subscription gate
8. Every month, when Stripe renews the subscription, the webhook fires again with an updated `current_period_start`, which resets `credits_used_this_month` to 0

### Changes

**1. Create `/choose-plan` page (`src/pages/ChoosePlan.tsx`)**
- Shows the 3 subscription tiers (Starter, Professional, Enterprise)
- Each plan card has a "Subscribe" button that calls `create-checkout` with the corresponding `priceId`
- This page is accessible only to authenticated users (behind `ProtectedRoute`)
- Simple, focused design -- no sidebar, just the plan cards

**2. Add subscription gate to `ProtectedRoute`**
- After confirming the user is logged in, check if `profile.subscription_status === 'active'`
- If not active, redirect to `/choose-plan` instead of letting them into the app
- Exception: the `/choose-plan` route itself and `/settings` should still be accessible (so users can complete payment or manage their subscription)

**3. Register the new route in `App.tsx`**
- Add `/choose-plan` as a protected route (requires auth but not subscription)

**4. Update `subscriptionTiers.ts`**
- Remove the `free` tier from `SUBSCRIPTION_TIERS` (or mark it as hidden) since it's no longer offered

**5. Verify webhook credit reset logic (already working)**
- The existing `stripe-webhook` function already resets `credits_used_this_month` to 0 on `subscription.created` and when a new billing period starts on `subscription.updated`
- No changes needed here -- this is your automatic monthly refill

### Technical Details

- `ProtectedRoute` will need access to the user's profile. It already has access via `useAuthStore` which includes `profile`. It will check `profile.subscription_status`.
- The `/choose-plan` page will use the existing `useSubscription` hook's `createCheckoutSession` method.
- The Stripe Checkout `success_url` will point to `/settings?success=true` (already configured), which triggers a profile refresh.
- A loading state will be shown while the profile is being fetched to avoid a flash redirect to `/choose-plan` for subscribed users.
- The `ProtectedRoute` will have an `allowedPaths` concept: routes like `/choose-plan` and `/settings` bypass the subscription check so users can complete their payment flow.
- No database changes needed -- all the required columns (`subscription_status`, `monthly_credit_limit`, `credits_used_this_month`, `billing_period_start`, `billing_period_end`) already exist on the `profiles` table.
- No new edge functions needed -- `create-checkout` and `stripe-webhook` already handle the full payment and credit provisioning flow.

