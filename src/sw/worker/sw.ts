/// <reference lib="webworker" />
import { cachesToDelete, routeRequest, SHELL_CACHE_PREFIX, shellCacheName } from '../policy';

/**
 * App-shell service worker (built by tools/serviceWorkerPlugin.ts into dist/sw.js). It makes the
 * previously loaded app start with zero connectivity. It is NOT a data layer: it caches only the
 * build files listed at build time, writes nothing at runtime, and never sees Firebase traffic.
 */

declare const self: ServiceWorkerGlobalScope;
declare const __SW_VERSION__: string;
declare const __SW_PRECACHE__: string[];
declare const __SW_ISOLATED__: boolean;

const VERSION = __SW_VERSION__;
const CACHE = shellCacheName(VERSION);
const PRECACHE = new Set(__SW_PRECACHE__);
const ISOLATED = __SW_ISOLATED__ === true;
const META_CACHE = ISOLATED ? `zelvero-sw-meta-${VERSION}` : 'zelvero-sw-meta';
/** Isolated trees fall back to their own index. The customer worker keeps the root shell. */
const SHELL_INDEX = ISOLATED ? ([...PRECACHE].find((url) => url.endsWith('/index.html')) ?? '/index.html') : '/index.html';
const META_KEY = '/__sw-state';
/** On a very slow connection the cached shell is served instead of waiting forever. */
const NAVIGATION_TIMEOUT_MS = 4000;

interface SwState {
  current: string;
  previous: string | null;
}

async function readState(): Promise<SwState | null> {
  const saved = await (await caches.open(META_CACHE)).match(META_KEY);
  return saved ? ((await saved.json().catch(() => null)) as SwState | null) : null;
}

self.addEventListener('install', (event) => {
  // All-or-nothing: if any file fails the install fails and the current version keeps serving.
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        await cache.addAll([...PRECACHE].map((url) => new Request(url, { cache: 'reload' })));
      } catch (error) {
        if ((await readState())?.current !== CACHE) await caches.delete(CACHE);
        throw error;
      }
    })(),
  );
  // No skipWaiting here: an update only takes over when the user chooses to refresh.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const meta = await caches.open(META_CACHE);
      const saved = await readState();
      const previous = saved && saved.current !== CACHE ? saved.current : (saved?.previous ?? null);
      const names = ISOLATED ? (previous && previous !== CACHE ? [previous] : []) : cachesToDelete(await caches.keys(), CACHE, previous);
      for (const name of names) await caches.delete(name);
      await meta.put(META_KEY, new Response(JSON.stringify({ current: CACHE, previous } satisfies SwState)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  const type = (event.data as { type?: string } | null)?.type;
  if (type === 'SKIP_WAITING') void self.skipWaiting();
  if (type === 'GET_VERSION') event.ports[0]?.postMessage({ version: VERSION, files: PRECACHE.size });
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const route = routeRequest({ url: request.url, method: request.method, mode: request.mode }, self.location.origin, PRECACHE);
  if (route === 'shell') event.respondWith(shell(request));
  else if (route === 'asset') event.respondWith(asset(request));
});

// Servers send `Vary: Origin`; module scripts carry an Origin header the install requests did not.
// The caches hold only immutable build files, so the stored copy is valid for any request headers.
const MATCH: CacheQueryOptions = { ignoreVary: true };

async function fromShellCaches(request: Request | string): Promise<Response | undefined> {
  const hit = await (await caches.open(CACHE)).match(request, MATCH);
  if (hit || ISOLATED) return hit;
  for (const name of await caches.keys()) {
    if (name === CACHE || !name.startsWith(SHELL_CACHE_PREFIX)) continue;
    const old = await (await caches.open(name)).match(request, MATCH);
    if (old) return old;
  }
  return undefined;
}

/** Online: the newest index.html (network). Offline: the cached one. Never cached at runtime. */
async function shell(request: Request): Promise<Response> {
  const network = fetch(request);
  network.catch(() => undefined);
  try {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), NAVIGATION_TIMEOUT_MS));
    const response = await Promise.race([network, timeout]);
    if (response && response.status < 500) return response;
  } catch {
    /* offline: fall back to the cached shell */
  }
  const cached = await fromShellCaches(SHELL_INDEX);
  // Never loaded before: no shell to offer, so the browser shows its normal offline page.
  return cached ?? network;
}

async function asset(request: Request): Promise<Response> {
  return (await fromShellCaches(request)) ?? fetch(request);
}
