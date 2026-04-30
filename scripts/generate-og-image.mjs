// Regenerates public/og-image.png from public/og-source.png.
//
// Produces a 1200×630 PNG (the canonical Open Graph card aspect ratio).
// Source logo is letterboxed onto a black canvas and scaled to ~70% of the
// card height — large enough to read on iMessage/LinkedIn previews without
// crowding the edges.
//
// Run:  node scripts/generate-og-image.mjs
//
// Re-run any time the source logo changes — the script is idempotent and
// overwrites public/og-image.png in place.

import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const sourcePath = resolve(projectRoot, 'public/og-source.png');
const outputPath = resolve(projectRoot, 'public/og-image.png');

const CANVAS_W = 1200;
const CANVAS_H = 630;
const LOGO_HEIGHT_RATIO = 0.7;
const BG = { r: 0, g: 0, b: 0, alpha: 1 };

async function main() {
  const targetLogoHeight = Math.round(CANVAS_H * LOGO_HEIGHT_RATIO);

  // Resize the source logo to the target height (width auto-scales to keep
  // the original aspect ratio — sharp does not crop on `inside` fit).
  const resizedLogo = await sharp(sourcePath)
    .resize({ height: targetLogoHeight, fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: CANVAS_W,
      height: CANVAS_H,
      channels: 4,
      background: BG,
    },
  })
    .composite([{ input: resizedLogo, gravity: 'center' }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    // withMetadata() not called → metadata is stripped by default.
    .toFile(outputPath);

  const { width, height, size } = await sharp(outputPath).metadata();
  console.log(`Wrote ${outputPath} — ${width}×${height}, ${size ?? '?'} bytes`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
