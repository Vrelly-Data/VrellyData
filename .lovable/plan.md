
## Default to Sign Up Tab from "Get Started" Buttons

### What Changes

1. **Auth page (`src/pages/Auth.tsx`)** -- Read a `?tab=signup` query parameter from the URL and use it as the default active tab instead of always defaulting to "signin".

2. **All "Get Started" buttons** -- Update navigation calls across landing page components to pass `?tab=signup`:
   - `src/components/landing/HeroSection.tsx` -- "Get Started" button
   - `src/components/landing/Navbar.tsx` -- "Get Started" button
   - `src/components/landing/SignUpSection.tsx` -- "Sign Up Now" button
   - `src/components/landing/AIAgentsSection.tsx` -- "Get Started Free" button
   - `src/components/landing/PricingSection.tsx` -- "Subscribe" buttons

3. **"Log In" button stays the same** -- The Navbar "Log In" button will continue navigating to `/auth` without the query param, landing on the sign-in tab as before.

### Technical Details

- In `Auth.tsx`, use `useSearchParams()` from `react-router-dom` to read the `tab` param and pass it as the `defaultValue` to the `Tabs` component.
- Update `navigate('/auth')` to `navigate('/auth?tab=signup')` in the relevant landing page buttons.
- No database or backend changes needed.
