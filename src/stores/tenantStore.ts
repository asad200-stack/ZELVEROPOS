import { useMemo, useSyncExternalStore } from 'react';
import { onSnapshot } from 'firebase/firestore';
import { DEFAULT_SETTINGS, paths, toCashbox, toSettings } from '@/services/db';
import type { CashboxSummary, StoreSettings } from '@/types/models';

/**
 * Realtime listeners only for documents that are one row per store: settings, the cash drawer,
 * and the category name list. Products, customers and suppliers are paged in catalogQuery.ts.
 * A listener on the whole product collection was measured at 11.2s for 10,000 documents.
 */
export interface ResourceState<T> {
  status: 'loading' | 'ready' | 'error';
  data: T;
  error: unknown;
  fromCache: boolean;
}

interface ResourceDef<T> {
  initial: T;
  start: (tenantId: string, emit: (data: T, fromCache: boolean) => void, fail: (e: unknown) => void) => () => void;
}

export function realtimeResources(): string[] {
  return Object.keys(RESOURCES);
}

const RESOURCES = {
  settings: {
    initial: DEFAULT_SETTINGS,
    start: (tenantId, emit, fail) =>
      onSnapshot(paths.settings(tenantId), (snap) => emit(toSettings(snap.data()), snap.metadata.fromCache), fail),
  } as ResourceDef<StoreSettings>,
  cashbox: {
    initial: toCashbox(undefined),
    start: (tenantId, emit, fail) =>
      onSnapshot(paths.cashbox(tenantId), (snap) => emit(toCashbox(snap.data()), snap.metadata.fromCache), fail),
  } as ResourceDef<CashboxSummary>,
  categories: {
    initial: [] as string[],
    start: (tenantId, emit, fail) =>
      onSnapshot(
        paths.categories(tenantId),
        (snap) => {
          const names = (snap.data()?.names as unknown[] | undefined) ?? [];
          emit(
            names.filter((n): n is string => typeof n === 'string').sort((a, b) => a.localeCompare(b)),
            snap.metadata.fromCache,
          );
        },
        fail,
      ),
  } as ResourceDef<string[]>,
};

type Resources = typeof RESOURCES;
export type ResourceKind = keyof Resources;
type DataOf<K extends ResourceKind> = Resources[K] extends ResourceDef<infer T> ? T : never;

interface Entry {
  state: ResourceState<unknown>;
  listeners: Set<() => void>;
  unsubscribe: (() => void) | null;
  stopTimer: number | null;
}

const entries = new Map<string, Entry>();
const KEEP_WARM_MS = 60_000;

function getEntry(tenantId: string, kind: ResourceKind): Entry {
  const key = `${tenantId}/${kind}`;
  let entry = entries.get(key);
  if (!entry) {
    entry = {
      state: { status: 'loading', data: RESOURCES[kind].initial, error: null, fromCache: true },
      listeners: new Set(),
      unsubscribe: null,
      stopTimer: null,
    };
    entries.set(key, entry);
  }
  return entry;
}

function setState(entry: Entry, next: ResourceState<unknown>) {
  entry.state = next;
  entry.listeners.forEach((l) => l());
}

function start(entry: Entry, tenantId: string, kind: ResourceKind) {
  const def = RESOURCES[kind] as ResourceDef<unknown>;
  entry.unsubscribe = def.start(
    tenantId,
    (data, fromCache) => setState(entry, { status: 'ready', data, error: null, fromCache }),
    (error) => {
      console.error(`[tenantStore] ${kind} listener failed`, error);
      entry.unsubscribe = null;
      setState(entry, { ...entry.state, status: 'error', error });
    },
  );
}

function subscribe(tenantId: string, kind: ResourceKind, listener: () => void): () => void {
  const entry = getEntry(tenantId, kind);
  entry.listeners.add(listener);
  if (entry.stopTimer !== null) {
    window.clearTimeout(entry.stopTimer);
    entry.stopTimer = null;
  }
  if (!entry.unsubscribe && entry.state.status !== 'error') start(entry, tenantId, kind);
  return () => {
    entry.listeners.delete(listener);
    if (entry.listeners.size === 0 && entry.stopTimer === null) {
      entry.stopTimer = window.setTimeout(() => {
        entry.stopTimer = null;
        if (entry.listeners.size === 0) {
          entry.unsubscribe?.();
          entry.unsubscribe = null;
          entries.delete(`${tenantId}/${kind}`);
        }
      }, KEEP_WARM_MS);
    }
  };
}

/** Stops every listener (on sign-out / tenant switch). */
export function resetTenantStore(): void {
  for (const entry of entries.values()) {
    if (entry.stopTimer !== null) window.clearTimeout(entry.stopTimer);
    entry.unsubscribe?.();
  }
  entries.clear();
}

/** Restarts a failed listener (used by "Retry" buttons). */
export function retryResource(tenantId: string, kind: ResourceKind): void {
  const entry = entries.get(`${tenantId}/${kind}`);
  if (!entry || entry.unsubscribe) return;
  setState(entry, { ...entry.state, status: 'loading', error: null });
  start(entry, tenantId, kind);
}

export function useResource<K extends ResourceKind>(tenantId: string, kind: K): ResourceState<DataOf<K>> {
  const subscribeFn = useMemo(
    () => (listener: () => void) => subscribe(tenantId, kind, listener),
    [tenantId, kind],
  );
  const getSnapshot = () => getEntry(tenantId, kind).state as ResourceState<DataOf<K>>;
  return useSyncExternalStore(subscribeFn, getSnapshot, getSnapshot);
}
