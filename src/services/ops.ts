import {
  runTransaction,
  serverTimestamp,
  writeBatch,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type SetOptions,
  type Transaction,
} from 'firebase/firestore';
import { firebase } from '@/firebase/app';
import { localDate } from '@/domain/dates';
import type { Actor } from './db';
import { AppError, isNetworkError } from './errors';
import { trackPendingWrite } from '@/stores/syncStore';

/** Common subset of Transaction and WriteBatch used by operation builders. */
export interface Writer {
  set(ref: DocumentReference, data: DocumentData, options?: SetOptions): unknown;
  update(ref: DocumentReference, data: DocumentData): unknown;
}

export type Reader = (ref: DocumentReference) => Promise<DocumentSnapshot>;

export function auditFields(actor: Actor) {
  const now = new Date();
  return {
    createdAt: serverTimestamp(),
    createdAtMs: now.getTime(),
    localDate: localDate(now),
    createdBy: actor.uid,
    createdByName: actor.name,
  };
}

export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

const TX_TIMEOUT_MS = 20_000;

/** Runs a transaction with a timeout so a flaky connection never freezes the POS. */
export async function runTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new AppError('error.networkRetry')), TX_TIMEOUT_MS);
  });
  try {
    return await Promise.race([runTransaction(firebase.db, fn, { maxAttempts: 5 }), timeout]);
  } catch (e) {
    if (isNetworkError(e)) throw new AppError('error.networkRetry');
    throw e;
  } finally {
    window.clearTimeout(timer);
  }
}

/** Requires a connection for operations that must read the latest server state. */
export function requireOnline(): void {
  if (!isOnline()) throw new AppError('error.offlineNotAllowed');
}

/**
 * Commits a batch built from cached data while offline. The commit promise only resolves once the
 * server acknowledges it, so we don't await it: the local cache is updated immediately and the
 * write is synced automatically when the connection returns.
 */
export function commitOfflineBatch(build: (w: Writer) => void, label: string): void {
  const batch = writeBatch(firebase.db);
  build(batch);
  trackPendingWrite(batch.commit(), label);
}
