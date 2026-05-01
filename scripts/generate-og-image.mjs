// Regenerates public/og-image.png from public/og-mark.png.
//
// Source files:
//   - public/og-mark.png   — corner brand input (currently the V-only mark).
//                            Swap this file when the corner branding changes;
//                            the script trims its transparent padding before
//                            resizing, so the input can be any reasonably
//                            tight crop of the desired mark.
//   - public/og-source.png — full wordmark logo, kept on disk for other
//                            future uses (favicons, social, etc) but NOT
//                            used for the OG card.
//
// Produces a 1200×630 OG card with:
//   - Diagonal gradient: Vrelly blue (#3b82f6, top-left) → deep navy (#0A0E27, bottom-right)
//   - V-only mark composited at top-left (~120px tall, 50px padding). Bright
//     blue V on the matching gradient corner has enough contrast on its own
//     — no vignette/backdrop needed.
//   - Headline (white, 64px, weight 800, letter-spacing -1.4) — two lines
//   - Tagline (white @ 70% opacity, 24px, weight 400) — two lines
//
// SVG composition: the gradient + text are rendered as a single SVG by
// libvips/resvg, then the mark PNG is composited on top. Font fallback chain
// lands on Helvetica Neue (macOS) when Inter isn't installed.
//
// Run:  node scripts/generate-og-image.mjs
// Idempotent — overwrites public/og-image.png in place.

import { statSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const markPath = resolve(projectRoot, 'public/og-mark.png');
const outputPath = resolve(projectRoot, 'public/og-image.png');

const W = 1200;
const H = 630;

const HEADLINE_LINE_1 = 'Outbound &amp; Inbound Sales Agents';
const HEADLINE_LINE_2 = 'Built on Your Data';
const TAGLINE_LINE_1 = 'Find prospects from a 100M-person database.';
const TAGLINE_LINE_2 = 'Run outbound on autopilot. Let Vrelly handle replies and follow ups.';

const HEADLINE_FONT_SIZE = 64;
const TAGLINE_FONT_SIZE = 24;
// -0.02em ≈ -1.28px at 64px; round to -1.4 for a touch more tightening.
const HEADLINE_LETTER_SPACING = -1.4;
const FONT_FAMILY = "'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif";

// Two-line headline (75px line-height) sits slightly above the canvas
// midpoint (315), leaving room for the two-line tagline below.
const HEADLINE_Y_1 = 305;
const HEADLINE_Y_2 = 380;
const TAGLINE_Y_1 = 460;
const TAGLINE_Y_2 = 492;

const MARK_HEIGHT = 120;
const MARK_PADDING = 50;

async function main() {
  // Trim transparent padding from the source so the entire MARK_HEIGHT budget
  // is filled with actual glyph content (the raw PNG is a centered mark with
  // significant transparent margin around it).
  const mark = await sharp(markPath)
    .trim()
    .resize({ height: MARK_HEIGHT, fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer();

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#0A0E27"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <g font-family="${FONT_FAMILY}" fill="#ffffff" text-anchor="middle">
    <text x="${W / 2}" y="${HEADLINE_Y_1}" font-size="${HEADLINE_FONT_SIZE}" font-weight="800" letter-spacing="${HEADLINE_LETTER_SPACING}">${HEADLINE_LINE_1}</text>
    <text x="${W / 2}" y="${HEADLINE_Y_2}" font-size="${HEADLINE_FONT_SIZE}" font-weight="800" letter-spacing="${HEADLINE_LETTER_SPACING}">${HEADLINE_LINE_2}</text>
    <text x="${W / 2}" y="${TAGLINE_Y_1}" font-size="${TAGLINE_FONT_SIZE}" font-weight="400" fill-opacity="0.7">${TAGLINE_LINE_1}</text>
    <text x="${W / 2}" y="${TAGLINE_Y_2}" font-size="${TAGLINE_FONT_SIZE}" font-weight="400" fill-opacity="0.7">${TAGLINE_LINE_2}</text>
  </g>
</svg>`;

  await sharp(Buffer.from(svg))
    .composite([{ input: mark, left: MARK_PADDING, top: MARK_PADDING }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(outputPath);

  const meta = await sharp(outputPath).metadata();
  const fileSize = statSync(outputPath).size;
  console.log(`Wrote ${outputPath} — ${meta.width}×${meta.height}, ${fileSize} bytes`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
