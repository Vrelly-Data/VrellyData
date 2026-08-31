export const config = {
  runtime: "edge",
};

type Resource = {
  slug: string;
  title: string;
  meta_description: string | null;
  excerpt: string | null;
  cover_image_url: string | null;
  published_at: string | null;
  is_published: boolean;
};

const DEFAULT_SITE_HOST = "www.vrelly.com";
const SUPABASE_URL_FALLBACK = "https://lgnvolndyftsbcjprmic.supabase.co";

function getEnv(name: string): string | undefined {
  // Edge runtime exposes env via process.env in Vercel
  // but guard for undefined in local/dev.
  // @ts-ignore
  return (typeof process !== "undefined" && process.env && process.env[name]) || undefined;
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
  const SUPABASE_ANON_KEY =
    getEnv("SUPABASE_ANON_KEY") || getEnv("VITE_SUPABASE_PUBLISHABLE_KEY") || "";

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    // Without credentials we cannot verify; fail closed as 404 to avoid bad canonicals.
    return null;
  }

  const url = `${SUPABASE_URL}/rest/v1/resources?select=slug,title,meta_description,excerpt,cover_image_url,published_at,is_published&slug=eq.${encodeURIComponent(
    slug
  )}&is_published=eq.true`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    // Edge fetch defaults to GET
  });

  if (!res.ok) {
    return null;
  }
  const rows = (await res.json()) as Resource[];
  if (!rows || rows.length === 0) return null;
  return rows[0] ?? null;
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
  if (pattern.test(html)) {
    return html.replace(pattern, replacement);
  }
  // Insert before </head>
  return html.replace(/<\/head>/i, `${fallbackInsertion}\n</head>`);
}

function updateHtmlWithSeo(htmlIn: string, params: { title: string; description: string; canonical: string; ogTitle: string; ogDescription: string; ogUrl: string; twitterTitle: string; twitterDescription: string; }): string {
  let html = htmlIn;
  const { title, description, canonical, ogTitle, ogDescription, ogUrl, twitterTitle, twitterDescription } = params;

  const escTitle = escapeHtml(title);
  const escDesc = escapeHtml(description);
  const escCanonical = escapeHtml(canonical);

  // <title>
  html = replaceOrInsert(
    html,
    /<title>.*?<\/title>/is,
    `<title>${escTitle}</title>`,
    `<title>${escTitle}</title>`
  );

  // meta description
  html = replaceOrInsert(
    html,
    /<meta[^>]*name=["']description["'][^>]*>/i,
    `<meta name="description" content="${escDesc}" />`,
    `<meta name="description" content="${escDesc}" />`
  );

  // canonical link
  html = replaceOrInsert(
    html,
    /<link[^>]*rel=["']canonical["'][^>]*>/i,
    `<link rel="canonical" href="${escCanonical}" />`,
    `<link rel="canonical" href="${escCanonical}" />`
  );

  // Open Graph
  html = replaceOrInsert(
    html,
    /<meta[^>]*property=["']og:title["'][^>]*>/i,
    `<meta property="og:title" content="${escapeHtml(ogTitle)}" />`,
    `<meta property="og:title" content="${escapeHtml(ogTitle)}" />`
  );
  html = replaceOrInsert(
    html,
    /<meta[^>]*property=["']og:description["'][^>]*>/i,
    `<meta property="og:description" content="${escapeHtml(ogDescription)}" />`,
    `<meta property="og:description" content="${escapeHtml(ogDescription)}" />`
  );
  html = replaceOrInsert(
    html,
    /<meta[^>]*property=["']og:url["'][^>]*>/i,
    `<meta property="og:url" content="${escapeHtml(ogUrl)}" />`,
    `<meta property="og:url" content="${escapeHtml(ogUrl)}" />`
  );

  // Twitter
  html = replaceOrInsert(
    html,
    /<meta[^>]*name=["']twitter:title["'][^>]*>/i,
    `<meta name="twitter:title" content="${escapeHtml(twitterTitle)}" />`,
    `<meta name="twitter:title" content="${escapeHtml(twitterTitle)}" />`
  );
  html = replaceOrInsert(
    html,
    /<meta[^>]*name=["']twitter:description["'][^>]*>/i,
    `<meta name="twitter:description" content="${escapeHtml(twitterDescription)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(twitterDescription)}" />`
  );

  return html;
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const slugParam = url.searchParams.get("slug");
  const slug = (slugParam || "").trim();

  if (!slug) {
    return new Response("Not Found", { status: 404 });
  }

  const resource = await fetchArticle(slug);
  if (!resource) {
    // Real 404 for unknown/unpublished slugs
    return new Response("Not Found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=60, s-maxage=60",
      },
    });
  }

  // Fetch the base index HTML from the same host so asset URLs remain correct.
  const originIndexUrl = `${url.origin}/`;
  const baseResp = await fetch(originIndexUrl, {
    headers: {
      // Forward basic headers to ensure correct locale/variants if any
      "user-agent": req.headers.get("user-agent") || "",
      accept: req.headers.get("accept") || "text/html",
    },
  });

  const title = `${resource.title} | Vrelly`;
  const description = toDescription(resource);
  const canonical = buildCanonical(resource.slug);

  const baseHtml = await baseResp.text();
  const updatedHtml = updateHtmlWithSeo(baseHtml, {
    title,
    description,
    canonical,
    ogTitle: resource.title,
    ogDescription: description,
    ogUrl: canonical,
    twitterTitle: resource.title,
    twitterDescription: description,
  });

  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    "cache-control": "public, s-maxage=600, max-age=60, stale-while-revalidate=86400",
  });

  return new Response(updatedHtml, {
    status: 200,
    headers,
  });
}

