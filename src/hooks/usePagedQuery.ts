import { useCallback, useEffect, useEffectEvent, useState } from 'react';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import type { Page } from '@/services/salesService';

interface State<T> {
  key: string;
  items: T[];
  cursor: QueryDocumentSnapshot | null;
  hasMore: boolean;
  error: unknown;
  loadingMore: boolean;
}

/**
 * Cursor-paginated one-shot query (no live listener → bounded reads). Re-runs when `key` changes.
 */
export function usePagedQuery<T>(key: string, fetchPage: (cursor: QueryDocumentSnapshot | null) => Promise<Page<T>>) {
  const [reloadToken, setReloadToken] = useState(0);
  const fullKey = `${key}#${reloadToken}`;
  const [state, setState] = useState<State<T> | null>(null);
  const fetchFirst = useEffectEvent(() => fetchPage(null));

  useEffect(() => {
    let cancelled = false;
    fetchFirst().then(
      (page) => {
        if (!cancelled) setState({ key: fullKey, items: page.items, cursor: page.cursor, hasMore: page.hasMore, error: null, loadingMore: false });
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

  const loadMore = useCallback(async () => {
    if (!current || !current.hasMore || current.loadingMore) return;
    setState({ ...current, loadingMore: true });
    try {
      const page = await fetchPage(current.cursor);
      setState((s) =>
        s && s.key === current.key
          ? { ...s, items: [...s.items, ...page.items], cursor: page.cursor, hasMore: page.hasMore, loadingMore: false }
          : s,
      );
    } catch (error) {
      console.error('[usePagedQuery] loadMore', error);
      setState((s) => (s && s.key === current.key ? { ...s, loadingMore: false, error } : s));
    }
  }, [current, fetchPage]);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  return {
    items: current?.items ?? [],
    loading: !current,
    loadingMore: current?.loadingMore ?? false,
    hasMore: current?.hasMore ?? false,
    error: current?.error ?? null,
    loadMore,
    reload,
    /** Replace an item in place after a mutation (e.g. a return updated a sale). */
    patch: (fn: (items: T[]) => T[]) => setState((s) => (s ? { ...s, items: fn(s.items) } : s)),
  };
}
