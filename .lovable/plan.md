
## Comparisons: A Dedicated Standalone Page

### What's Being Built

A new public page at `/comparisons` that users reach by clicking "Comparisons" in the landing page navbar. It will NOT be embedded in the landing page — it's its own full-screen experience with the same Navbar and Footer.

---

### User Experience Flow

1. User visits `vrelly.com` (landing page)
2. Clicks **"Comparisons"** in the top nav
3. Navigates to `/comparisons` — a fresh page
4. Sees a hero header: **"Vrelly vs [animated competitor]"** where the competitor name cycles Apollo → ZoomInfo → Seamless → Standard LLM automatically
5. Two tab-style toggle buttons: **"Data Providers"** and **"Copy AI"**
6. The active tab shows a clear side-by-side comparison table
7. A CTA at the bottom: "Start for free" → `/auth?tab=signup`

---

### Page Structure: `/comparisons`

```text
[ Navbar ]
  |
  Hero: "See How Vrelly Compares"
  Subtitle: "Vrelly vs [animated: Apollo / ZoomInfo / Seamless / Standard LLM]"
  |
  Tab Toggle: [ Data Providers ]  [ Copy AI ]
  |
  Comparison Table (changes per tab):
    Left column: Competitor (red X marks)
    Right column: Vrelly (green check marks)
  |
  CTA Section: "Ready to switch?" → Get Started button
  |
[ Footer ]
```

---

### Tab 1 — Data Providers (Apollo, ZoomInfo, Seamless)

Animated competitor name cycles: Apollo → ZoomInfo → Seamless (every 2.5s)

| Feature | Apollo / ZoomInfo / Seamless | Vrelly |
|---|---|---|
| 10,000 enriched credits | Extremely expensive | Affordable at scale |
| Data Insights | None | Full campaign & performance analytics |
| Learns from YOUR data | No | Yes — AI trained on your history |
| Copy assistance | No | 1-click AI-powered copy improvement |
| Data freshness | Stale | Continuously verified |

### Tab 2 — Copy AI (Standard LLM)

Competitor name fixed to "Standard LLM" (ChatGPT, etc.)

| Feature | Standard LLM | Vrelly |
|---|---|---|
| Trained on sales correlation | Generic, mediocre output | Proprietary model on 200K+ real campaigns |
| Knows your data | No context about you | Learns from your historical performance |
| Outreach copy quality | Generic slop | High-converting, data-backed copy |
| Sales-specific training | None | Benchmarked against top performers |
| Personalization | One-size-fits-all | Tailored to your audience & vertical |

---

### Animation Details

- The animated competitor name uses `useState` + `useEffect` with `setInterval` at 2,500ms — same pattern as `AnimatedCounter` in HeroSection
- The name fades out and up using a CSS opacity + translateY transition (0.3s ease)
- When "Copy AI" tab is active, the animation pauses and shows "Standard LLM" as static text
- Scroll-entry animations use the existing `useScrollAnimation` hook for table rows fading in

---

### Files to Create / Modify

**New: `src/pages/Comparisons.tsx`**
- Full page with Navbar + Footer
- Hero header with animated competitor name
- Tab switcher (React `useState`)
- Side-by-side comparison grid
- CTA section at bottom

**Modified: `src/components/landing/Navbar.tsx`**
- Add `navigate('/comparisons')` link for "Comparisons" between "How It Works" and "Pricing"
- Logo click on the comparisons page navigates back to `/` (already handled by `window.scrollTo` — will change logo click to `navigate('/')` so it works from any page)

**Modified: `src/App.tsx`**
- Add `<Route path="/comparisons" element={<Comparisons />} />` as a public route (no auth required)

---

### Technical Notes

- No database or backend changes needed — purely frontend
- No new dependencies — uses lucide-react icons (`Check`, `X`), existing Tailwind, existing hooks
- The Navbar is already used on the Landing page; the same component works on `/comparisons` since it uses `useNavigate` (not scroll-based anchors for the new link)
- Logo click on Navbar will be updated from `window.scrollTo` to `navigate('/')` so it works correctly when accessed from `/comparisons`
