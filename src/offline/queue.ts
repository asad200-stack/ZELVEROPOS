import { useSyncExternalStore } from 'react';
import { posApi } from '@/services/functionsClient';
import { newSaleOperation, resolveOperation, retryOperation } from './operations';
import { openOperationStore, type OperationStore } from './store';
import { createSyncEngine, type SyncEngine, type SyncIdentity } from './syncEngine';
import { visibleQueue } from './summary';
import type { OfflineOperation } from './types';

/**
 * App-wide offline sale queue: IndexedDB-backed, synced through `posCheckout`, coordinated across
 * tabs with an expiring IndexedDB lease (one tab syncs at a time) and a BroadcastChannel (all tabs
 * refresh their view when any tab changes the queue).
 */

const CHANNEL = 'zelvero-offline';
const POLL_MS = 20_000;

export interface QueueState {
  ready: boolean;
  /** IndexedDB could not be opened (private mode, disabled storage): offline selling is unavailable. */
  unavailable: boolean;
  /** The signed-in user's own operations (see `visibleQueue`). */
  operations: OfflineOperation[];
  /** Open operations of other users of the same store on this device (count only). */
  othersInStore: number;
  syncing: boolean;
}

let state: QueueState = { ready: false, unavailable: false, operations: [], othersInStore: 0, syncing: false };
const listeners = new Set<() => void>();
function emit(patch: Partial<QueueState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

let storePromise: Promise<OperationStore> | null = null;
function store(): Promise<OperationStore> {
  storePromise ??= openOperationStore().catch((e: unknown) => {
    storePromise = null;
    emit({ ready: true, unavailable: true });
    throw e;
  });
  return storePromise;
}

let identity: SyncIdentity | null = null;
let engine: SyncEngine | null = null;
let channel: BroadcastChannel | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

async function refresh() {
  const who = identity;
  if (!who) return;
  const { own, othersInStore } = visibleQueue(await (await store()).list(), who);
  if (identity !== who) return;
  emit({ ready: true, unavailable: false, operations: own, othersInStore });
}

function broadcast() {
  channel?.postMessage('changed');
}

const TAB_ID = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export async function syncOfflineQueue() {
  if (!engine) return;
  emit({ syncing: true });
  try {
    await engine.syncNow();
  } catch (e) {
    console.error('[offline] sync pass failed', e);
  } finally {
    emit({ syncing: false });
    await refresh().catch(() => undefined);
  }
}

/** Starts syncing for the signed-in user (call on sign-in / tenant change; returns a stop function). */
export function startOfflineQueue(who: SyncIdentity): () => void {
  identity = who;
  void store()
    .then((s) => {
      engine = createSyncEngine({
        store: s,
        send: (payload) => posApi.checkout(payload),
        identity: () => identity,
        owner: TAB_ID,
        isOnline: () => navigator.onLine,
        onChange: () => {
          broadcast();
          void refresh();
        },
      });
      return refresh();
    })
    .then(() => syncOfflineQueue())
    .catch((e: unknown) => console.error('[offline] queue unavailable', e));

  const onOnline = () => void syncOfflineQueue();
  window.addEventListener('online', onOnline);
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = () => void refresh();
  }
  timer = setInterval(() => void syncOfflineQueue(), POLL_MS);

  return () => {
    window.removeEventListener('online', onOnline);
    channel?.close();
    channel = null;
    if (timer) clearInterval(timer);
    timer = null;
    identity = null;
    engine = null;
    emit({ operations: [], othersInStore: 0, syncing: false });
  };
}

/** Durably stores a completed offline sale. Resolves only once IndexedDB has committed it. */
export async function enqueueSale(input: Omit<Parameters<typeof newSaleOperation>[0], 'now'>): Promise<OfflineOperation> {
  const s = await store();
  const existing = await s.get(input.payload.saleId);
  if (existing) return existing;
  const op = newSaleOperation({ ...input, now: Date.now() });
  await s.add(op);
  void navigator.storage?.persist?.().catch(() => undefined);
  broadcast();
  await refresh();
  void syncOfflineQueue();
  return op;
}

export async function retryQueued(id: string) {
  await retryOperation(await store(), id, Date.now());
  broadcast();
  await syncOfflineQueue();
}

export async function dismissQueued(id: string, note: string) {
  await resolveOperation(await store(), id, 'dismissed', note, Date.now());
  broadcast();
  await refresh();
}

/* ------------------------------------------------ reopen in the POS cart */

let reopenRequest: OfflineOperation | null = null;

/** Marks the failed sale as handled and hands its lines to the POS, which opens them in a new cart. */
export async function reopenQueued(id: string): Promise<OfflineOperation | null> {
  const op = await resolveOperation(await store(), id, 'reopened', '', Date.now());
  broadcast();
  await refresh();
  reopenRequest = op;
  return op;
}

export function takeReopenRequest(): OfflineOperation | null {
  const op = reopenRequest;
  reopenRequest = null;
  return op;
}

/* ------------------------------------------------------------------ view */

export function useOfflineQueue(): QueueState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

export { cashHeldOffline, summarize, visibleQueue } from './summary';
