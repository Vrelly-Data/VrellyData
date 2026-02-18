
## Fix Google Search Results for Vrelly

### What's Happening

There are three separate problems causing the messy Google results:

1. **vrellydata.com** is a separate old domain that Google has independently indexed with its own old description ("B2B Audience Intelligence Platform"). That needs to be handled at the DNS/domain level — either point it to vrelly.com with a redirect, or leave it and let it age out.

2. **"Everything You Need to Scale Outbound Sales"** — Google is pulling this from a cached version of either vrellydata.com or an older vrelly.com. Once vrelly.com is properly live and Google re-crawls it, this will update to the current `index.html` description. Nothing in the current codebase has that old copy.

3. **"Inbox" and "Privacy Policy" sub-links** — Google is crawling `/auth` (shows "Welcome back. Sign in") and the footer links. These appear under the main result as sitelinks. To fix this, we need to:
   - Add a `noindex` meta tag to the `/auth` page so Google stops indexing the login screen
   - Create a real `sitemap.xml` (currently missing despite being referenced in `robots.txt`)
   - Update `robots.txt` to block indexing of app-internal routes (`/auth`, `/dashboard`, `/people`, etc.)

### Changes Required

**1. `index.html` — Update meta description (main Google snippet)**

The current description is fine technically but we'll sharpen it to exactly match what you want Google to show. This is the single most important change for what appears under "vrelly.com" in search.

**2. `public/robots.txt` — Block internal app routes**

Tell Google not to index pages that aren't public-facing:
```
Disallow: /auth
Disallow: /dashboard
Disallow: /people
Disallow: /companies
Disallow: /playground
Disallow: /settings
Disallow: /billing
Disallow: /admin
Disallow: /choose-plan
Disallow: /reset-password
```

**3. `public/sitemap.xml` — Create it (currently missing)**

The `robots.txt` references `https://vrelly.com/sitemap.xml` but that file doesn't exist. Google logs this as an error. We'll create it listing only the public pages:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://vrelly.com/</loc>
    <priority>1.0</priority>
    <changefreq>weekly</changefreq>
  </url>
</urlset>
```

**4. `src/pages/Auth.tsx` — Add noindex to the sign-in page**

Inject a `<meta name="robots" content="noindex, nofollow">` tag via a `useEffect` on the auth page so Google stops surfacing "Welcome back. Sign in to your account" as a sitelink.

**5. `src/components/landing/Footer.tsx` — Add real links for Privacy Policy and Terms**

Currently those links go to `#` (nothing). Google is indexing them as broken. We'll either create `/privacy` and `/terms` pages with real content, or mark those links with `rel="nofollow"` so Google ignores them in the meantime.

### What This Will NOT Fix Immediately

- **vrellydata.com** is a completely separate domain that only you can manage. If you own it, the best fix is to set up a 301 redirect from vrellydata.com → vrelly.com at the DNS level. If you don't own it, you can use Google Search Console to request removal.
- **Cached results** from before the DNS change — Google typically updates these within 1–4 weeks after it re-crawls your live domain.

### What This WILL Fix (After Google Re-crawls)

- The auth/inbox sitelink will disappear once `noindex` is in place
- The "Privacy Policy" sitelink will stop appearing
- Google will have a valid sitemap to properly understand your site structure
- The main description will be exactly what you specify in `index.html`

### Recommended New Meta Description for `index.html`

Something like: *"Vrelly provides enriched B2B prospect data, AI-powered sales agents, and outreach intelligence built on 200,000+ real sales campaigns. Scale your outbound today."*

This is 160 characters (Google's limit) and hits all three core keywords.
