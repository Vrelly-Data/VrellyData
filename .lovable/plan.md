

# Fix Navbar Section Links on All Pages

## Problem
The Features, How It Works, and Pricing links in the Navbar only work on the Landing page because they use `scrollToSection()` which calls `document.getElementById()`. On other pages (Comparisons, Resources, Resource Article), those section IDs don't exist so nothing happens.

## Solution
Update the `scrollToSection` function in `Navbar.tsx` to check if the user is already on the landing page. If yes, smooth-scroll as before. If not, navigate to `/#section-id` first, then scroll after the page loads.

## Changes

### `src/components/landing/Navbar.tsx`
- Import `useLocation` from react-router-dom
- Update `scrollToSection` to check `location.pathname === '/'`
  - If on landing page: smooth scroll directly (current behavior)
  - If on another page: navigate to `/?section=<id>`, which will trigger scroll on arrival

### `src/pages/Landing.tsx`
- Add a `useEffect` that reads the `section` query parameter on mount
- If a section param exists, scroll to that element after a short delay (to allow render)
- Clean up the URL by replacing state to remove the query param

This approach keeps the smooth scroll experience on the landing page and reliably navigates + scrolls from any other page.
