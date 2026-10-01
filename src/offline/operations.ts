import type { CheckoutCall } from '@/services/functionsClient';
import type { OperationStore } from './store';
import { transition } from './syncEngine';
import type { OfflineOperation, SaleSnapshot } from './types';

/** Temporary customer-facing reference for an offline sale (NOT an invoice number). */
export function offlineRefFor(id: string): string {
  const chars = id.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return `OFF-${chars.slice(-6).padStart(6, '0')}`;
}

export function newSaleOperation(input: {
  tenantId: string;
  uid: string;
  payload: CheckoutCall;
  snapshot: SaleSnapshot;
  now: number;
}): OfflineOperation {
  const offlineRef = offlineRefFor(input.payload.saleId);
  return {
    id: input.payload.saleId,
    type: 'sale',
    tenantId: input.tenantId,
    uid: input.uid,
    status: 'PENDING_SYNC',
    offlineRef,
    createdAt: input.now,
    updatedAt: input.now,
    attempts: 0,
    transportFailures: 0,
    lastAttemptAt: null,
    nextAttemptAt: input.now,
    lastError: null,
    reason: null,
    serverResponse: null,
    result: null,
    resolution: null,
    history: [{ at: input.now, status: 'PENDING_SYNC', reason: null, key: null, note: 'captured offline' }],
    payload: { ...input.payload, clientCreatedAtMs: input.now, offlineRef },
    snapshot: input.snapshot,
  };
}

const failed = (op: OfflineOperation) => (op.status === 'CONFLICT' || op.status === 'REJECTED') && !op.resolution;

/**
 * Manual Retry: sends the sale again with the SAME clientOperationId and the SAME expected prices.
 * Allowed for pending sales (skips the backoff wait / resumes paused retries) and unresolved
 * CONFLICT/REJECTED sales (e.g. after stock arrived or the subscription was renewed).
 */
export function retryOperation(store: OperationStore, id: string, at: number) {
  return store.mutate(id, (op) =>
    op.status === 'PENDING_SYNC' || failed(op)
      ? transition(op, 'PENDING_SYNC', at, { nextAttemptAt: at, transportFailures: 0 }, 'manual retry')
      : null,
  );
}

/** Marks a failed sale as handled. The record (and what was charged) is kept for audit. */
export function resolveOperation(store: OperationStore, id: string, action: 'dismissed' | 'reopened', note: string, at: number) {
  return store.mutate(id, (op) =>
    failed(op) ? transition(op, op.status, at, { resolution: { action, at, note: note.trim().slice(0, 300) } }, action) : null,
  );
}
