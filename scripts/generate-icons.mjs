// Generates the app icons and web manifest into public/ (committed; re-run only to change the design).
// Usage: node scripts/generate-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public');
const BG = [79, 70, 229]; // --c-primary
const FG = [255, 255, 255];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Coverage (0..1) of the design at a point in unit coordinates: rounded square background + "Z". */
function sample(x, y, { radius, inset }) {
  // Rounded square
  const r = radius;
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  const inBg = (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  if (!inBg) return null;
  // "Z" inside [inset, 1-inset]
  const a = inset;
  const b = 1 - inset;
  const t = (b - a) * 0.17; // stroke thickness
  const u = (x - a) / (b - a);
  const v = (y - a) / (b - a);
  if (u < 0 || u > 1 || v < 0 || v > 1) return 'bg';
  const tv = t / (b - a);
  if (v <= tv || v >= 1 - tv) return 'fg';
  // Diagonal from top-right to bottom-left
  const d = Math.abs(u + v - 1) / Math.SQRT2;
  return d <= tv * 0.75 ? 'fg' : 'bg';
}

function render(size, opts) {
  const ss = 4;
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const s = sample((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size, opts);
          if (s === 'bg') bg++;
          else if (s === 'fg') fg++;
        }
      }
      const cover = (bg + fg) / (ss * ss);
      const i = (py * size + px) * 4;
      if (cover === 0) continue;
      const f = fg / (bg + fg);
      for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(BG[c] * (1 - f) + FG[c] * f);
      rgba[i + 3] = Math.round(cover * 255);
    }
  }
  return png(size, rgba);
}

function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + pngs.length * 16;
  const entries = pngs.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

const regular = { radius: 0.22, inset: 0.24 };
// Maskable icons are cropped by the OS to a circle/squircle: full-bleed background, logo in the safe zone.
const maskable = { radius: 0.0001, inset: 0.3 };
// Apple applies its own rounding; a full square avoids transparent corners.
const apple = { radius: 0.0001, inset: 0.24 };

mkdirSync(join(out, 'icons'), { recursive: true });
const write = (file, data) => {
  writeFileSync(join(out, file), data);
  console.log(`public/${file}  ${data.length} bytes`);
};

write('favicon.ico', ico([16, 32, 48].map((size) => ({ size, data: render(size, regular) }))));
write('favicon-32x32.png', render(32, regular));
write('apple-touch-icon.png', render(180, apple));
write('icons/icon-192.png', render(192, regular));
write('icons/icon-512.png', render(512, regular));
write('icons/maskable-512.png', render(512, maskable));

const manifest = {
  name: 'Zelvero POS',
  short_name: 'Zelvero',
  description: 'Point of sale for mobile phone and accessories shops',
  id: '/',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#0f172a',
  theme_color: '#0f172a',
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};
write('manifest.webmanifest', `${JSON.stringify(manifest, null, 2)}\n`);
