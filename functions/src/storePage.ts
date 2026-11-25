/**
 * Server-rendered storefront shell for share previews and installs.
 *
 *   GET /s/{slug}                        the app's HTML shell with the shop's own title,
 *                                        description, preview image and manifest link, so a
 *                                        link pasted in WhatsApp / Instagram / Facebook shows
 *                                        the shop instead of "ZELVERO POS".
 *   GET /s/{slug}/manifest.webmanifest   per-shop web app manifest ("Add to home screen").
 *   GET /s/{slug}/sitemap.xml            the shop and every product link, for search engines.
 *   GET /s/{slug}/feed.xml               product catalogue for Facebook / Instagram Shopping and
 *                                        Google Merchant Center (photos as JPEG via storeImage).
 *   GET /robots.txt                      lists every published shop's sitemap.
 * The page HTML also carries schema.org product data and a <noscript> list of product links.
 *
 * Wiring (Hosting rewrite, added only when this function is deployed, see
 * .claude/storefront-progress.md): { "source": "/s/**", "function": { "functionId":
 * "publicStorePage", "region": "europe-west1" } } placed before the catch-all rewrite.
 *
 * The HTML shell is always fetched from the configured STORE_SITE_ORIGIN (never from the
 * request's Host header), so the function can't be pointed at other servers. Unknown or
 * unpublished stores get the plain shell; the app then shows its own "not found" page.
 */
import { onRequest } from 'firebase-functions/v2/https';
import { db } from './admin.js';
import { REGION, STORE_EXTRA_HOSTS, STORE_SHELL_PATH, STORE_SITE_ORIGIN } from './config.js';
import { loadPublicCatalog, type PublicCatalogResponse } from './onlineStore.js';
import {
  injectShareMeta,
  normalizeSlug,
  productShareMeta,
  slugProblem,
  storeManifest,
  storeShareMeta,
  type PublicProduct,
  type StoreShareMeta,
} from './shared/onlineStore.js';
import { injectSeo, productFeedXml, robotsTxt, SITEMAP_INDEX_PATH, sitemapIndexXml, sitemapXml, storeImageUrl, type SeoStore } from './shared/storeSeo.js';

const SHELL_TTL_MS = 5 * 60_000;
const META_TTL_MS = 5 * 60_000;
const FALLBACK_SHELL = `<!doctype html>
<html lang="en" dir="ltr" data-release-boot="1">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ZELVERO POS</title>
    <script src="/boot.js"></script>
  </head>
  <body></body>
</html>
`;

let shell: { html: string; atMs: number } | null = null;

