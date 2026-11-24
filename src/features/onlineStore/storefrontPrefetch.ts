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
