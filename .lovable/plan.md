
## Fix: Resources as a Public Landing Page Link

The Resources page is already correctly built as a public route (`/resources` and `/resources/:slug` are unprotected in `App.tsx`, and the pages use the landing `Navbar` + `Footer`). There are just two things wrong and one thing missing:

---

### What Needs to Change

**1. Remove "Resources" from the app sidebar (`src/components/AppSidebar.tsx`)**

Line 22 adds `{ title: 'Resources', url: '/resources', icon: BookOpen }` to `navItems` — this means logged-in users see a "Resources" link inside the authenticated app shell, which is wrong. Resources is a public landing page, not an app page.

- Remove the `{ title: 'Resources', url: '/resources', icon: BookOpen }` entry from `navItems`
- Remove the unused `BookOpen` import from `lucide-react`

**2. Add "Resources" to the landing page Navbar (`src/components/landing/Navbar.tsx`)**

The landing Navbar currently has: Features, How It Works, Pricing, Comparisons. We add "Resources" as a navigation link that uses `navigate('/resources')` (same pattern as the Comparisons link, since it's a separate page, not an anchor scroll).

**3. Update `public/robots.txt` and `public/sitemap.xml`**

The Resources section should be crawlable and indexed by Google for SEO purposes.

- `robots.txt`: Remove any disallow for `/resources` (currently there is none, so this is already fine — but we should confirm no wildcard is blocking it)
- `sitemap.xml`: Add entries for `/resources` and a note that article slugs will be dynamic (static sitemap can include the index page; individual articles get picked up via crawl)

---

### Files Changed

| File | Change |
|------|--------|
| `src/components/AppSidebar.tsx` | Remove Resources nav item and BookOpen import |
| `src/components/landing/Navbar.tsx` | Add "Resources" link between "Comparisons" and the auth buttons |
| `public/sitemap.xml` | Add `/resources` URL entry |
| `public/robots.txt` | Explicitly allow `/resources` and `/resources/*` for all bots |

---

### No Database or Route Changes Needed

- Routes in `App.tsx` are already correct — `/resources` and `/resources/:slug` are public and unprotected
- The `publish-resource` edge function and `resources` table are already in place for the agent to populate articles
- The pages already use the landing `Navbar`/`Footer` — no shell/sidebar wrapping
