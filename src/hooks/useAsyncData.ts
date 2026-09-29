import { useCallback, useEffect, useEffectEvent, useState } from 'react';

interface State<T> {
  key: string;
  data: T | null;
  error: unknown;
}

/** One-shot async loader keyed by `key` (re-runs when it changes). `key = null` disables it. */
export function useAsyncData<T>(key: string | null, load: () => Promise<T>) {
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
  const reload = useCallback(() => setToken((n) => n + 1), []);
  return { data: current?.data ?? null, error: current?.error ?? null, loading: fullKey !== null && !current, reload };
}
