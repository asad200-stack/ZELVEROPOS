import type { CheckoutCall } from '@/services/functionsClient';
import type { Currency, PriceTier, SaleKind } from '@/types/models';

/**
 * Lifecycle of an offline sale. DRAFT is the POS cart itself (localStorage); a sale enters the
 * durable queue as PENDING_SYNC once the cashier completes it, and only the server moves it to
 * SYNCED (official invoice) or to CONFLICT / REJECTED.
 */
export type OperationStatus = 'DRAFT' | 'PENDING_SYNC' | 'SYNCING' | 'SYNCED' | 'CONFLICT' | 'REJECTED';

/** Why the server refused a queued sale. CONFLICT reasons can be fixed by editing the sale; REJECTED ones cannot. */
export type ReasonCode =
  | 'OUT_OF_STOCK'
  | 'PRODUCT_ARCHIVED'
  | 'PRODUCT_MISSING'
  | 'PRICE_CHANGED'
  | 'IMEI_UNAVAILABLE'
  | 'CREDIT_LIMIT'
  | 'CUSTOMER_CHANGED'
  | 'EXCHANGE_RATE_CHANGED'
  | 'PAYMENT_MISMATCH'
  | 'DRAWER_INSUFFICIENT'
  | 'PERMISSION_CHANGED'
  | 'USER_DISABLED'
  | 'SUBSCRIPTION_EXPIRED'
  | 'DUPLICATE_ID'
  | 'INVALID'
  | 'UNKNOWN';

export interface OperationError {
  /** Callable error code (e.g. `failed-precondition`) or `network`. */
  code: string;
  /** Translation key returned by the server, when any. */
  key: string | null;
  params?: Record<string, string | number>;
  message: string;
  at: number;
}

/** What the cashier saw when the sale was made offline. Informational only — never authoritative. */
export interface SaleSnapshot {
  kind: SaleKind;
  currency: Currency;
  tier: PriceTier;
  rate: number;
  lines: {
    productId: string;
    name: string;
    tier: PriceTier;
    quantity: number;
    /** Unit price the cashier saw (after any manual override). */
    unitUsdCents: number;
    unitLbp: number;
    /** Tier price before the override; equals unitUsdCents when there is no override. */
    originalUnitUsdCents: number;
    /** Manual price override, or null. */
    customUsdCents: number | null;
    lineUsdCents: number;
    lineLbp: number;
    imei: string | null;
  }[];
  totalUsdCents: number;
  totalLbp: number;
  debtLineUsdCents: number | null;
  customerId: string | null;
  customerName: string;
  orderLabel?: string;
  note?: string;
  /** Cash physically taken from the customer (NOT yet in the official drawer until synced). */
  received: { usdCents: number; lbp: number };
  /** Change handed back. Older queued sales omit it. */
  change?: { usdCents: number; lbp: number };
  cashierName: string;
}

export interface OperationHistoryEntry {
  at: number;
  status: OperationStatus;
  reason: ReasonCode | null;
  key: string | null;
  note?: string;
}

export interface OfflineOperation {
  /** clientOperationId: immutable, reused on every retry; equals the sale document id. */
  id: string;
  type: 'sale';
  tenantId: string;
  uid: string;
  status: OperationStatus;
  /** Temporary reference printed for the customer; the official invoice number comes from the server. */
  offlineRef: string;
  createdAt: number;
  updatedAt: number;
  /** Total send attempts (every one reused the same clientOperationId). */
  attempts: number;
  /** Consecutive network/unavailable failures; automatic retries pause at MAX_AUTO_RETRIES. */
  transportFailures: number;
  lastAttemptAt: number | null;
  nextAttemptAt: number;
  lastError: OperationError | null;
  reason: ReasonCode | null;
  /** Raw server answer for the last attempt (error details or the recorded sale summary). */
  serverResponse: unknown;
  result: { invoiceNumber: string; totalUsdCents: number; duplicate: boolean; syncedAt: number } | null;
  /** Set when a person handled a CONFLICT/REJECTED record; the record itself is kept. */
  resolution: { action: 'dismissed' | 'reopened'; at: number; note: string } | null;
  history: OperationHistoryEntry[];
  payload: CheckoutCall;
  snapshot: SaleSnapshot;
}

/** Automatic retries stopped after too many network failures; waits for a manual Retry. */
export function isPaused(op: OfflineOperation): boolean {
  return op.status === 'PENDING_SYNC' && op.nextAttemptAt === Number.MAX_SAFE_INTEGER;
}

export function needsAction(op: OfflineOperation): boolean {
  return ((op.status === 'CONFLICT' || op.status === 'REJECTED') && !op.resolution) || isPaused(op);
}
