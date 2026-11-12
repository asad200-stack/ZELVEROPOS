/**
 * Live server check for the internal-only Zelvero AI rollout.
 * The panel mounts only after `aiCopilotAccess` says yes; any error (customer store, missing
 * function, offline) keeps it hidden. Re-checked every few minutes so revocation takes effect.
 */
import { useEffect, useState } from 'react';

export type AiServerAccess = 'checking' | 'allowed' | 'denied';

export const AI_ACCESS_RECHECK_MS = 5 * 60_000;

const cache = new Map<string, { at: number; value: Promise<boolean> }>();

export function checkAiServerAccess(uid: string, ask: () => Promise<unknown>, now: () => number = Date.now): Promise<boolean> {
  const hit = cache.get(uid);
  if (hit && now() - hit.at < AI_ACCESS_RECHECK_MS) return hit.value;
  const value = ask().then(
    (result) => Boolean(result && typeof result === 'object' && (result as { allowed?: unknown }).allowed === true),
    () => false,
  );
  cache.set(uid, { at: now(), value });
  return value;
}

export function forgetAiServerAccess(): void {
  cache.clear();
}

export function useAiServerAccess(uid: string | null, enabled: boolean, ask: () => Promise<unknown>): AiServerAccess {
  const [state, setState] = useState<{ key: string | null; access: AiServerAccess }>({ key: null, access: 'checking' });
  const key = enabled && uid ? uid : null;
  useEffect(() => {
    if (!key) return;
    let live = true;
    const run = () =>
      checkAiServerAccess(key, ask).then((ok) => {
        if (live) setState({ key, access: ok ? 'allowed' : 'denied' });
      });
    void run();
    const timer = setInterval(() => void run(), AI_ACCESS_RECHECK_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
    // `ask` is a stable module function; re-run only when the principal changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!key) return 'denied';
  return state.key === key ? state.access : 'checking';
}
