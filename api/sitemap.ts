// Node.js runtime Vercel Function

type Resource = {
  slug: string;
  published_at: string | null;
  is_published: boolean;
};

const DEFAULT_SITE_HOST = "www.vrelly.com";
const SUPABASE_URL_FALLBACK = "https://lgnvolndyftsbcjprmic.supabase.co";

function getEnv(name: string): string | undefined {
  // @ts-ignore
  return (typeof process !== "undefined" && process.env && process.env[name]) || undefined;
}

function formatDate(date: Date): string {
  // Return full ISO date (yyyy-mm-dd) as allowed by sitemaps.org
  return date.toISOString().split("T")[0];
}

function buildUrl(path: string): string {
  const host = DEFAULT_SITE_HOST;
  const base = `https://${host}`;
  return `${base}${path}`;
}

async function fetchPublishedResources(): Promise<Resource[]> {
  const SUPABASE_URL = getEnv("SUPABASE_URL") || getEnv("VITE_SUPABASE_URL") || SUPABASE_URL_FALLBACK;
  const SUPABASE_ANON_KEY =
    getEnv("SUPABASE_ANON_KEY") || getEnv("VITE_SUPABASE_PUBLISHABLE_KEY") || "";

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return [];
  }

  const url = `${SUPABASE_URL}/rest/v1/resources?select=slug,published_at,is_published&is_published=eq.true&order=published_at.desc.nullslast`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });
  if (!res.ok) return [];
  const rows = (await res.json()) as Resource[];
  return rows ?? [];
}

export default async function handler(_: any, res: any) {
  const today = new Date();
  const staticPages: { path: string; changefreq: string; priority: string }[] = [
    { path: "/", changefreq: "weekly", priority: "1.0" },
    { path: "/resources", changefreq: "weekly", priority: "0.8" },
    { path: "/comparisons", changefreq: "monthly", priority: "0.7" },
    { path: "/pricing", changefreq: "monthly", priority: "0.8" },
    { path: "/features", changefreq: "monthly", priority: "0.7" }
  ];

  const resources = await fetchPublishedResources();

  const urls: string[] = [];
  for (const p of staticPages) {
    urls.push(
      `  <url>
    <loc>${buildUrl(p.path)}</loc>
    <lastmod>${formatDate(today)}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`
    );
  }

  for (const r of resources) {
    const lastmod = r.published_at ? formatDate(new Date(r.published_at)) : formatDate(today);
    urls.push(
      `  <url>
    <loc>${buildUrl(`/resources/${r.slug}`)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`
    );
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`;

  res
    .status(200)
    .setHeader("content-type", "application/xml; charset=utf-8")
    .setHeader("cache-control", "public, s-maxage=600, max-age=60, stale-while-revalidate=86400")
    .send(xml);
}

