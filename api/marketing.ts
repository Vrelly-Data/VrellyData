const DEFAULT_SITE_HOST = "www.vrelly.com";

// Add new marketing pages plus special modes
type MarketingPage =
  | "resources"
  | "pricing"
  | "features"
  | "comparisons"
  | "demo"
  | "privacy"
  | "terms"
  | "agents";

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function replaceOrInsert(html: string, pattern: RegExp, replacement: string, fallbackInsertion: string): string {
  if (pattern.test(html)) return html.replace(pattern, replacement);
  return html.replace(/<\/head>/i, `${fallbackInsertion}\n</head>`);
}

function buildCanonical(path: string): string {
  return `https://${DEFAULT_SITE_HOST}${path}`;
}

function getDefaultsFor(page: MarketingPage) {
  switch (page) {
    case "resources":
      return {
        title: "Sales Resources & Guides | Vrelly",
        description:
          "Expert guides, playbooks, and data-driven insights on B2B outreach, sales sequences, and audience building. Learn from 200,000+ real campaigns.",
        canonical: buildCanonical("/resources"),
      };
    case "pricing":
      return {
        title: "Pricing | Vrelly",
        description: "Simple, transparent pricing to start selling smarter.",
        canonical: buildCanonical("/pricing"),
      };
    case "features":
      return {
        title: "Features | Vrelly",
        description: "AI-powered sales intelligence and outreach features.",
        canonical: buildCanonical("/features"),
      };
    case "comparisons":
      return {
        title: "Comparisons | Vrelly",
        description: "Compare Vrelly with alternatives and pick the best fit for your sales team.",
        canonical: buildCanonical("/comparisons"),
      };
    case "demo":
      return {
        title: "Book a Demo | Vrelly",
        description: "Book a 30-minute walkthrough of Vrelly’s AI sales agent. See how it books more meetings using your data.",
        canonical: buildCanonical("/demo"),
      };
    case "privacy":
      return {
        title: "Privacy Policy | Vrelly",
        description: "Read how Vrelly protects your data and privacy.",
        canonical: buildCanonical("/privacy"),
      };
    case "terms":
      return {
        title: "Terms of Service | Vrelly",
        description: "Review the terms and conditions for using Vrelly.",
        canonical: buildCanonical("/terms"),
      };
    case "agents":
      return {
        title: "AI Sales Agent That Books More Meetings | Vrelly",
        description: "Deploy your AI sales agent trained on your data to book more meetings, handle replies, and grow pipeline automatically.",
        canonical: buildCanonical("/agents"),
      };
  }
}

