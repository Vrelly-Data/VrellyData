const DEFAULT_SITE_HOST = "www.vrelly.com";
const SUPABASE_URL_FALLBACK = "https://lgnvolndyftsbcjprmic.supabase.co";

type Resource = {
  slug: string;
  title: string;
  meta_description: string | null;
  excerpt: string | null;
  cover_image_url: string | null;
  published_at: string | null;
  is_published: boolean;
};

function getEnv(name: string): string | undefined {
  return (typeof process !== "undefined" && (process as any).env && (process as any).env[name]) || undefined;
}

function buildCanonical(slug: string): string {
  const canonicalHost = DEFAULT_SITE_HOST;
  return `https://${canonicalHost}/resources/${encodeURIComponent(slug)}`;
}

function toDescription(resource: Resource): string {
  const raw = resource.meta_description || resource.excerpt || "";
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (trimmed.length <= 0) return "Sales resources and guides from Vrelly.";
  if (trimmed.length <= 160) return trimmed;
  return trimmed.slice(0, 157) + "...";
}

async function fetchArticle(slug: string): Promise<Resource | null> {
  const SUPABASE_URL = getEnv("SUPABASE_URL") || getEnv("VITE_SUPABASE_URL") || SUPABASE_URL_FALLBACK;
  const SUPABASE_ANON_KEY = getEnv("SUPABASE_ANON_KEY") || getEnv("VITE_SUPABASE_PUBLISHABLE_KEY") || "";
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;

  const url = `${SUPABASE_URL}/rest/v1/resources?select=slug,title,meta_description,excerpt,cover_image_url,published_at,is_published&slug=eq.${encodeURIComponent(
    slug
  )}&is_published=eq.true`;
  const resp = await fetch(url, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!resp.ok) return null;
  const rows = (await resp.json()) as Resource[];
  return rows?.[0] ?? null;
}

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

function buildArticleJsonLd(resource: Resource, canonical: string): string {
  const image = resource.cover_image_url || "https://www.vrelly.com/og-image.png?v=4";
  const payload: any = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: resource.title,
    datePublished: resource.published_at || new Date().toISOString(),
    author: { "@type": "Organization", name: "Vrelly Team" },
    mainEntityOfPage: canonical,
  };
  if (image) payload.image = [image];
  return `<script type="application/ld+json">${JSON.stringify(payload)}</script>`;
}

