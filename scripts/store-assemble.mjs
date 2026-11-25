#!/usr/bin/env node
/**
 * LOCAL ONLY. Assembles hosting-release/ = the live customer root copied by store-mirror-live.mjs
 * (unchanged, byte-checked) + the new versioned tree release-tree/ under /app/{version}/, and writes
 * firebase.store-release.json (the production Hosting config with this tree's rewrites and cache
 * headers). Deploys nothing.
 */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const VERSION = process.env.STORE_RELEASE_VERSION || '0.9.3';
const TREE = `/app/${VERSION}`;
const OUT = 'hosting-release';
const fail = (msg) => {
  console.error('STOP: ' + msg);
  process.exit(1);
};

if (!existsSync('hosting-live-manifest.json') || !existsSync('hosting-live/index.html')) fail('run scripts/store-mirror-live.mjs first.');
if (!existsSync('release-tree/index.html')) fail('build the tree into release-tree/ first.');
const live = JSON.parse(readFileSync('hosting-live-manifest.json', 'utf8'));
if (live.fileCount < 20) fail(`only ${live.fileCount} live files were copied; refusing to replace the live site with so few.`);

const treeIndex = readFileSync('release-tree/index.html', 'utf8');
if (!treeIndex.includes(`${TREE}/assets/`)) fail(`release-tree/index.html does not load its assets from ${TREE}/ (wrong ZELVERO_BASE?).`);
if (/(src|href)="\/assets\//.test(treeIndex)) fail('release-tree/index.html points at the customer root /assets/.');

rmSync(OUT, { recursive: true, force: true });
cpSync('hosting-live', OUT, { recursive: true });
cpSync('release-tree', join(OUT, TREE), { recursive: true });

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
let same = 0;
for (const f of live.files) {
  if (sha(join(OUT, f.path)) !== f.sha256) fail(`customer file changed while assembling: ${f.path}`);
  same++;
}
// The only two root changes: boot.js follows a store that already updated to a listed tree, and
// release.json lists the trees it may follow.
cpSync('scripts/release-root-boot.js', join(OUT, 'boot.js'));
writeFileSync(join(OUT, 'release.json'), JSON.stringify({ trees: [VERSION] }) + '\n');
// robots.txt is a static file: Google's front end answers /robots.txt itself (an empty 404) before
// a function can, so it points at the shops' sitemap list that publicStorePage serves under /s/.
if (process.env.STORE_SHARE_PREVIEWS === '1') {
  const site = (process.env.STORE_SITE_ORIGIN || 'https://zelvoropos.web.app').replace(/\/+$/, '');
  writeFileSync(join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${site}/s/sitemaps.xml\n`);
}

const fb = JSON.parse(readFileSync('firebase.json', 'utf8'));
const prod = (Array.isArray(fb.hosting) ? fb.hosting : [fb.hosting]).find((h) => h.target === 'production');
if (!prod) fail('no production hosting entry in firebase.json');
const { target: _target, ...base } = prod;
const isOldTree = (src) => /^\/app\/0\.9\.(1-admin|2-ai)\./.test(src);
const headers = prod.headers.filter((h) => !isOldTree(h.source));
const at = headers.findIndex((h) => h.source === '/@(index.html|sw.js|boot.js|manifest.webmanifest)');
headers.splice(at, 0, { source: '/release.json', headers: [{ key: 'Cache-Control', value: 'no-cache' }] });
headers.splice(at + 2, 0, {
  source: `${TREE}/@(index.html|sw.js|boot.js|manifest.webmanifest)`,
  headers: [{ key: 'Cache-Control', value: 'no-cache' }],
});
headers.splice(headers.findIndex((h) => h.source === '/assets/**') + 1, 0, {
  source: `${TREE}/assets/**`,
  headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
});
const config = {
  hosting: {
    site: 'zelvoropos',
    ...base,
    public: OUT,
    rewrites: [
      { source: TREE, destination: `${TREE}/index.html` },
      { source: `${TREE}/**`, destination: `${TREE}/index.html` },
      // Public store pages run on the new tree while it is piloted; the customer app itself stays on the root.
      // STORE_SHARE_PREVIEWS=1 (only after publicStorePage is deployed with STORE_SHELL_PATH set to
      // this tree): store and product links get their own WhatsApp/Facebook preview.
      // STORE_IMAGES=1 (only after publicStoreImage is deployed): resized / JPEG product photos.
      ...(process.env.STORE_IMAGES === '1' ? [{ source: '/s/*/img/**', function: { functionId: 'publicStoreImage', region: 'europe-west1' } }] : []),
      process.env.STORE_SHARE_PREVIEWS === '1'
        ? { source: '/s/**', function: { functionId: 'publicStorePage', region: 'europe-west1' } }
        : { source: '/s/**', destination: `${TREE}/index.html` },
      { source: '**/!(*.*)', destination: '/index.html' },
    ],
    headers,
  },
};
writeFileSync('firebase.store-release.json', JSON.stringify(config, null, 2) + '\n');
console.log(`Assembled ${OUT}/: ${same - 1} live customer files unchanged, boot.js now follows updated stores, release.json lists ${VERSION}, + ${TREE}/. Wrote firebase.store-release.json.`);
