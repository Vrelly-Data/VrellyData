

## Exempt Admins from Subscription Gate

### Problem
The `ProtectedRoute` subscription gate redirects ALL users without an active subscription to `/choose-plan`, including the super admin account. Admins should have unrestricted access.

### Solution
Update `ProtectedRoute` to check if the user has an admin role before enforcing the subscription check. If they're an admin in any team, skip the subscription gate entirely.

### Changes

**1. Update `src/components/ProtectedRoute.tsx`**
- Import `useAuthStore`'s `isAdmin` function (already available in the store)
- Before checking `subscription_status`, call `isAdmin()` -- if true, skip the redirect to `/choose-plan`

The updated logic will be:
```
if user is not logged in -> redirect to /auth
if user is admin -> allow through (no subscription check)
if path is exempt (/choose-plan, /settings, /billing) -> allow through
if subscription_status !== 'active' -> redirect to /choose-plan
```

### Technical Details
- `useAuthStore` already exposes `isAdmin()` which checks `userRoles` for any admin role
- `userRoles` are loaded alongside the profile in `fetchProfile`, so they'll be available by the time the subscription check runs
- No database or backend changes needed -- purely a frontend gate update