function updateHtmlWithSeo(
  htmlIn: string,
  params: {
    title: string;
    description: string;
    canonical: string;
    ogTitle: string;
    ogDescription: string;
    ogUrl: string;
    twitterTitle: string;
    twitterDescription: string;
    ogImage?: string;
    jsonLd?: string;
  }
): string {
  let html = htmlIn;
  const {
    title,
    description,
    canonical,
    ogTitle,
    ogDescription,
    ogUrl,
    twitterTitle,
    twitterDescription,
    ogImage,
    jsonLd,
  } = params;
  const escTitle = escapeHtml(title);
  const escDesc = escapeHtml(description);
  const escCanonical = escapeHtml(canonical);
  const image = ogImage || "https://www.vrelly.com/og-image.png?v=4";

  html = replaceOrInsert(html, /<title>.*?<\/title>/is, `<title>${escTitle}</title>`, `<title>${escTitle}</title>`);
  html = replaceOrInsert(html, /<meta[^>]*name=["']description["'][^>]*>/i, `<meta name="description" content="${escDesc}" />`, `<meta name="description" content="${escDesc}" />`);
  html = replaceOrInsert(html, /<link[^>]*rel=["']canonical["'][^>]*>/i, `<link rel="canonical" href="${escCanonical}" />`, `<link rel="canonical" href="${escCanonical}" />`);
  html = replaceOrInsert(html, /<meta[^>]*property=["']og:title["'][^>]*>/i, `<meta property="og:title" content="${escapeHtml(ogTitle)}" />`, `<meta property="og:title" content="${escapeHtml(ogTitle)}" />`);
  html = replaceOrInsert(html, /<meta[^>]*property=["']og:description["'][^>]*>/i, `<meta property="og:description" content="${escapeHtml(ogDescription)}" />`, `<meta property="og:description" content="${escapeHtml(ogDescription)}" />`);
  html = replaceOrInsert(html, /<meta[^>]*property=["']og:url["'][^>]*>/i, `<meta property="og:url" content="${escapeHtml(ogUrl)}" />`, `<meta property="og:url" content="${escapeHtml(ogUrl)}" />`);
  html = replaceOrInsert(html, /<meta[^>]*property=["']og:image["'][^>]*>/i, `<meta property="og:image" content="${escapeHtml(image)}" />`, `<meta property="og:image" content="${escapeHtml(image)}" />`);
  html = replaceOrInsert(html, /<meta[^>]*name=["']twitter:title["'][^>]*>/i, `<meta name="twitter:title" content="${escapeHtml(twitterTitle)}" />`, `<meta name="twitter:title" content="${escapeHtml(twitterTitle)}" />`);
  html = replaceOrInsert(html, /<meta[^>]*name=["']twitter:description["'][^>]*>/i, `<meta name="twitter:description" content="${escapeHtml(twitterDescription)}" />`, `<meta name="twitter:description" content="${escapeHtml(twitterDescription)}" />`);
  html = replaceOrInsert(html, /<meta[^>]*name=["']twitter:card["'][^>]*>/i, `<meta name="twitter:card" content="summary_large_image" />`, `<meta name="twitter:card" content="summary_large_image" />`);
  html = replaceOrInsert(html, /<meta[^>]*name=["']twitter:image["'][^>]*>/i, `<meta name="twitter:image" content="${escapeHtml(image)}" />`, `<meta name="twitter:image" content="${escapeHtml(image)}" />`);
  if (jsonLd) {
    html = html.replace(/<\/head>/i, `${jsonLd}\n</head>`);
  }
  return html;
}

export default async function handler(req: any, res: any) {
  const proto = (req.headers?.["x-forwarded-proto"] as string) || "https";
  const host = (req.headers?.host as string) || DEFAULT_SITE_HOST;
  const slug = (req.query?.slug as string) || "";
  const cleanSlug = (slug || "").trim();
  if (!cleanSlug) {
    res.status(404).setHeader("content-type", "text/plain; charset=utf-8").send("Not Found");
    return;
  }

  const resource = await fetchArticle(cleanSlug);
  if (!resource) {
    res
      .status(404)
      .setHeader("content-type", "text/plain; charset=utf-8")
      .setHeader("cache-control", "public, max-age=60, s-maxage=60")
      .send("Not Found");
    return;
  }

  const originIndexUrl = `${proto}://${host}/`;
  const baseResp = await fetch(originIndexUrl, {
    headers: {
      "user-agent": (req.headers?.["user-agent"] as string) || "",
      accept: (req.headers?.accept as string) || "text/html",
    },
  });

  const title = `${resource.title} | Vrelly`;
  const description = toDescription(resource);
  const canonical = buildCanonical(resource.slug);
  const baseHtml = await baseResp.text();
  const ogImage = resource.cover_image_url || "https://www.vrelly.com/og-image.png?v=4";
  const jsonLd = buildArticleJsonLd(resource, canonical);
  const updatedHtml = updateHtmlWithSeo(baseHtml, {
    title,
    description,
    canonical,
    ogTitle: resource.title,
    ogDescription: description,
    ogUrl: canonical,
    twitterTitle: resource.title,
    twitterDescription: description,
    ogImage,
    jsonLd,
  });

  res
    .status(200)
    .setHeader("content-type", "text/html; charset=utf-8")
    .setHeader("cache-control", "public, s-maxage=600, max-age=60, stale-while-revalidate=86400")
    .send(updatedHtml);
}

