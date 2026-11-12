export interface LoadedPage<T, C = unknown> {
  items: T[];
  cursor: C | null;
  hasMore: boolean;
}

export interface HeldPage<T, C = unknown> {
  key: string;
  items: T[];
  cursor: C | null;
  hasMore: boolean;
  error: unknown;
  loadingMore: boolean;
}

/** A response for an older search or category is ignored, so pages never mix. */
export function applyLoadedPage<T, C>(state: HeldPage<T, C> | null, requestKey: string, page: LoadedPage<T, C>, append: boolean): HeldPage<T, C> | null {
  if (append && (!state || state.key !== requestKey)) return state;
  const items = append && state ? [...state.items, ...page.items] : page.items;
  return { key: requestKey, items, cursor: page.cursor, hasMore: page.hasMore, error: null, loadingMore: false };
}

/** Products the cart has already touched stay priced after the visible page changes. */
export function mergeKnown<T extends { id: string }>(known: Map<string, T>, incoming: T[]): Map<string, T> {
  if (incoming.length === 0) return known;
  const next = new Map(known);
  for (const item of incoming) next.set(item.id, item);
  return next;
}

/**
 * A one-shot page is available offline only when this device has cached that exact query.
 * The offline sale queue does not depend on the catalog page.
 */
export function catalogLoadProblem(online: boolean, error: unknown): 'offline' | 'failed' | null {
  if (!error) return null;
  return online ? 'failed' : 'offline';
}

export type CatalogViewMode = 'problem' | 'loading' | 'empty' | 'ready';

/**
 * POS catalog stage. "No products" only after the active query has settled.
 * keepPrevious can hold a prior empty page while a clearer search/category reloads —
 * that must look like loading, not a false empty flash.
 */
export function catalogViewMode(opts: {
  hasProblem: boolean;
  loading: boolean;
  refreshing: boolean;
  /** True when the search box is ahead of the deferred query key. */
  pendingInput: boolean;
  itemCount: number;
}): CatalogViewMode {
  if (opts.hasProblem) return 'problem';
  const unsettled = opts.loading || opts.refreshing || opts.pendingInput;
  if (opts.itemCount > 0) return 'ready';
  if (unsettled) return 'loading';
  return 'empty';
}
