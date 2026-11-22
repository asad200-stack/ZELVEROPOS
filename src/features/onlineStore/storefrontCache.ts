import type { PublicProduct, PublicStore } from '@/domain/onlineStore';

export interface CatalogSnapshot {
  store: PublicStore;
  products: PublicProduct[];
  bestSellerIds?: string[];
}

// Bumped whenever the catalogue shape changes, so older snapshots are never rendered.
const VERSION = 2;
/** Older snapshots are ignored so a long-closed tab never shows a very stale catalogue. */
const MAX_AGE_MS = 7 * 86_400_000;
const keyOf = (slug: string) => `sf-cat-${slug}`;

/**
 * Last catalogue this browser saw for the shop, shown instantly on the next visit while the
 * fresh one loads. Prices and stock are always re-checked by the server when an order is placed.
 */
export function readCachedCatalog(slug: string, now = Date.now()): CatalogSnapshot | null {
  if (!slug) return null;
  try {
    const raw = window.localStorage.getItem(keyOf(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { v?: number; at?: number; payload?: CatalogSnapshot };
    const p = parsed.payload;
    if (parsed.v !== VERSION || typeof parsed.at !== 'number' || now - parsed.at > MAX_AGE_MS) return null;
    if (!p || !p.store || p.store.slug !== slug || !Array.isArray(p.products)) return null;
    return p;
  } catch {
    return null;
  }
}

export function writeCachedCatalog(slug: string, payload: CatalogSnapshot, now = Date.now()): void {
  if (!slug) return;
  try {
    window.localStorage.setItem(keyOf(slug), JSON.stringify({ v: VERSION, at: now, payload }));
  } catch {
    // Storage full or blocked: the next visit just loads normally.
  }
}

export function forgetCachedCatalog(slug: string): void {
  try {
    window.localStorage.removeItem(keyOf(slug));
  } catch {
    // ignore
  }
}
