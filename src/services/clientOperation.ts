import { isTransportFailure } from '@/offline/classify';

/** Immutable id reused on every retry of one cashier action. Matches server `idField`. */
export function newClientOperationId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid.replace(/-/g, '');
  return `op${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/** Resends the same payload after a lost response. The caller must keep `clientOperationId` stable. */
export async function retryOnTransport<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      if (!isTransportFailure(error)) throw error;
    }
  }
  throw last;
}
