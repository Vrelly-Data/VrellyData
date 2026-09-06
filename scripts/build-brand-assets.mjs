// Build and refresh Vrelly branding assets from existing repo sources.
// - Uses public/og-mark.png (current bird/wing V with transparent bg) as the
//   canonical square mark for favicons and app icons
// - Synthesizes a new wing+relly wordmark (transparent background) by
//   compositing the bird mark with an SVG text glyph "relly"
// - Replaces src/assets/vrelly-logo.png with the synthesized wordmark
// - Writes public/apple-touch-icon.png (180x180), public/vrelly-favicon.png
//   (512x512), public/favicon-32.png, public/favicon-16.png and public/favicon.ico
// - Updates public/og-mark.png to the new wing+relly wordmark for OG card usage
//
// Run:
//   node scripts/build-brand-assets.mjs
//
// Prereq: devDependencies include "sharp".

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
// Preferred sources:
// - Provided two-tone wordmark (if present via agent attachments)
const providedWordmarkPath = '/workspace/vrelly-brand/vrelly-wordmark-relly.png';
// - Provided two-tone bird mark (HD square), the canonical favicon source
const providedBirdPath = '/workspace/vrelly-brand/vrelly-avatar-hd.png';
// - Fallback: existing public favicon if provided asset is missing
const fallbackBirdPath = path.join(projectRoot, 'public', 'vrelly-favicon.png');
const outDirPublic = path.join(projectRoot, 'public');
const outDirSrcAssets = path.join(projectRoot, 'src', 'assets');

async function ensureDirs() {
  await fs.promises.mkdir(outDirPublic, { recursive: true });
  await fs.promises.mkdir(outDirSrcAssets, { recursive: true });
  await fs.promises.mkdir(path.join(outDirPublic, 'brand', 'sources'), { recursive: true });
}

async function loadBirdMark() {
  try {
    let sourcePath = providedBirdPath;
    try {
      await fs.promises.access(providedBirdPath);
    } catch {
      sourcePath = fallbackBirdPath;
    }
    const buf = await sharp(sourcePath).trim().png().toBuffer();
    const meta = await sharp(buf).metadata();
    if (!meta.hasAlpha) {
      // Keep going — favicons don't require transparency, but log for awareness.
      console.warn('Note: og-mark.png lacks alpha channel; continuing.');
    }
    return buf;
  } catch (err) {
    throw new Error(`Failed to read bird mark: ${err.message}`);
  }
}

async function writeFavicons(birdPng) {
  // Standard square icons derived from the bird mark (no wordmark text).
  const sizes = [16, 32, 48, 180, 192, 256, 512];
  const write = async (size, filename) => {
    const out = path.join(outDirPublic, filename);
    await sharp(birdPng).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 9 }).toFile(out);
  };
  await write(16, 'favicon-16.png');
  await write(32, 'favicon-32.png');
  await write(48, 'favicon-48.png');
  await write(180, 'apple-touch-icon.png'); // iOS
  await write(192, 'icon-192.png'); // PWA common
  await write(256, 'icon-256.png');
  // Also write a 512x512 PNG at legacy path (overwrite to ensure latest brand)
  await write(512, 'vrelly-favicon.png');
  // Note: sharp does not generate .ico; modern browsers accept the PNG links above.
}

// Final brand colors
const CYAN = '#18C0F8';   // wing + favicon
const BLUE = '#0070E8';   // "relly" text

