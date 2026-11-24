import { useCallback, useEffect, useEffectEvent, useState } from 'react';
import { readQueryCache, writeQueryCache } from './queryCache';

interface State<T> {
  key: string;
  data: T | null;
  error: unknown;
}

/**
 * One-shot async loader keyed by `key` (re-runs when it changes). `key = null` disables it.
 * With `keep`, going back to the page shows the last result at once while the fresh one loads
 * (only for read-only views: never for data a form copies into a draft).
 */
export function useAsyncData<T>(key: string | null, load: () => Promise<T>, options?: { keep?: boolean }) {
  const keep = options?.keep ?? false;
  const [token, setToken] = useState(0);
  const fullKey = key === null ? null : `${key}#${token}`;
  const [state, setState] = useState<State<T> | null>(null);
  const run = useEffectEvent(load);

  useEffect(() => {
    if (fullKey === null) return;
    let cancelled = false;
    run().then(
      (data) => !cancelled && setState({ key: fullKey, data, error: null }),
      (error: unknown) => {
        console.error('[useAsyncData]', error);
        if (!cancelled) setState({ key: fullKey, data: null, error });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fullKey]);

  const current = state && state.key === fullKey ? state : null;
  const cacheKey = key === null ? null : `async:${key}`;
  useEffect(() => {
    if (keep && cacheKey !== null && current && current.error === null) writeQueryCache(cacheKey, current.data);
  }, [keep, cacheKey, current]);
  const remembered = keep && cacheKey !== null && !current ? readQueryCache<T>(cacheKey) : undefined;
  const reload = useCallback(() => setToken((n) => n + 1), []);
  return {
    data: current?.data ?? remembered ?? null,
    error: current?.error ?? null,
    loading: fullKey !== null && !current && remembered === undefined,
    reload,
  };
}
