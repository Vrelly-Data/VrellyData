const DEFAULT_SITE_HOST = "www.vrelly.com";

type MarketingPage = "resources" | "pricing" | "features" | "comparisons";

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
  }
}

function updateHtmlWithSeo(htmlIn: string, params: { title: string; description: string; canonical: string; ogImage?: string }) {
  const { title, description, canonical, ogImage } = params;
  let html = htmlIn;
  const escTitle = escapeHtml(title);
  const escDesc = escapeHtml(description);
  const escCanonical = escapeHtml(canonical);
  const image = ogImage || "https://www.vrelly.com/og-image.png?v=2";

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

  return html;
}

export default async function handler(req: any, res: any) {
  const pageName = (req.query?.name as string) as MarketingPage | undefined;
  if (!pageName || !["resources", "pricing", "features", "comparisons"].includes(pageName)) {
    res.status(404).setHeader("content-type", "text/plain; charset=utf-8").send("Not Found");
    return;
  }

  const proto = (req.headers?.["x-forwarded-proto"] as string) || "https";
  const host = (req.headers?.host as string) || DEFAULT_SITE_HOST;
  const originIndexUrl = `${proto}://${host}/`;

  const baseResp = await fetch(originIndexUrl, {
    headers: {
      "user-agent": (req.headers?.["user-agent"] as string) || "",
      accept: (req.headers?.accept as string) || "text/html",
    },
  });
  const baseHtml = await baseResp.text();

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

