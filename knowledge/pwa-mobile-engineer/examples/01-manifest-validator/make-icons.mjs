// Generates the PNG icons + screenshot referenced by manifest.webmanifest (no dependencies).
// Run: node make-icons.mjs  -> writes ./icons/*.png and ./screenshots/*.png
// Real Beach Day art comes from Sable (UI designer); these are geometric placeholders with correct sizes.
import { deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const SKY = [14, 116, 144], SUN = [253, 224, 71], SAND = [250, 232, 196], SEA = [8, 80, 120];

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

/** RGB (colour type 2, fully opaque) PNG from a pixel function (x,y in 0..1) -> [r,g,b]. */
export function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixel((x + 0.5) / w, (y + 0.5) / h);
      raw[row + 1 + x * 3] = r; raw[row + 2 + x * 3] = g; raw[row + 3 + x * 3] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Art scale s: 1 for "any" icons; < 1 shrinks the key art (the sun) toward the centre so it stays inside
// the maskable safe zone (circle with radius 40% of the icon width). With s=0.62 the sun's farthest
// point is 0.16 x width from the centre.
function beach(s) {
  return (x, y) => {
    const cx = 0.5 + (x - 0.5) / s, cy = 0.5 + (y - 0.5) / s; // map into art space
    // Bands (sky/sea/sand) extend full-bleed; only the sun is key art that must stay in the safe zone.
    if ((cx - 0.5) ** 2 + (cy - 0.42) ** 2 < 0.18 ** 2) return SUN;
    if (cy > 0.66 && cy <= 0.74) return SEA;
    if (cy > 0.74) return SAND;
    return SKY;
  };
}

export function main(outDir = new URL('.', import.meta.url)) {
  const out = (p) => new URL(p, outDir);
  mkdirSync(out('icons/'), { recursive: true });
  mkdirSync(out('screenshots/'), { recursive: true });
  const files = {
    'icons/icon-192.png': png(192, 192, beach(1)),
    'icons/icon-512.png': png(512, 512, beach(1)),
    'icons/icon-maskable-512.png': png(512, 512, beach(0.62)), // sun (key art) inside the r = 0.4w safe-zone circle
    'icons/apple-touch-icon-180.png': png(180, 180, beach(1)),  // iOS ignores transparency: keep opaque
    'screenshots/today-narrow-1080x2340.png': png(1080, 2340, (x, y) => (y < 0.12 ? SEA : y > 0.8 ? SAND : SKY)),
  };
  for (const [p, buf] of Object.entries(files)) writeFileSync(out(p), buf);
  return Object.keys(files);
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(main().join('\n'));
