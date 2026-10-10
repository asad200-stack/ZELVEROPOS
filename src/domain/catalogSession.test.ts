import { describe, expect, it } from 'vitest';
import type { Product } from '@/types/models';
import { applyLoadedPage, catalogLoadProblem, mergeKnown } from './catalogSession';

describe('catalog session', () => {
  it('drops a page that belongs to a search the cashier already left', () => {
    const current = { key: 'phones', items: [{ id: 'p1' }], cursor: null, hasMore: true, error: null, loadingMore: true };
    const stale = { items: [{ id: 'old' }], cursor: null, hasMore: false };
    expect(applyLoadedPage(current, 'cables', stale, true)).toBe(current);
    expect(applyLoadedPage(current, 'phones', { items: [{ id: 'p2' }], cursor: null, hasMore: false }, true)?.items.map((item) => item.id)).toEqual(['p1', 'p2']);
  });

  it('keeps a cart product after it leaves the visible page', () => {
    const held = { id: 'p1', name: 'Held' } as Product;
    const visible = { id: 'p2', name: 'Visible' } as Product;
    const known = mergeKnown(new Map([[held.id, held]]), [visible]);
    expect(known.get('p1')?.name).toBe('Held');
    expect(known.get('p2')?.name).toBe('Visible');
    expect(mergeKnown(known, [])).toBe(known);
  });

  it('says when an uncached page cannot be read offline', () => {
    expect(catalogLoadProblem(false, new Error('unavailable'))).toBe('offline');
    expect(catalogLoadProblem(true, new Error('permission'))).toBe('failed');
    expect(catalogLoadProblem(false, null)).toBeNull();
  });
});