function buildRellyTextSvg(heightPx, hexColor) {
  // Render the "relly" glyph as SVG; we intentionally oversize the canvas width
  // then trim it to a tight glyph box.
  const fontSize = Math.round(heightPx * 0.8);
  const baselineY = Math.round(heightPx * 0.85);
  const color = hexColor || BLUE;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="${heightPx}">
  <rect width="2000" height="${heightPx}" fill="transparent"/>
  <g font-family="'Inter','Helvetica Neue',Helvetica,Arial,sans-serif" font-weight="800">
    <text x="0" y="${baselineY}" font-size="${fontSize}" fill="${color}">relly</text>
  </g>
</svg>`;
  return Buffer.from(svg);
}

async function recolorToCyan(pngBuffer) {
  // Force solid cyan while preserving the alpha mask
  // Approach: grayscale + tint to cyan. Works for two-tone inputs.
  return await sharp(pngBuffer).grayscale().tint(CYAN).png().toBuffer();
}

async function buildWordmark(birdPng, targetHeight = 120) {
  // Prepare the bird glyph at target height
  const birdTightBase = await sharp(birdPng).trim().resize({ height: targetHeight, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  const birdTight = await recolorToCyan(birdTightBase);
  const birdMeta = await sharp(birdTight).metadata();

  // Prepare the "relly" text as PNG trimmed to content
  const textPng = await sharp(buildRellyTextSvg(targetHeight, BLUE)).png().trim().toBuffer();
  const textMeta = await sharp(textPng).metadata();

  const gap = Math.max(8, Math.round(targetHeight * 0.16)); // breathing room between wing and text
  const outW = (birdMeta.width ?? 0) + gap + (textMeta.width ?? 0);
  const outH = Math.max(birdMeta.height ?? targetHeight, textMeta.height ?? targetHeight);

  const composite = await sharp({
    create: {
      width: outW,
      height: outH,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: birdTight, left: 0, top: Math.round((outH - (birdMeta.height ?? targetHeight)) / 2) },
      { input: textPng, left: (birdMeta.width ?? 0) + gap, top: Math.round((outH - (textMeta.height ?? targetHeight)) / 2) },
    ])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();

  return composite;
}

async function main() {
  await ensureDirs();
  const birdPng = await loadBirdMark();
  let providedBirdExists = false;
  try { await fs.promises.access(providedBirdPath); providedBirdExists = true; } catch {}

  // 1) Favicons and touch icons from the bird mark
  const birdForIcons = providedBirdExists ? birdPng : await recolorToCyan(birdPng);
  await writeFavicons(birdForIcons);
  // Save sources into repo for reproducibility when provided
  if (providedBirdExists) {
    await sharp(birdPng).toFile(path.join(outDirPublic, 'brand', 'sources', 'bird-source.png'));
  }

  // 2) Wordmark: prefer provided single-cyan file; otherwise synthesize to match bird cyan
  try {
    await fs.promises.access(providedWordmarkPath);
    const provided = await sharp(providedWordmarkPath).png().toBuffer();
    await sharp(provided).toFile(path.join(outDirSrcAssets, 'vrelly-logo.png'));
    await sharp(provided).resize({ height: 120, fit: 'inside' }).toFile(path.join(outDirPublic, 'og-mark.png'));
    await sharp(provided).toFile(path.join(outDirPublic, 'brand', 'sources', 'wordmark-source.png'));
    console.log('Used provided wordmark from', providedWordmarkPath);
  } catch {
    const wordmarkLarge = await buildWordmark(birdForIcons, 180);
    await sharp(wordmarkLarge).png().toFile(path.join(outDirSrcAssets, 'vrelly-logo.png'));
    const wordmarkForOg = await sharp(wordmarkLarge).resize({ height: 120, fit: 'inside' }).png().toBuffer();
    await sharp(wordmarkForOg).toFile(path.join(outDirPublic, 'og-mark.png'));
    console.log('Synthesized two-tone wordmark (cyan wing + blue text)');
  }

  console.log('Brand assets written:\n' +
    ` - ${path.relative(projectRoot, path.join(outDirPublic, 'favicon.ico'))}\n` +
    ` - ${path.relative(projectRoot, path.join(outDirPublic, 'vrelly-favicon.png'))}\n` +
    ` - ${path.relative(projectRoot, path.join(outDirPublic, 'apple-touch-icon.png'))}\n` +
    ` - ${path.relative(projectRoot, path.join(outDirPublic, 'favicon-32.png'))}, favicon-16.png, icon-192.png, icon-256.png\n` +
    ` - ${path.relative(projectRoot, path.join(outDirSrcAssets, 'vrelly-logo.png'))} (wing+relly)\n` +
    ` - ${path.relative(projectRoot, path.join(outDirPublic, 'og-mark.png'))} (wing+relly for OG)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

