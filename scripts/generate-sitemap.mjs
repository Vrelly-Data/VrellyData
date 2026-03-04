import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const SUPABASE_URL = 'https://lgnvolndyftsbcjprmic.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnbnZvbG5keWZ0c2JjanBybWljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxMzc4NDAsImV4cCI6MjA4NzcxMzg0MH0.Y84AiuDMsDQHCP9RnlKJzy8LFa6KJ3_7u0CK6jwDBog';

const SITE_URL = 'https://www.vrelly.com';
const TODAY = new Date().toISOString().split('T')[0];

const staticPages = [
  { path: '/', priority: '1.0', changefreq: 'weekly' },
  { path: '/resources', priority: '0.8', changefreq: 'weekly' },
  { path: '/comparisons', priority: '0.8', changefreq: 'monthly' },
  { path: '/playground', priority: '0.6', changefreq: 'monthly' },
  { path: '/pricing', priority: '0.8', changefreq: 'monthly' },
];

async function fetchPublishedResources() {
  const url = `${SUPABASE_URL}/rest/v1/resources?select=slug&is_published=eq.true`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Supabase REST error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

function buildSitemap(resources) {
  const urls = [
    ...staticPages.map(
      (p) => `  <url>
    <loc>${SITE_URL}${p.path}</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`
    ),
    ...resources.map(
      (r) => `  <url>
    <loc>${SITE_URL}/resources/${r.slug}</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`
    ),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`;
}

async function main() {
  console.log('Fetching published resources from Supabase...');
  const resources = await fetchPublishedResources();
  console.log(`Found ${resources.length} published resources.`);

  const sitemap = buildSitemap(resources);

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const outPath = join(__dirname, '..', 'public', 'sitemap.xml');
  writeFileSync(outPath, sitemap, 'utf-8');
  console.log(`Sitemap written to ${outPath}`);
}

main().catch((err) => {
  console.error('Failed to generate sitemap:', err);
  process.exit(1);
});
