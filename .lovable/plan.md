
## Add Article Carousel Below the CTA on the Comparisons Page

### Where It Goes

The page currently ends: Comparison Table → CTA ("Ready to make the switch?") → Footer.

We're adding a new "From the Vrelly Blog" carousel section **between the CTA and the Footer**:

```text
[ Comparison Table ]
        ↓
[ Ready to make the switch? CTA ]   ← existing, unchanged
        ↓
[ From the Vrelly Blog ]            ← NEW
   [ ← ] [ Card 1 ] [ Card 2 ] [ Card 3 ] [ Card 4 ] [ → ]
        ↓
[ Footer ]
```

---

### What Each Card Looks Like

Each card in the carousel has:
- A cover image (fixed height, `object-cover`)
- A small category tag badge (e.g. "Data Insights", "Comparison")
- A bold title (2-line clamp)
- A "Read Article →" outline button that navigates to `/resources`

---

### 4 Placeholder Articles

| # | Title | Tag |
|---|-------|-----|
| 1 | How We Benchmarked 200K Cold Email Campaigns (And What We Found) | Data Insights |
| 2 | Apollo vs Vrelly: A Hands-On Data Quality Test | Comparison |
| 3 | The 5 Outreach Sequences That Consistently Book Meetings | Outreach |
| 4 | Why Generic AI Copy Kills Your Reply Rates | Copy AI |

Cover images use free Unsplash URLs — no auth needed.

---

### Technical Details

**Only one file changes: `src/pages/Comparisons.tsx`**

1. Add imports at the top: `Carousel`, `CarouselContent`, `CarouselItem`, `CarouselPrevious`, `CarouselNext` from `@/components/ui/carousel` (already installed in the project). Also `BookOpen` from `lucide-react`.
2. Define a `placeholderArticles` array of 4 objects (`title`, `tag`, `excerpt`, `image`) above the component.
3. Add a new `useScrollAnimation` ref for the blog section (consistent with the rest of the page's scroll-in animations).
4. Insert the new section **after** the closing `</section>` of the CTA block (line 249) and **before** `<Footer />`.
5. Carousel config: `opts={{ align: 'start', loop: true }}` — arrows on both sides, cards slide left/right on click.
6. On mobile: 1 card visible. On tablet: 2. On desktop: up to 3 (via `basis-full md:basis-1/2 lg:basis-1/3` on the `CarouselItem`).

No database changes, no new routes, no new dependencies.
