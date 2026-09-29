import { useSyncExternalStore } from 'react';

/** Tracks offline writes that are waiting for server acknowledgement (shown in the header). */
interface SyncState {
  pending: number;
  failed: { label: string; message: string; at: number }[];
}

let state: SyncState = { pending: 0, failed: [] };
const listeners = new Set<() => void>();

function emit(next: SyncState) {
  state = next;
  listeners.forEach((l) => l());
}

export function trackPendingWrite(promise: Promise<unknown>, label: string): void {
  emit({ ...state, pending: state.pending + 1 });
  promise
    .then(() => emit({ ...state, pending: Math.max(0, state.pending - 1) }))
    .catch((e: unknown) => {
      console.error(`[sync] offline write "${label}" was rejected`, e);
      emit({
        pending: Math.max(0, state.pending - 1),
        failed: [...state.failed.slice(-9), { label, message: String((e as Error)?.message ?? e), at: Date.now() }],
      });
    });
}

export function clearSyncFailures(): void {
  emit({ ...state, failed: [] });
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}
