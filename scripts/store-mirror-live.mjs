#!/usr/bin/env node
/**
 * READ-ONLY. Copies every file the LIVE customer app at https://zelvoropos.web.app uses into
 * hosting-live/, so the next Hosting version can keep the customer root byte-for-byte while a new
 * versioned tree is added under /app/{version}/. Starts from index.html, sw.js, boot.js, the web
 * manifest and every file name in public/, then follows every file referenced from HTML, JS, CSS
 * and JSON. Writes hosting-live-manifest.json (path, size, sha256). Changes nothing online.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const ORIGIN = 'https://zelvoropos.web.app';
const OUT = 'hosting-live';
const TEXT = /\.(html|js|mjs|css|json|webmanifest|txt|svg|map)$/i;
const REF = /(?:["'`(\s,]|^)((?:\/|\.\/)?(?:assets|icons|fonts|preview)\/[A-Za-z0-9_\-./@~%]+\.[A-Za-z0-9]+)/g;
const ABS = /["'`(]\/([A-Za-z0-9_\-]+\.(?:js|png|ico|svg|webmanifest|webp|woff2|json|txt))["'`)]/g;

function publicFiles(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...publicFiles(p, base));
    else out.push('/' + relative(base, p).split('\\').join('/'));
  }
  return out;
}

const queue = ['/index.html', '/sw.js', '/boot.js', '/manifest.webmanifest', ...publicFiles('public')];
const seen = new Set();
const files = [];
const missing = [];
rmSync(OUT, { recursive: true, force: true });

while (queue.length) {
  const path = queue.shift();
  if (seen.has(path) || path.startsWith('/__/')) continue;
  seen.add(path);
  const res = await fetch(ORIGIN + path, { cache: 'no-store', redirect: 'manual' });
  const body = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get('content-type') || '';
  // Real files only: a missing file with an extension is a 404 (the SPA rewrite only covers extension-less paths).
  if (res.status !== 200 || (type.includes('text/html') && !path.endsWith('.html'))) {
    missing.push(`${path} -> ${res.status}`);
    continue;
  }
  const file = join(OUT, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
  files.push({ path, size: body.length, sha256: createHash('sha256').update(body).digest('hex') });
  if (!TEXT.test(path)) continue;
  const text = body.toString('utf8');
  const here = path.slice(0, path.lastIndexOf('/') + 1);
  for (const m of text.matchAll(REF)) {
    let ref = m[1].split(/[?#]/)[0];
    ref = ref.startsWith('./') ? here + ref.slice(2) : ref.startsWith('/') ? ref : '/' + ref;
    if (!seen.has(ref)) queue.push(ref);
  }
  for (const m of text.matchAll(ABS)) if (!seen.has('/' + m[1])) queue.push('/' + m[1]);
  // Vite chunks import each other by bare file name from the same folder.
  if (path.startsWith('/assets/')) {
    for (const m of text.matchAll(/["'`]\.\/([A-Za-z0-9_\-.]+\.(?:js|css|wasm|mjs))["'`]/g)) {
      const ref = '/assets/' + m[1];
      if (!seen.has(ref)) queue.push(ref);
    }
  }
}

files.sort((a, b) => a.path.localeCompare(b.path));
writeFileSync('hosting-live-manifest.json', JSON.stringify({ origin: ORIGIN, at: new Date().toISOString(), fileCount: files.length, files, notFound: missing }, null, 2));
console.log(`Copied ${files.length} live files into ${OUT}/ (not on the live site: ${missing.length}).`);
for (const m of missing) console.log('  not live: ' + m);
