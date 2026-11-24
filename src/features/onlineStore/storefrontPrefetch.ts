/**
 * The catalogue request boot.js starts for /s/<slug> before the app's scripts have loaded.
 * Taken once: a later reload of the same page asks the server again.
 */
export function takePrefetchedCatalog<T>(slug: string): Promise<T | null> | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { __zvCatalog?: { slug: string; promise: Promise<T | null> } };
  const early = w.__zvCatalog;
  if (!early || early.slug !== slug) return null;
  delete w.__zvCatalog;
  return early.promise;
}

/**
 * The catalogue the shop page's HTML already carries (see functions/src/storePage.ts), at most a
 * few minutes old: shown at once on a first visit while the fresh one loads.
 */
export function readSeedCatalog<T extends { store: { slug: string }; products: unknown[] }>(slug: string): T | null {
  if (typeof document === 'undefined' || !slug) return null;
  try {
    const el = document.getElementById('zv-catalog-seed');
    if (!el?.textContent) return null;
    const seed = JSON.parse(el.textContent) as { slug?: unknown; catalog?: T };
    const c = seed.catalog;
    if (seed.slug !== slug || !c || typeof c !== 'object' || c.store?.slug !== slug || !Array.isArray(c.products)) return null;
    return c;
  } catch {
    return null;
  }
}
