/**
 * Request policy of the app-shell service worker (pure, unit-tested). The worker only ever serves
 * the build output it precached at install time; it never stores anything at runtime.
 *
 * - `shell`:   same-origin page navigation → newest index.html from the network, cached one offline.
 * - `asset`:   same-origin build file (/assets/*, icons, manifest) → cache first, then network.
 * - `network`: everything else is not intercepted at all: every cross-origin request (Firestore,
 *              Cloud Functions, Auth, Storage, googleapis, reCAPTCHA, emulators), every non-GET,
 *              Firebase Hosting's reserved `/__/` paths and unknown same-origin URLs.
 */

export const SHELL_CACHE_PREFIX = 'zelvero-shell-';
export const shellCacheName = (version: string) => `${SHELL_CACHE_PREFIX}${version}`;

export type SwRoute = 'shell' | 'asset' | 'network';

export interface SwRequest {
  url: string;
  method: string;
  mode: string;
}

/** Client-side routes have no file extension (`/pos`, `/sales/abc`); files like `/report.csv` do. */
function isAppRoute(pathname: string): boolean {
  const last = pathname.split('/').pop() ?? '';
  return !last.includes('.') || last === 'index.html';
}

export function routeRequest(req: SwRequest, origin: string, precached: ReadonlySet<string>): SwRoute {
  if (req.method !== 'GET') return 'network';
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return 'network';
  }
  if (url.origin !== origin) return 'network';
  if (url.pathname.startsWith('/__/')) return 'network';
  if (req.mode === 'navigate') return isAppRoute(url.pathname) ? 'shell' : 'network';
  if (url.search) return 'network';
  if (precached.has(url.pathname) || url.pathname.startsWith('/assets/') || url.pathname.includes('/assets/')) return 'asset';
  return 'network';
}

/**
 * Shell caches to remove on activation: everything except the new version and the one it replaces.
 * The previous one is kept until the next update so tabs still running the old bundle can load
 * their lazy chunks even if the deployment already removed them from the server.
 */
export function cachesToDelete(keys: readonly string[], current: string, previous: string | null): string[] {
  return keys.filter((k) => k.startsWith(SHELL_CACHE_PREFIX) && k !== current && k !== previous);
}

/** Build files that go into the precache: the complete app shell, never source maps or the worker itself. */
export function precacheList(files: readonly string[], base = ''): string[] {
  const prefix = base.replace(/\/+$/, '');
  return files
    .map((f) => `${prefix}/${f.replace(/\\/g, '/').replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/'))
    .filter((f) => !f.endsWith('/sw.js') && !f.endsWith('.map') && !f.split('/').some((part) => part.startsWith('.')))
    // The on-device AI runtime (~40 MB) is downloaded only by the screens that use it, never
    // pushed to every till by the offline shell.
    .filter((f) => !f.endsWith('.wasm') && !/\/ort-wasm[^/]*\.mjs$/.test(f))
    .sort();
}
