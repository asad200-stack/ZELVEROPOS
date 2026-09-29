import { useCallback, useRef, useState } from 'react';
import { useErrorHandler } from '@/contexts/feedback';

/**
 * Wraps an async action with a synchronous lock so double clicks / repeated Enter presses can never
 * start the same operation twice. Errors are shown as toasts unless `rethrow` is set.
 */
export function useAsyncAction(context: string) {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const handleError = useErrorHandler(context);

  const run = useCallback(
    async <T>(action: () => Promise<T>): Promise<T | undefined> => {
      if (lock.current) return undefined;
      lock.current = true;
      setBusy(true);
      try {
        return await action();
      } catch (e) {
        handleError(e);
        return undefined;
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
    [handleError],
  );

  return { busy, run };
}
