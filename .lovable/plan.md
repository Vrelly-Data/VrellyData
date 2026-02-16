

## Properly Set Up Email Authentication

### What's Missing

After reviewing the current auth setup, there are three gaps:

1. **Misleading signup message** -- The success toast says "Account created! You can now sign in." but email verification is required, so users need to check their email first.

2. **No password reset flow** -- There is no "Forgot Password?" link, no reset request handler, and no `/reset-password` page. Users who forget their password have no way to recover their account.

3. **No unverified email handling** -- When a user tries to sign in before verifying their email, the error message from the backend is generic. We should catch this and show a helpful message.

### Plan

**1. Fix the signup success message**
- Change the toast to: "Check your email! We sent you a verification link. Please confirm your email before signing in."

**2. Add "Forgot Password?" to the sign-in form**
- Add a link below the password field that triggers `supabase.auth.resetPasswordForEmail()` with `redirectTo` set to `window.location.origin + '/reset-password'`.
- Show a toast confirming the reset email was sent.

**3. Create a `/reset-password` page**
- New page at `src/pages/ResetPassword.tsx`
- Detects the `type=recovery` token in the URL hash (set automatically by the verification link)
- Shows a form to enter and confirm a new password
- Calls `supabase.auth.updateUser({ password })` to save the new password
- Redirects to `/dashboard` on success

**4. Add the `/reset-password` route**
- Register it in `App.tsx` as a public route (not behind `ProtectedRoute`)

### Technical Details

- `emailRedirectTo` on signup will stay as `window.location.origin + '/dashboard'` -- this is where verified users land after clicking the confirmation link.
- The reset password redirect URL will be `window.location.origin + '/reset-password'`.
- The `/reset-password` page will check for `access_token` and `type=recovery` in the URL hash to confirm it's a valid reset flow.
- Password confirmation field will validate that both entries match before submission.
- No database changes are needed -- this is purely frontend.

