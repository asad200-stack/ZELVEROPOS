import { describe, expect, it } from 'vitest';
import type { Product } from '@/types/models';
import { applyLoadedPage, catalogLoadProblem, catalogViewMode, mergeKnown } from './catalogSession';

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

  it('shows stock 19 after a post-checkout catalog reload replaces stock 20', () => {
    const cable20 = { id: 'cable', name: 'USB cable', stock: 20 } as Product;
    const cable19 = { id: 'cable', name: 'USB cable', stock: 19 } as Product;
    const before = applyLoadedPage(null, 'tenant|| |0', { items: [cable20], cursor: null, hasMore: false }, false);
    expect(before?.items[0]?.stock).toBe(20);
    // keepPrevious holds the prior page while the revision key advances (append into a new key is ignored).
    expect(applyLoadedPage(before, 'tenant|| |1', { items: [cable19], cursor: null, hasMore: false }, true)).toBe(before);
    const after = applyLoadedPage(before, 'tenant|| |1', { items: [cable19], cursor: null, hasMore: false }, false);
    expect(after?.items[0]?.stock).toBe(19);
    expect(after?.key).toBe('tenant|| |1');
  });

  it('does not flash empty while clearing a search that previously matched products', () => {
    // keepPrevious still holds the prior USB hit while the empty-search key reloads.
    expect(
      catalogViewMode({ hasProblem: false, loading: false, refreshing: true, pendingInput: false, itemCount: 1 }),
    ).toBe('ready');
    // Search box already cleared; deferred query key has not caught up yet.
    expect(
      catalogViewMode({ hasProblem: false, loading: false, refreshing: false, pendingInput: true, itemCount: 1 }),
    ).toBe('ready');
  });

  it('shows empty only after a settled search returns zero products', () => {
    expect(
      catalogViewMode({ hasProblem: false, loading: false, refreshing: false, pendingInput: false, itemCount: 0 }),
    ).toBe('empty');
  });

  it('treats a prior empty page as loading while the next search or category settles', () => {
    // Clearing after "zzzz" left keepPrevious with zero items — must not stay on empty.
    expect(
      catalogViewMode({ hasProblem: false, loading: false, refreshing: true, pendingInput: false, itemCount: 0 }),
    ).toBe('loading');
    expect(
      catalogViewMode({ hasProblem: false, loading: false, refreshing: false, pendingInput: true, itemCount: 0 }),
    ).toBe('loading');
    expect(
      catalogViewMode({ hasProblem: false, loading: true, refreshing: false, pendingInput: false, itemCount: 0 }),
    ).toBe('loading');
  });
});
