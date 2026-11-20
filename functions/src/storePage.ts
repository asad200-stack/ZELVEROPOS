/**
 * Server-rendered storefront shell for share previews and installs.
 *
 *   GET /s/{slug}                        the app's HTML shell with the shop's own title,
 *                                        description, preview image and manifest link, so a
 *                                        link pasted in WhatsApp / Instagram / Facebook shows
 *                                        the shop instead of "ZELVERO POS".
 *   GET /s/{slug}/manifest.webmanifest   per-shop web app manifest ("Add to home screen").
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
import { REGION, STORE_EXTRA_HOSTS, STORE_SITE_ORIGIN } from './config.js';
import { activeProducts, resolvePublishedStore } from './onlineStore.js';
import { injectShareMeta, normalizeSlug, slugProblem, storeManifest, storeShareMeta } from './shared/onlineStore.js';

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
const metaCache = new Map<string, { meta: ReturnType<typeof storeShareMeta> | null; atMs: number }>();

function siteOrigin(): string {
  const raw = (STORE_SITE_ORIGIN.value() || '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(raw) ? raw : 'https://zelvoropos.web.app';
}

async function loadShell(now: number): Promise<string> {
  if (shell && now - shell.atMs < SHELL_TTL_MS) return shell.html;
  try {
    const res = await fetch(`${siteOrigin()}/index.html`, { signal: AbortSignal.timeout(4000) });
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

async function loadMeta(slug: string, origin: string, now: number) {
  const key = `${origin}|${slug}`;
  const hit = metaCache.get(key);
  if (hit && now - hit.atMs < META_TTL_MS) return hit.meta;
  let meta: ReturnType<typeof storeShareMeta> | null;
  try {
    const { tenantId, config, published } = await resolvePublishedStore(slug);
    const ids = config.visibleProductIds.slice(0, 12);
    const products = await activeProducts(tenantId, ids);
    const image = ids.map((id) => products.get(id)?.imageUrl).find((u): u is string => typeof u === 'string' && u.startsWith('https://'));
    meta = storeShareMeta(slug, published, origin, image ?? '');
  } catch {
    meta = null; // not found / not published: plain shell
  }
  if (metaCache.size > 1000) metaCache.clear();
  metaCache.set(key, { meta, atMs: now });
  return meta;
}

export const publicStorePage = onRequest({ region: REGION, memory: '256MiB', concurrency: 80, maxInstances: 10 }, async (req, res) => {
  const now = Date.now();
  const match = /^\/s\/([^/]+)(\/manifest\.webmanifest)?\/?$/.exec(req.path);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).set('Allow', 'GET, HEAD').send('');
    return;
  }
  const slug = match ? normalizeSlug(decodeURIComponent(match[1] ?? '')) : '';
  const valid = !!slug && !slugProblem(slug);
  const origin = linkOrigin(req.get('x-forwarded-host') ?? req.get('host'));
  const meta = valid ? await loadMeta(slug, origin, now) : null;

  if (match?.[2]) {
    if (!meta) {
      res.status(404).set('Cache-Control', 'no-store').json({});
      return;
    }
    res
      .status(200)
      .set('Content-Type', 'application/manifest+json; charset=utf-8')
      .set('Cache-Control', 'public, max-age=300')
      .send(JSON.stringify(storeManifest(meta)));
    return;
  }

  const html = await loadShell(now);
  res
    .status(200)
    .set('Content-Type', 'text/html; charset=utf-8')
    // Short shared cache: store edits show up within minutes, the shell itself stays fresh.
    .set('Cache-Control', meta ? 'public, max-age=60, s-maxage=300' : 'no-cache')
    .send(meta ? injectShareMeta(html, meta) : html);
});
