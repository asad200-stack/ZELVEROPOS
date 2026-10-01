import type { CheckoutCall, CheckoutResponse } from '@/services/functionsClient';
import { classifyError, describeError, retryDelay } from './classify';
import type { OperationStore } from './store';
import type { OfflineOperation, OperationStatus } from './types';

/** Sync lease lifetime. Longer than the callable timeout (60s), renewed before every operation. */
export const LEASE_TTL_MS = 90_000;
/** A SYNCING record older than this belongs to a tab that died mid-request; resending is safe (idempotent). */
export const STALE_SYNCING_MS = LEASE_TTL_MS;
/** Consecutive transport failures before automatic retries pause (manual Retry resumes). */
export const MAX_AUTO_RETRIES = 10;
/** SYNCED records are kept this long for reference, then pruned. Failed records are never pruned. */
export const SYNCED_RETENTION_MS = 14 * 86_400_000;
export const PAUSED = Number.MAX_SAFE_INTEGER;

export interface SyncIdentity {
  tenantId: string;
  uid: string;
}

export interface SyncEngineDeps {
  store: OperationStore;
  /** Sends the sale through the SAME server function as an online sale (`posCheckout`). */
  send: (payload: CheckoutCall) => Promise<CheckoutResponse>;
  /** Signed-in user; only that user's operations are sent (the server records the caller as cashier). */
  identity: () => SyncIdentity | null;
  /** Unique id of this tab/engine, used as the lease owner. */
  owner: string;
  isOnline?: () => boolean;
  now?: () => number;
  random?: () => number;
  onChange?: () => void;
}

export interface SyncSummary {
  synced: number;
  conflicts: number;
  rejected: number;
  /** True when a transport failure stopped the pass; the operation stays PENDING_SYNC. */
  interrupted: boolean;
  skipped?: 'offline' | 'signed-out' | 'busy';
}

const empty = (): SyncSummary => ({ synced: 0, conflicts: 0, rejected: 0, interrupted: false });

export function transition(op: OfflineOperation, status: OperationStatus, at: number, patch: Partial<OfflineOperation>, note?: string): OfflineOperation {
  const next = { ...op, ...patch, status, updatedAt: at };
  const entry = { at, status, reason: next.reason, key: next.lastError?.key ?? null, ...(note ? { note } : {}) };
  return { ...next, history: [...op.history, entry].slice(-50) };
}

export function createSyncEngine(deps: SyncEngineDeps) {
  const now = deps.now ?? Date.now;
  const isOnline = deps.isOnline ?? (() => true);
  let running: Promise<SyncSummary> | null = null;

  async function recoverStale(at: number) {
    for (const op of await deps.store.list()) {
      if (op.status !== 'SYNCING' || (op.lastAttemptAt ?? 0) > at - STALE_SYNCING_MS) continue;
      await deps.store.mutate(op.id, (cur) =>
        cur.status === 'SYNCING' && (cur.lastAttemptAt ?? 0) <= at - STALE_SYNCING_MS
          ? transition(cur, 'PENDING_SYNC', at, { nextAttemptAt: at }, 'recovered from an interrupted sync')
          : null,
      );
    }
  }

  async function prune(at: number) {
    for (const op of await deps.store.list()) {
      if (op.status === 'SYNCED' && (op.result?.syncedAt ?? op.updatedAt) < at - SYNCED_RETENTION_MS) await deps.store.remove(op.id);
    }
  }

  /** Sends one claimed operation and records the authoritative outcome. Returns false to stop the pass. */
  async function process(op: OfflineOperation, summary: SyncSummary): Promise<boolean> {
    try {
      const res = await deps.send(op.payload);
      const at = now();
      const sale = res.sale;
      await deps.store.mutate(op.id, (cur) =>
        transition(cur, 'SYNCED', at, {
          lastError: null,
          reason: null,
          transportFailures: 0,
          serverResponse: { invoiceNumber: sale.invoiceNumber ?? null, totalUsdCents: sale.totalUsdCents ?? null, duplicate: res.duplicate },
          result: {
            invoiceNumber: String(sale.invoiceNumber ?? ''),
            totalUsdCents: Number(sale.totalUsdCents) || 0,
            duplicate: res.duplicate,
            syncedAt: at,
          },
        }),
      );
      summary.synced += 1;
      return true;
    } catch (error) {
      const at = now();
      const outcome = classifyError(error);
      const lastError = describeError(error, at);
      const serverResponse = { code: lastError.code, key: lastError.key, params: lastError.params ?? null, message: lastError.message };
      if (outcome.kind === 'retry') {
        await deps.store.mutate(op.id, (cur) => {
          const failures = cur.transportFailures + 1;
          const nextAttemptAt = failures >= MAX_AUTO_RETRIES ? PAUSED : at + retryDelay(failures, deps.random);
          return transition(cur, 'PENDING_SYNC', at, { lastError, serverResponse, transportFailures: failures, nextAttemptAt });
        });
        summary.interrupted = true;
        return false;
      }
      const status = outcome.kind === 'conflict' ? 'CONFLICT' : 'REJECTED';
      await deps.store.mutate(op.id, (cur) => transition(cur, status, at, { lastError, serverResponse, reason: outcome.reason }));
      if (status === 'CONFLICT') summary.conflicts += 1;
      else summary.rejected += 1;
      return true;
    } finally {
      deps.onChange?.();
    }
  }

  async function pass(who: SyncIdentity): Promise<SyncSummary> {
    const summary = empty();
    await recoverStale(now());
    await prune(now());

    const mine = (await deps.store.list()).filter((op) => op.tenantId === who.tenantId && op.uid === who.uid);
    // Strict creation order, one at a time: a later sale never overtakes an earlier one that is
    // waiting to retry, so the earlier customer keeps priority on the last units of stock.
    for (const queued of mine) {
      if (queued.status !== 'PENDING_SYNC') continue;
      const at = now();
      if (queued.nextAttemptAt > at) break;
      if (!(await deps.store.acquireLease(deps.owner, at, LEASE_TTL_MS))) {
        summary.skipped = 'busy';
        break;
      }
      const claimed = await deps.store.mutate(queued.id, (cur) =>
        cur.status === 'PENDING_SYNC' && cur.nextAttemptAt <= at
          ? transition(cur, 'SYNCING', at, { attempts: cur.attempts + 1, lastAttemptAt: at })
          : null,
      );
      if (!claimed) continue;
      deps.onChange?.();
      if (!(await process(claimed, summary))) break;
    }
    return summary;
  }

  async function run(): Promise<SyncSummary> {
    const who = deps.identity();
    if (!who) return { ...empty(), skipped: 'signed-out' };
    if (!isOnline()) return { ...empty(), skipped: 'offline' };
    if (!(await deps.store.acquireLease(deps.owner, now(), LEASE_TTL_MS))) return { ...empty(), skipped: 'busy' };
    try {
      return await pass(who);
    } finally {
      await deps.store.releaseLease(deps.owner).catch(() => undefined);
    }
  }

  return {
    /** Runs one sync pass (coalesced: concurrent calls in the same tab share the running pass). */
    syncNow(): Promise<SyncSummary> {
      running ??= run().finally(() => {
        running = null;
      });
      return running;
    },
  };
}

export type SyncEngine = ReturnType<typeof createSyncEngine>;
