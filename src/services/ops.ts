import { serverTimestamp } from 'firebase/firestore';
import { localDate } from '@/domain/dates';
import type { Actor } from './db';
import { AppError } from './errors';

/** Audit stamp for master data written directly by the client (customers, suppliers, products edits). */
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

/** Money and stock operations run in Cloud Functions and need a connection. */
export function requireOnline(): void {
  if (!isOnline()) throw new AppError('error.offlineNotAllowed');
}
