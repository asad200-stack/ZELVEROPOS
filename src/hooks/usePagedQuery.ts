import { useCallback, useEffect, useEffectEvent, useState } from 'react';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { applyLoadedPage, type HeldPage } from '@/domain/catalogSession';
import type { Page } from '@/services/salesService';

type PagedState<T> = HeldPage<T, QueryDocumentSnapshot>;

/**
 * Cursor-paginated one-shot query (no live listener → bounded reads). Re-runs when `key` changes.
 */
export function usePagedQuery<T>(
  key: string,
  fetchPage: (cursor: QueryDocumentSnapshot | null) => Promise<Page<T>>,
  options?: { keepPrevious?: boolean },
) {
  const keepPrevious = options?.keepPrevious ?? false;
  const [reloadToken, setReloadToken] = useState(0);
  const fullKey = `${key}#${reloadToken}`;
  const [state, setState] = useState<PagedState<T> | null>(null);
  const fetchFirst = useEffectEvent(() => fetchPage(null));

  useEffect(() => {
    let cancelled = false;
    fetchFirst().then(
      (page) => {
        if (!cancelled) setState(applyLoadedPage(null, fullKey, page, false));
      },
      (error: unknown) => {
        console.error('[usePagedQuery]', error);
        if (!cancelled) setState({ key: fullKey, items: [], cursor: null, hasMore: false, error, loadingMore: false });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fullKey]);

  const current = state && state.key === fullKey ? state : null;
  const visible = current ?? (keepPrevious ? state : null);

  const loadMore = useCallback(async () => {
    if (!current || !current.hasMore || current.loadingMore) return;
    setState({ ...current, loadingMore: true });
    try {
      const page = await fetchPage(current.cursor);
      setState((s) => applyLoadedPage(s, current.key, page, true));
    } catch (error) {
      console.error('[usePagedQuery] loadMore', error);
      setState((s) => (s && s.key === current.key ? { ...s, loadingMore: false, error } : s));
    }
  }, [current, fetchPage]);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  return {
    items: visible?.items ?? [],
    loading: !visible,
    refreshing: !current && visible !== null,
    loadingMore: current?.loadingMore ?? false,
    hasMore: current?.hasMore ?? false,
    error: current?.error ?? null,
    loadMore,
    reload,
    /** Replace an item in place after a mutation (e.g. a return updated a sale). */
    patch: (fn: (items: T[]) => T[]) => setState((s) => (s ? { ...s, items: fn(s.items) } : s)),
  };
}
