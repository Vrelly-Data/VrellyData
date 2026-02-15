

# Remove "Free" Mentions from Pricing Section

## Change

**File: `src/components/landing/PricingSection.tsx`**

Remove the first tier entry (the `free` tier) from the `tiers` array (lines 15-19), so only Starter, Professional, and Enterprise cards are shown.

**File: `src/components/landing/HeroSection.tsx`**

- Change the CTA button text from "Start Free" to "Get Started" (around line 100)
- Remove the "25 free credits" stat item from the bottom stats row (around line 114-117)
- Remove the "No credit card required" item as well if desired, or keep it — your call

No other files affected.

