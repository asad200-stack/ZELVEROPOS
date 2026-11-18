/**
 * One-time download of the POS fonts into public/fonts (self-hosted: the CSP allows font-src 'self',
 * and the service worker precaches public files, so fonts keep working offline).
 *
 *   node scripts/fetch-fonts.mjs
 *
 * Sources: the open-source Fontsource packages on jsDelivr (Inter: OFL-1.1, IBM Plex Sans Arabic: OFL-1.1).
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'public', 'fonts');
const FILES = [
  ['https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@5/files/inter-latin-wght-normal.woff2', 'inter-latin-wght-normal.woff2'],
  ['https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-sans-arabic@5/files/ibm-plex-sans-arabic-arabic-400-normal.woff2', 'ibm-plex-sans-arabic-arabic-400-normal.woff2'],
  ['https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-sans-arabic@5/files/ibm-plex-sans-arabic-arabic-500-normal.woff2', 'ibm-plex-sans-arabic-arabic-500-normal.woff2'],
  ['https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-sans-arabic@5/files/ibm-plex-sans-arabic-arabic-600-normal.woff2', 'ibm-plex-sans-arabic-arabic-600-normal.woff2'],
  ['https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-sans-arabic@5/files/ibm-plex-sans-arabic-arabic-700-normal.woff2', 'ibm-plex-sans-arabic-arabic-700-normal.woff2'],
];

mkdirSync(OUT, { recursive: true });
let failed = 0;
for (const [url, name] of FILES) {
  const target = join(OUT, name);
  if (existsSync(target)) {
    console.log(`= ${name} (already there)`);
    continue;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    // woff2 files start with the "wOF2" signature; anything else is an error page.
    if (buf.subarray(0, 4).toString('latin1') !== 'wOF2') throw new Error('not a woff2 file');
    writeFileSync(target, buf);
    console.log(`+ ${name} (${Math.round(buf.length / 1024)} KB)`);
  } catch (error) {
    failed += 1;
    console.error(`! ${name}: ${error instanceof Error ? error.message : String(error)} — ${url}`);
  }
}
if (failed) {
  console.error(`${failed} font(s) failed. The app still works with system fonts; re-run when online.`);
  process.exit(1);
}
console.log('Fonts ready in public/fonts.');
