/* CATCH POS service worker — versioned cache bust + update notifications. */
(function () {
  const params = new URL(self.location.href).searchParams;
  const BUILD_VERSION = String(params.get('v') || '0');
  const CACHE_PREFIX = 'catch-pos-cache-v';
  const CACHE_NAME = `${CACHE_PREFIX}${BUILD_VERSION}`;

  self.addEventListener('install', (event) => {
    self.skipWaiting();
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      clients.forEach((client) => {
        try {
          client.postMessage({ type: 'APP_UPDATE_READY', buildVersion: BUILD_VERSION });
        } catch (_) {}
      });
      await self.clients.claim();
    })());
  });

  self.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data && data.type === 'SKIP_WAITING') {
      self.skipWaiting();
    }
  });

  // Network-first for app shell assets so users always pick up new builds.
  self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;
    const isAppAsset = /\.(js|css|html)$/.test(url.pathname) || url.pathname === '/';
    if (!isAppAsset) return;

    event.respondWith((async () => {
      try {
        const networkResponse = await fetch(event.request, { cache: 'no-store' });
        if (networkResponse && networkResponse.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(event.request, networkResponse.clone()).catch(() => {});
        }
        return networkResponse;
      } catch (_) {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        throw _;
      }
    })());
  });
})();
