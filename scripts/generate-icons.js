/**
 * Generates the web favicon, app icon, splash and Android icons from the
 * "Trace" app mark (round 3 N1a; docs/design_handoff_round3_field/assets):
 *   app-mark.svg             bordered rounded square: favicon, splash
 *   app-icon.svg             full-bleed #15181c, no border: iOS / store icon
 *   app-icon-foreground.svg  Android adaptive foreground (glyph only)
 *   app-icon-monochrome.svg  Android themed icon (glyph only, white)
 * Requires sharp (a dev dependency). Run from the project root:
 *   node scripts/generate-icons.js
 */

const fs = require('fs');
const path = require('path');

const ASSETS = path.join(process.cwd(), 'assets', 'images');
const SURFACE = {r: 0x15, g: 0x18, b: 0x1c};

// [source svg, output png, size in px]
const jobs = [
  ['app-mark.svg', 'favicon.png', 48],
  ['app-icon.svg', 'icon.png', 1024],
  ['app-mark.svg', 'splash-icon.png', 200],
  ['app-icon-foreground.svg', 'android-icon-foreground.png', 1024],
  ['app-icon-monochrome.svg', 'android-icon-monochrome.png', 1024],
];

async function main() {
  let sharp;
  try {
    sharp = require('sharp');
  } catch {
    console.error('Missing "sharp". Install it with: npm install sharp --save-dev');
    process.exit(1);
  }

  for (const [source, output, px] of jobs) {
    const svgPath = path.join(ASSETS, source);
    if (!fs.existsSync(svgPath)) {
      console.error('SVG not found:', svgPath);
      process.exit(1);
    }
    // The SVGs are 18 x 18: rasterise at the target size, not upscaled.
    const density = Math.ceil((72 * px) / 18);
    const outPath = path.join(ASSETS, output);
    await sharp(fs.readFileSync(svgPath), {density})
      .resize(px, px)
      .png()
      .toFile(outPath);
    console.log('Wrote', outPath, `(${px}x${px})`);
  }

  // Android adaptive icon background: the surface colour of the mark.
  const bgPath = path.join(ASSETS, 'android-icon-background.png');
  await sharp({
    create: {width: 1024, height: 1024, channels: 3, background: SURFACE},
  })
    .png()
    .toFile(bgPath);
  console.log('Wrote', bgPath, '(1024x1024 background)');
  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
