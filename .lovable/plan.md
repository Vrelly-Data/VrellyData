

# Landing Page Overhaul: Messaging, Animations, and SEO

## Overview

Complete rewrite of the landing page content to clearly communicate Vrelly's value proposition across 5 pillars, add scroll-triggered animations and motion effects for a tech-forward feel, and optimize all SEO metadata for "AI sales agents", "sales data", and "prospect data" keywords.

## Page Structure (Top to Bottom)

### 1. Navbar (minor update)
- Add section nav links: Features, How It Works, Pricing
- Keep existing logo + Log In / Get Started buttons

### 2. Hero Section (rewrite copy + add animations)
- **Headline**: "Your Sales Data. Your AI Agent. Your Competitive Edge."
- **Subheadline**: Clearly state the 3 things Vrelly does: Enriched prospect data at scale, AI-powered sales intelligence from your real campaign data, 1-click AI sales agents trained on your performance
- **Animations**: Floating particle dots, animated counter showing "200K+ campaigns analyzed", staggered fade-in on headline words, typing effect on the badge text
- Keep logo, CTA buttons, and trust badges

### 3. Features Section (expand from 4 to 6 cards, new copy)
Replace the current 4 generic cards with 6 specific value props:

| Card | Title | Description |
|------|-------|-------------|
| 1 | Fully Verified Prospect Data | Triple-verified emails, skip-traced direct dials, 20+ enrichment fields. Affordable at scale. |
| 2 | Sync and Capture Sales Data | Connect your sales and marketing tools. We organize, compartmentalize, and analyze your outbound data automatically. |
| 3 | Proprietary Sales Repository | Hundreds of thousands of real outbound campaigns with copy, performance metrics, and a proprietary scoring system. |
| 4 | 1-Click Copy Improvement | AI rewrites your outreach copy using your historical performance + our sales repo + predictive model. |
| 5 | 1-Click Audience Building | AI builds prospect audiences based on your wins, our repo intelligence, and predictive targeting. |
| 6 | AI Sales Agent | 1-click setup for an AI agent trained on your live data, current sales trends, and our proprietary repository. |

- **Animations**: Cards stagger-animate in on scroll (fade-up with delay), icons pulse on hover, gradient border animation on hover

### 4. NEW: "How It Works" Section
A 3-step visual flow showing:
1. **Connect** -- Sync your CRM, email tools, and LinkedIn. We capture every campaign, sequence, and result.
2. **Analyze** -- Your data is scored, compartmentalized, and cross-referenced against our proprietary sales repository.
3. **Act** -- 1-click to improve copy, build audiences, or launch an AI sales agent -- all powered by real data.

- **Animations**: Horizontal timeline with animated connecting lines, each step fades in sequentially on scroll, animated icons (sync spinner, chart bars growing, rocket launch)

### 5. NEW: "AI Sales Agents" Section
Dedicated section for the enterprise/custom AI agent pitch:
- "We build AI sales agents that prioritize security and proprietary data"
- Two paths: **Use Vrelly Sales Agent** (trained on live data + repo) or **Custom Enterprise Agent** (built for your company, your data, your rules)
- Trust signals: SOC-2 compliance language, data isolation, no third-party training

- **Animations**: Split-screen reveal on scroll, shield icon animation for security emphasis

### 6. Pricing Section (keep as-is, no changes)

### 7. CTA / Sign Up Section (update copy)
- Update headline to: "Stop Guessing. Start Selling with Data."
- Update sub-copy to reference AI agents and data intelligence

### 8. Footer (update)
- Add "Vrelly.com" text reference
- Keep TOS/Privacy/Contact links

## Animations (Tailwind Config + CSS)

Add the following to `tailwind.config.ts` keyframes:
- `fade-up`: translateY(20px) + opacity 0 to translateY(0) + opacity 1
- `float`: subtle up/down bobbing loop
- `slide-in-left` / `slide-in-right`: for timeline steps
- `count-up`: CSS counter animation for stats
- `gradient-shift`: animated gradient border effect
- `particle-float`: random floating dots in hero background

Create a reusable `useScrollAnimation` hook that uses IntersectionObserver to add animation classes when elements enter the viewport.

## SEO Updates

### index.html meta tags
- **Title**: "Vrelly | AI Sales Agents, Enriched Prospect Data, and Sales Intelligence"
- **Description**: "Vrelly provides fully verified B2B prospect data, AI-powered sales agents, and predictive outreach intelligence built on hundreds of thousands of real sales campaigns."
- **Keywords meta**: "AI sales agent, sales data, prospect data, B2B data provider, sales intelligence, outbound sales AI, enriched contact data"
- **OG tags**: Update title, description, and url to vrelly.com
- **Twitter tags**: Update to @vrelly or remove @lovable_dev
- **Canonical**: Add `<link rel="canonical" href="https://vrelly.com/" />`

### robots.txt
- Add `Sitemap: https://vrelly.com/sitemap.xml`

### Structured Data (JSON-LD)
Add `<script type="application/ld+json">` in index.html with:
- Organization schema (name: Vrelly, url: https://vrelly.com)
- SoftwareApplication schema for the AI sales agent product

## Files Changed

| File | What Changes |
|------|-------------|
| `index.html` | SEO meta tags, canonical, JSON-LD structured data |
| `public/robots.txt` | Add sitemap reference |
| `tailwind.config.ts` | Add new animation keyframes (fade-up, float, slide-in, gradient-shift) |
| `src/index.css` | Add utility classes for scroll animations |
| `src/hooks/useScrollAnimation.ts` | NEW -- IntersectionObserver hook for scroll-triggered animations |
| `src/pages/Landing.tsx` | Add HowItWorksSection and AIAgentsSection imports |
| `src/components/landing/Navbar.tsx` | Add section nav links (Features, How It Works, Pricing) |
| `src/components/landing/HeroSection.tsx` | Rewrite copy, add animated counters, particle background, staggered text |
| `src/components/landing/FeaturesSection.tsx` | Expand to 6 cards with new messaging, add scroll animations |
| `src/components/landing/HowItWorksSection.tsx` | NEW -- 3-step animated timeline section |
| `src/components/landing/AIAgentsSection.tsx` | NEW -- Dedicated AI agent section with security messaging |
| `src/components/landing/SignUpSection.tsx` | Update copy to reference AI agents and data intelligence |
| `src/components/landing/Footer.tsx` | Add vrelly.com reference |

## Technical Notes

- All animations use CSS + Tailwind only (no animation libraries needed)
- IntersectionObserver hook keeps animations performant by only triggering when elements scroll into view
- Staggered delays use inline `style={{ animationDelay }}` for each card/step
- SEO structured data uses JSON-LD which is the format Google prefers
- No database or backend changes required