function updateHtmlWithSeo(
  htmlIn: string,
  params: { title: string; description: string; canonical: string; ogImage?: string; robots?: string }
) {
  const { title, description, canonical, ogImage } = params;
  let html = htmlIn;
  const escTitle = escapeHtml(title);
  const escDesc = escapeHtml(description);
  const escCanonical = escapeHtml(canonical);
  const image = ogImage || "https://www.vrelly.com/og-image.png?v=5";

  html = replaceOrInsert(html, /<title>.*?<\/title>/is, `<title>${escTitle}</title>`, `<title>${escTitle}</title>`);
  html = replaceOrInsert(
    html,
    /<meta[^>]*name=[\"']description[\"'][^>]*>/i,
    `<meta name="description" content="${escDesc}" />`,
    `<meta name="description" content="${escDesc}" />`
  );
  html = replaceOrInsert(
    html,
    /<link[^>]*rel=[\"']canonical[\"'][^>]*>/i,
    `<link rel="canonical" href="${escCanonical}" />`,
    `<link rel="canonical" href="${escCanonical}" />`
  );

  // Open Graph
  html = replaceOrInsert(
    html,
    /<meta[^>]*property=[\"']og:title[\"'][^>]*>/i,
    `<meta property="og:title" content="${escTitle}" />`,
    `<meta property="og:title" content="${escTitle}" />`
  );
  html = replaceOrInsert(
    html,
    /<meta[^>]*property=[\"']og:description[\"'][^>]*>/i,
    `<meta property="og:description" content="${escDesc}" />`,
    `<meta property="og:description" content="${escDesc}" />`
  );
  html = replaceOrInsert(
    html,
    /<meta[^>]*property=[\"']og:url[\"'][^>]*>/i,
    `<meta property="og:url" content="${escCanonical}" />`,
    `<meta property="og:url" content="${escCanonical}" />`
  );
  html = replaceOrInsert(
    html,
    /<meta[^>]*property=[\"']og:image[\"'][^>]*>/i,
    `<meta property="og:image" content="${escapeHtml(image)}" />`,
    `<meta property="og:image" content="${escapeHtml(image)}" />`
  );

  // Twitter
  html = replaceOrInsert(
    html,
    /<meta[^>]*name=[\"']twitter:title[\"'][^>]*>/i,
    `<meta name="twitter:title" content="${escTitle}" />`,
    `<meta name="twitter:title" content="${escTitle}" />`
  );
  html = replaceOrInsert(
    html,
    /<meta[^>]*name=[\"']twitter:description[\"'][^>]*>/i,
    `<meta name="twitter:description" content="${escDesc}" />`,
    `<meta name="twitter:description" content="${escDesc}" />`
  );
  html = replaceOrInsert(
    html,
    /<meta[^>]*name=[\"']twitter:card[\"'][^>]*>/i,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:card" content="summary_large_image" />`
  );
  html = replaceOrInsert(
    html,
    /<meta[^>]*name=[\"']twitter:image[\"'][^>]*>/i,
    `<meta name="twitter:image" content="${escapeHtml(image)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(image)}" />`
  );

  // Optional robots
  if ((params as any).robots) {
    const robots = escapeHtml((params as any).robots as string);
    html = replaceOrInsert(
      html,
      /<meta[^>]*name=[\"']robots[\"'][^>]*>/i,
      `<meta name="robots" content="${robots}" />`,
      `<meta name="robots" content="${robots}" />`
    );
  }

  return html;
}

export default async function handler(req: any, res: any) {
  const pageNameRaw = (req.query?.name as string) || "";
  const pageName = pageNameRaw as MarketingPage | "private" | "not-found";

  const proto = (req.headers?.["x-forwarded-proto"] as string) || "https";
  const host = (req.headers?.host as string) || DEFAULT_SITE_HOST;
  const originIndexUrl = `${proto}://${host}/`;

  // Handle special modes first
  if (pageName === "not-found") {
    const html404 = `<!doctype html>
<html lang="en"><head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Not Found | Vrelly</title>
<meta name="robots" content="noindex, nofollow" />
</head>
<body>
  <h1>404 Not Found</h1>
  <p>The page you are looking for does not exist.</p>
</body></html>`;
    res
      .status(404)
      .setHeader("content-type", "text/html; charset=utf-8")
      .setHeader("cache-control", "public, max-age=60, s-maxage=60")
      .send(html404);
    return;
  }

  const baseResp = await fetch(originIndexUrl, {
    headers: {
      "user-agent": (req.headers?.["user-agent"] as string) || "",
      accept: (req.headers?.accept as string) || "text/html",
    },
  });
  const baseHtml = await baseResp.text();

  if (pageName === "private") {
    // For app/private routes: preserve SPA shell but ensure noindex,nofollow and self-canonical
    const path = (req.url?.split("?")[0] || "/").trim() || "/";
    const canonical = buildCanonical(path);
    const updatedHtml = updateHtmlWithSeo(baseHtml, {
      title: "Vrelly",
      description: "Vrelly application",
      canonical,
      robots: "noindex, nofollow",
    });
    res
      .status(200)
      .setHeader("content-type", "text/html; charset=utf-8")
      .setHeader("cache-control", "public, s-maxage=600, max-age=60, stale-while-revalidate=86400")
      .send(updatedHtml);
    return;
  }

  // Known marketing pages
  if (!pageName || !["resources", "pricing", "features", "comparisons", "demo", "privacy", "terms", "agents"].includes(pageName)) {
    res.status(404).setHeader("content-type", "text/plain; charset=utf-8").send("Not Found");
    return;
  }

  const defs = getDefaultsFor(pageName as MarketingPage)!;
  const updatedHtml = updateHtmlWithSeo(baseHtml, {
    title: defs.title,
    description: defs.description,
    canonical: defs.canonical,
  });

  res
    .status(200)
    .setHeader("content-type", "text/html; charset=utf-8")
    .setHeader("cache-control", "public, s-maxage=600, max-age=60, stale-while-revalidate=86400")
    .send(updatedHtml);
}

