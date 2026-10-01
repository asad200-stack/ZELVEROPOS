import type { OperationError, ReasonCode } from './types';

export type Outcome =
  | { kind: 'retry' }
  | { kind: 'conflict'; reason: ReasonCode }
  | { kind: 'rejected'; reason: ReasonCode };

/** Server business errors (details.key) → outcome. Business failures are never retried automatically. */
const BY_KEY: Record<string, Outcome> = {
  'error.insufficientStock': { kind: 'conflict', reason: 'OUT_OF_STOCK' },
  'error.productArchived': { kind: 'conflict', reason: 'PRODUCT_ARCHIVED' },
  'error.productMissing': { kind: 'conflict', reason: 'PRODUCT_MISSING' },
  'error.pricesChanged': { kind: 'conflict', reason: 'PRICE_CHANGED' },
  'error.imeiUnavailable': { kind: 'conflict', reason: 'IMEI_UNAVAILABLE' },
  'error.credit.creditLimit': { kind: 'conflict', reason: 'CREDIT_LIMIT' },
  'error.credit.overpay': { kind: 'conflict', reason: 'CUSTOMER_CHANGED' },
  'error.credit.nothingDue': { kind: 'conflict', reason: 'CUSTOMER_CHANGED' },
  'error.credit.invalidAmount': { kind: 'conflict', reason: 'PAYMENT_MISMATCH' },
  'error.debtChanged': { kind: 'conflict', reason: 'CUSTOMER_CHANGED' },
  'error.customerMissing': { kind: 'conflict', reason: 'CUSTOMER_CHANGED' },
  'error.creditNeedsCustomer': { kind: 'conflict', reason: 'CUSTOMER_CHANGED' },
  'error.rateChanged': { kind: 'conflict', reason: 'EXCHANGE_RATE_CHANGED' },
  'error.paymentMismatch': { kind: 'conflict', reason: 'PAYMENT_MISMATCH' },
  'error.drawerInsufficient': { kind: 'conflict', reason: 'DRAWER_INSUFFICIENT' },
  'error.permissionDenied': { kind: 'rejected', reason: 'PERMISSION_CHANGED' },
  'error.userInactive': { kind: 'rejected', reason: 'USER_DISABLED' },
  'error.fn.subscriptionInactive': { kind: 'rejected', reason: 'SUBSCRIPTION_EXPIRED' },
  'error.alreadyExists': { kind: 'rejected', reason: 'DUPLICATE_ID' },
  'error.invalidInput': { kind: 'rejected', reason: 'INVALID' },
};

/** Transport-level codes: the request may not have reached the server, so it is safe to resend. */
const RETRYABLE = new Set(['', 'network', 'unavailable', 'deadline-exceeded', 'internal', 'unknown', 'resource-exhausted', 'aborted', 'cancelled', 'unauthenticated', 'not-found']);

function codeOf(error: unknown): string {
  const raw = (error as { code?: unknown } | null)?.code;
  if (typeof raw !== 'string') return error instanceof TypeError ? 'network' : '';
  return raw.replace(/^functions\//, '').toLowerCase().replace(/_/g, '-');
}

function detailsOf(error: unknown): { key?: string; params?: Record<string, string | number> } | undefined {
  const d = (error as { details?: unknown } | null)?.details;
  return d && typeof d === 'object' ? (d as { key?: string; params?: Record<string, string | number> }) : undefined;
}

export function describeError(error: unknown, at: number): OperationError {
  const details = detailsOf(error);
  return {
    code: codeOf(error) || 'network',
    key: typeof details?.key === 'string' ? details.key : null,
    ...(details?.params ? { params: details.params } : {}),
    message: String((error as { message?: unknown } | null)?.message ?? error).slice(0, 500),
    at,
  };
}

export function classifyError(error: unknown): Outcome {
  const key = detailsOf(error)?.key;
  if (typeof key === 'string') {
    const known = BY_KEY[key];
    if (known) return known;
    if (key === 'error.unauthenticated' || key === 'error.network') return { kind: 'retry' };
    return { kind: 'conflict', reason: 'UNKNOWN' };
  }
  const code = codeOf(error);
  if (RETRYABLE.has(code)) return { kind: 'retry' };
  if (code === 'permission-denied') return { kind: 'rejected', reason: 'PERMISSION_CHANGED' };
  if (code === 'already-exists') return { kind: 'rejected', reason: 'DUPLICATE_ID' };
  if (code === 'invalid-argument' || code === 'out-of-range') return { kind: 'rejected', reason: 'INVALID' };
  if (code === 'failed-precondition') return { kind: 'conflict', reason: 'UNKNOWN' };
  return { kind: 'retry' };
}

/** Transit codes that make an ONLINE checkout fall back to the offline queue (request may not have arrived). */
const TRANSPORT = new Set(['', 'network', 'unavailable', 'deadline-exceeded', 'internal', 'unknown']);

/**
 * True only for failures where the server gave no business answer. Permission, subscription,
 * stock and price failures always carry `details.key` and are therefore never treated as network.
 */
export function isTransportFailure(error: unknown): boolean {
  if (typeof detailsOf(error)?.key === 'string') return false;
  return TRANSPORT.has(codeOf(error));
}

const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 5 * 60_000;

/** Exponential backoff with ±20% jitter: 2s, 4s, 8s … capped at 5 minutes. */
export function retryDelay(attempts: number, random: () => number = Math.random): number {
  const base = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1));
  return Math.round(base * (0.8 + random() * 0.4));
}
