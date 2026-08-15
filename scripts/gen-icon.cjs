/**
 * Generate the app icon (512x512 PNG) from the harness favicon.svg.
 * Uses sharp to render the DeepSeek mark in brand blue.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Resolve the favicon from the bundled harness runtime (no checkout needed).
const candidates = [
  process.env.DSH_ROOT && path.join(process.env.DSH_ROOT, 'apps', 'web', 'dist', 'favicon.svg'),
  path.join(__dirname, '..', 'harness-runtime', 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'favicon.svg'),
].filter(Boolean);
const SRC = candidates.find((c) => fs.existsSync(c));
const OUT = path.join(__dirname, '..', 'assets', 'icon.png');

if (!SRC) {
  console.error('[gen-icon] favicon.svg not found; run `npm run prepare-runtime` first.');
  process.exit(1);
}

let svg = fs.readFileSync(SRC, 'utf8');

// Brand-blue fill for the mark (the source uses fill="#000").
svg = svg.replace('fill="#000"', 'fill="#4D6BFE"');
// Drop the prefers-color-scheme override so the mark stays blue everywhere.
svg = svg.replace(/<style>[\s\S]*?<\/style>/, '');
// Upscale the 50x50 viewBox to a 512x512 render.
svg = svg.replace(/width="50\.000000" height="50\.000000"/, 'width="512" height="512"');

async function main() {
  await sharp(Buffer.from(svg), { density: 300 })
    .resize(512, 512)
    .png()
    .toFile(OUT);
  const b = fs.readFileSync(OUT);
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  console.log(`icon written: ${OUT} (${w}x${h}, ${b.length} bytes)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
