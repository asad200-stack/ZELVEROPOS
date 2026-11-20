import type { StoreEvent } from '@/domain/onlineStore';
import { api } from '@/services/functionsClient';

/** Events already sent in this browser session, so refreshes and repeat clicks aren't recounted. */
const sent = new Set<string>();
const KEY = 'sf-track';

function alreadySent(key: string): boolean {
  if (sent.has(key)) return true;
  sent.add(key);
  try {
    const stored = new Set<string>(JSON.parse(window.sessionStorage.getItem(KEY) ?? '[]') as string[]);
    if (stored.has(key)) return true;
    stored.add(key);
    window.sessionStorage.setItem(KEY, JSON.stringify([...stored].slice(-300)));
  } catch {
    // Storage blocked: the in-memory set still de-duplicates for this page.
  }
  return false;
}

/**
 * Fire-and-forget storefront analytics: one visit per session, one view/add per product per
 * session, one checkout start per session. Failures are ignored; shopping never waits on it.
 */
export function trackStoreEvent(slug: string, type: StoreEvent, productId?: string): void {
  if (!slug) return;
  if (alreadySent(`${slug}|${type}|${productId ?? ''}`)) return;
  void api.publicTrackEvent(productId ? { slug, type, productId } : { slug, type }).catch(() => undefined);
}