function siteOrigin(): string {
  const raw = (STORE_SITE_ORIGIN.value() || '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(raw) ? raw : 'https://zelvoropos.web.app';
}

async function loadShell(now: number): Promise<string> {
  if (shell && now - shell.atMs < SHELL_TTL_MS) return shell.html;
  try {
    const path = STORE_SHELL_PATH.value().trim();
    const shellPath = /^\/[A-Za-z0-9._/-]*\.html$/.test(path) && !path.includes('..') ? path : '/index.html';
    const res = await fetch(`${siteOrigin()}${shellPath}`, { signal: AbortSignal.timeout(4000) });
    const html = res.ok ? await res.text() : '';
    if (/<\/head>/i.test(html) && html.length < 200_000) {
      shell = { html, atMs: now };
      return html;
    }
  } catch {
    // Fall through to the loader shell below.
  }
  return shell?.html ?? FALLBACK_SHELL;
}

/** The origin to print in og:url: the request's host only when it's ours, else the site origin. */
function linkOrigin(host: string | undefined): string {
  const site = siteOrigin();
  const h = (host ?? '').split(',')[0]?.trim().toLowerCase() ?? '';
  const siteHost = new URL(site).host.toLowerCase();
  const project = process.env.GCLOUD_PROJECT ?? '';
  const allowed = new Set(
    [siteHost, project && `${project}.web.app`, project && `${project}.firebaseapp.com`, ...STORE_EXTRA_HOSTS.value().split(',')]
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
  );
  return h && allowed.has(h) ? `https://${h}` : site;
}

const PRODUCT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

interface LoadedStore {
  meta: StoreShareMeta;
  seo: SeoStore;
  /** Products on the website, in the shop's order (same rules as publicStoreCatalog). */
  products: PublicProduct[];
  /** The whole catalogue response, embedded in the page so products show without a second request. */
  catalog: PublicCatalogResponse;
}

/** Larger catalogues are not embedded (the app then asks for them as before). */
const SEED_MAX_CHARS = 700_000;

/** Adds the catalogue to the page as a JSON data block the storefront reads at start. */
function injectCatalogSeed(html: string, slug: string, catalog: PublicCatalogResponse): string {
  const json = JSON.stringify({ slug, catalog })
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  if (json.length > SEED_MAX_CHARS) return html;
  const block = `<script type="application/json" id="zv-catalog-seed">${json}</script>`;
  const at = html.search(/<\/body>/i);
  return at < 0 ? html + block : html.slice(0, at) + block + html.slice(at);
}

const storeCache = new Map<string, { data: LoadedStore | null; atMs: number }>();

async function loadStore(slug: string, origin: string, now: number): Promise<LoadedStore | null> {
  const key = `${origin}|${slug}`;
  const hit = storeCache.get(key);
  if (hit && now - hit.atMs < META_TTL_MS) return hit.data;
  let data: LoadedStore | null;
  try {
    const { catalog, published } = await loadPublicCatalog(slug);
    const products = catalog.products;
    const image = products.map((p) => p.imageUrl).find((u): u is string => typeof u === 'string' && u.startsWith('https://'));
    const meta = storeShareMeta(slug, published, origin, image ?? '');
    data = {
      meta,
      products,
      catalog,
      seo: { name: meta.title, description: meta.description, url: meta.url, imageUrl: meta.imageUrl, locale: meta.locale },
    };
  } catch {
    data = null; // not found / not published: plain shell
  }
  if (storeCache.size > 500) storeCache.clear();
  storeCache.set(key, { data, atMs: now });
  return data;
}

const sitemapsCache = new Map<string, { list: string[]; atMs: number }>();
const SITEMAPS_TTL_MS = 60 * 60_000;

/** The sitemap of every published shop (each checked against its store document). */
async function loadSitemaps(origin: string, now: number): Promise<string[]> {
  const hit = sitemapsCache.get(origin);
  if (hit && now - hit.atMs < SITEMAPS_TTL_MS) return hit.list;
  const sitemaps: string[] = [];
  try {
    const slugs = await db.collection('onlineStoreSlugs').limit(1000).get();
    const pairs = slugs.docs
      .map((d) => ({ slug: d.id, tenantId: d.get('tenantId') }))
      .filter((x): x is { slug: string; tenantId: string } => typeof x.tenantId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(x.tenantId));
    for (let i = 0; i < pairs.length; i += 100) {
      const part = pairs.slice(i, i + 100);
      const stores = await db.getAll(...part.map((x) => db.doc(`onlineStores/${x.tenantId}`)));
      stores.forEach((st, k) => {
        const x = part[k];
        if (x && st.get('enabled') === true && st.get('publication') === 'published' && st.get('slug') === x.slug) {
          sitemaps.push(`${origin}/s/${encodeURIComponent(x.slug)}/sitemap.xml`);
        }
      });
    }
  } catch {
    // Empty list this time; sitemaps come back on the next refresh.
  }
  if (sitemapsCache.size > 20) sitemapsCache.clear();
  sitemapsCache.set(origin, { list: sitemaps, atMs: now });
  return sitemaps;
}

export const publicStorePage = onRequest({ region: REGION, memory: '256MiB', concurrency: 80, maxInstances: 10 }, async (req, res) => {
  const now = Date.now();
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).set('Allow', 'GET, HEAD').send('');
    return;
  }
  const origin = linkOrigin(req.get('x-forwarded-host') ?? req.get('host'));
  if (req.path === '/robots.txt') {
    // Kept for direct calls; on Hosting /robots.txt is a static file (see SITEMAP_INDEX_PATH).
    res.status(200).set('Content-Type', 'text/plain; charset=utf-8').set('Cache-Control', 'public, max-age=3600, s-maxage=3600').send(robotsTxt(await loadSitemaps(origin, now)));
    return;
  }
  if (req.path === SITEMAP_INDEX_PATH) {
    res.status(200).set('Content-Type', 'application/xml; charset=utf-8').set('Cache-Control', 'public, max-age=3600, s-maxage=3600').send(sitemapIndexXml(await loadSitemaps(origin, now)));
    return;
  }
  const match = /^\/s\/([^/]+)(?:\/(manifest\.webmanifest|sitemap\.xml|feed\.xml))?\/?$/.exec(req.path);
  const file = match?.[2] ?? '';
  const slug = match ? normalizeSlug(decodeURIComponent(match[1] ?? '')) : '';
  const valid = !!slug && !slugProblem(slug);
  const rawProduct = typeof req.query.p === 'string' ? req.query.p : '';
  const productId = !file && PRODUCT_ID_RE.test(rawProduct) ? rawProduct : '';
  const store = valid ? await loadStore(slug, origin, now) : null;

  if (file) {
    if (!store) {
      res.status(404).set('Cache-Control', 'no-store').send('');
      return;
    }
    if (file === 'manifest.webmanifest') {
      res.status(200).set('Content-Type', 'application/manifest+json; charset=utf-8').set('Cache-Control', 'public, max-age=300').send(JSON.stringify(storeManifest(store.meta)));
    } else if (file === 'sitemap.xml') {
      res.status(200).set('Content-Type', 'application/xml; charset=utf-8').set('Cache-Control', 'public, max-age=3600, s-maxage=3600').send(sitemapXml(store.seo, store.products));
    } else {
      const jpeg = (p: { id: string; imageUrl: string | null }) => storeImageUrl(origin, slug, p.id, p.imageUrl ?? '', 1200, 'jpg');
      res.status(200).set('Content-Type', 'application/xml; charset=utf-8').set('Cache-Control', 'public, max-age=1800, s-maxage=1800').send(productFeedXml(store.seo, store.products, jpeg));
    }
    return;
  }

  const html = await loadShell(now);
  if (!store) {
    res.status(200).set('Content-Type', 'text/html; charset=utf-8').set('Cache-Control', 'no-cache').send(html);
    return;
  }
  // A shared product link (?p=id) previews that product, when it is on the store.
  const product = productId ? (store.products.find((p) => p.id === productId) ?? null) : null;
  const meta = product ? productShareMeta(store.meta, product) : store.meta;
  res
    .status(200)
    .set('Content-Type', 'text/html; charset=utf-8')
    // Short shared cache: store edits show up within minutes, the shell itself stays fresh.
    .set('Cache-Control', 'public, max-age=60, s-maxage=300')
    .send(injectCatalogSeed(injectSeo(injectShareMeta(html, meta), store.seo, store.products, product), slug, store.catalog));
});
