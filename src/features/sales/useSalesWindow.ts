import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { acceptSalesResult, type SalesCursorKey } from '@/domain/salesSession';

interface SalesPageResult<T> {
  items: T[];
  cursor: SalesCursorKey | null;
  hasMore: boolean;
}

/**
 * One page of sales at a time. The rows on screen stay up until the next page arrives.
 * An older response cannot replace a newer filter or page.
 */
export function useSalesWindow<T>(key: string, fetchPage: (cursor: SalesCursorKey | null) => Promise<SalesPageResult<T>>) {
  const [reloadToken, setReloadToken] = useState(0);
  const [cursor, setCursor] = useState<SalesCursorKey | null>(null);
  const [back, setBack] = useState<(SalesCursorKey | null)[]>([]);
  const [seenKey, setSeenKey] = useState(key);
  if (seenKey !== key) {
    setSeenKey(key);
    setCursor(null);
    setBack([]);
  }
  const [items, setItems] = useState<T[]>([]);
  const [end, setEnd] = useState<SalesCursorKey | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [pending, setPending] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const requestId = useRef(0);
  const navLock = useRef(false);
  const startToken = cursor ? `${cursor.localDate}|${cursor.createdAtMs}|${cursor.id}` : '';
  const requestKey = `${key}|${startToken}|${reloadToken}`;
  const [pendingKey, setPendingKey] = useState('');
  if (pendingKey !== requestKey) {
    setPendingKey(requestKey);
    setPending(true);
  }
  const fetchNow = useEffectEvent(() => fetchPage(cursor));

  useEffect(() => {
    const id = requestId.current + 1;
    requestId.current = id;
    let cancelled = false;
    fetchNow().then(
      (page) => {
        if (cancelled || !acceptSalesResult(id, requestId.current)) return;
        setItems(page.items);
        setEnd(page.cursor);
        setHasMore(page.hasMore);
        setError(null);
        setPending(false);
        setReady(true);
        navLock.current = false;
      },
      (failure: unknown) => {
        console.error('[useSalesWindow]', failure);
        if (cancelled || !acceptSalesResult(id, requestId.current)) return;
        setError(failure);
        setPending(false);
        setReady(true);
        navLock.current = false;
      },
    );
    return () => {
      cancelled = true;
      navLock.current = false;
    };
  }, [key, startToken, reloadToken]);

  const next = useCallback(() => {
    if (navLock.current || pending || !hasMore || !end) return;
    navLock.current = true;
    setBack((stack) => [...stack, cursor]);
    setCursor(end);
  }, [pending, hasMore, end, cursor]);

  const previous = useCallback(() => {
    if (navLock.current || pending || back.length === 0) return;
    navLock.current = true;
    const prior = back[back.length - 1] ?? null;
    setBack((stack) => stack.slice(0, -1));
    setCursor(prior);
  }, [pending, back]);

  return {
    items,
    loading: !ready && items.length === 0,
    refreshing: pending && (ready || items.length > 0),
    hasMore,
    hasPrevious: back.length > 0,
    error,
    next,
    previous,
    reload: () => setReloadToken((n) => n + 1),
    patch: (fn: (current: T[]) => T[]) => setItems((current) => fn(current)),
  };
}
