// Verifies that a build (default: dist/) contains a complete, consistent offline app shell:
// every build file is precached by sw.js, every precached entry exists, everything index.html and
// the manifest reference is precached, and nothing outside the build output is listed.
// Usage: node scripts/verify-app-shell.mjs [outDir]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const outDir = resolve(process.argv[2] ?? 'dist');
const problems = [];
const fail = (msg) => problems.push(msg);

const swPath = join(outDir, 'sw.js');
if (!existsSync(swPath)) {
  console.error(`✗ ${swPath} not found — run a production build first`);
  process.exit(1);
}
const sw = readFileSync(swPath, 'utf8');

// The minifier emits the list either as a JSON array or as a comma-joined string that is split.
const arrayMatch = sw.match(/\[(?:"\/[^"]*",?)+\]/);
const splitMatch = sw.match(/[`"'](\/[^`"']*)[`"']\.split\([`"'],[`"']\)/);
if (!arrayMatch && !splitMatch) {
  console.error('✗ could not find the precache list in sw.js');
  process.exit(1);
}
const precache = arrayMatch ? JSON.parse(arrayMatch[0]) : splitMatch[1].split(',');
const version = sw.match(/[`"']([0-9a-f]{16})[`"']/)?.[1];
if (!version) fail('no cache version found in sw.js');

const files = readdirSync(outDir, { withFileTypes: true, recursive: true })
  .filter((e) => e.isFile())
  .map((e) => `/${relative(outDir, join(e.parentPath, e.name)).replace(/\\/g, '/')}`)
  .filter((f) => f !== '/sw.js' && !f.endsWith('.map') && !f.split('/').some((p) => p.startsWith('.')));

for (const f of files) if (!precache.includes(f)) fail(`build file not precached: ${f}`);
for (const p of precache) {
  if (!p.startsWith('/') || p.startsWith('//') || /^\/?[a-z]+:/i.test(p)) fail(`precache entry is not a same-origin path: ${p}`);
  if (!existsSync(join(outDir, p))) fail(`precache entry missing from build: ${p}`);
  if (p === '/sw.js' || p.endsWith('.map')) fail(`must not be precached: ${p}`);
}

const html = readFileSync(join(outDir, 'index.html'), 'utf8');
const htmlRefs = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1]);
for (const ref of htmlRefs) if (!precache.includes(ref)) fail(`index.html references a file that is not precached: ${ref}`);

const manifestPath = join(outDir, 'manifest.webmanifest');
if (!existsSync(manifestPath)) fail('manifest.webmanifest missing');
else {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const icon of manifest.icons ?? []) if (!precache.includes(icon.src)) fail(`manifest icon not precached: ${icon.src}`);
}

// Every JS chunk import (static or lazy route) must resolve to a precached file.
for (const js of precache.filter((p) => p.endsWith('.js'))) {
  const code = readFileSync(join(outDir, js), 'utf8');
  for (const m of code.matchAll(/["'`](?:\.\/|\/assets\/)([\w.-]+\.(?:js|css))["'`]/g)) {
    if (!precache.includes(`/assets/${m[1]}`)) fail(`${js} imports ${m[1]}, which is not precached`);
  }
}

if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  process.exit(1);
}
const kb = Math.round(precache.reduce((n, p) => n + readFileSync(join(outDir, p)).length, 0) / 1024);
console.log(`✓ app shell complete: ${precache.length} files (${kb} KiB), index.html refs ${htmlRefs.length}, version ${version}`);
for (const p of precache) console.log(`  ${p}`);
