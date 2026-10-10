import {
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { PAGE_SIZE } from '@/constants/app';
import type { ReturnRequestLine } from '@/domain/returns';
import { isTransportFailure } from '@/offline/classify';
import { enqueueSale } from '@/offline/queue';
import { buildCheckoutCall, buildSaleSnapshot, type CheckoutContext, type CheckoutRequest } from '@/offline/checkoutPayload';
import type { OfflineOperation } from '@/offline/types';
import type { Sale, SaleKind, SaleReturn } from '@/types/models';
import { paths, toSale, toSaleReturn } from './db';
import { newClientOperationId, retryOnTransport } from './clientOperation';
import { posApi } from './functionsClient';
import { isOnline, requireOnline } from './ops';

/* =============================================================== checkout */

export type { CheckoutContext, CheckoutRequest };

export type CheckoutResult =
  | { mode: 'online'; sale: Sale; duplicate: boolean }
  /** Stored durably on this device; NOT an official invoice until the server accepts it on sync. */
  | { mode: 'queued'; operation: OfflineOperation; cause: 'offline' | 'network' };

/**
 * Completes a sale through the `posCheckout` Cloud Function, which re-reads products, the customer,
 * the rate and the drawer, recomputes every amount and writes all effects in one transaction.
 * Idempotent on `cart.saleId`: retrying after a lost response returns the recorded sale.
 *
 * Offline (or when the request fails in transit) the sale is stored in the durable IndexedDB queue
 * with the SAME saleId — nothing is written to Firestore — and synced later through this function.
 * Business failures (stock, price, permission, subscription…) are thrown, never queued.
 */
export async function checkout(req: CheckoutRequest, ctx: CheckoutContext): Promise<CheckoutResult> {
  const payload = buildCheckoutCall(req);
  const queue = async (cause: 'offline' | 'network'): Promise<CheckoutResult> => ({
    mode: 'queued',
    cause,
    operation: await enqueueSale({ tenantId: ctx.tenantId, uid: ctx.uid, payload, snapshot: buildSaleSnapshot(req, ctx) }),
  });
  if (!isOnline()) return queue('offline');
  let lastError: unknown;
  // A timed-out call can still commit. Resend the same saleId before telling the cashier it failed.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await posApi.checkout(payload);
      return { mode: 'online', sale: toSale(payload.saleId, result.sale), duplicate: result.duplicate };
    } catch (error) {
      lastError = error;
      if (!isTransportFailure(error)) throw error;
    }
  }
  if (isTransportFailure(lastError)) return queue('network');
  throw lastError;
}

/* ================================================================ returns */

export interface ReturnRequest {
  saleId: string;
  lines: ReturnRequestLine[];
  reason: string;
}

/**
 * Processes a (partial) return through the `posReturn` Cloud Function: restores stock/IMEIs,
 * reduces the customer's debt first for credit sales and refunds the rest from the drawer.
 */
export async function processReturn(req: ReturnRequest): Promise<SaleReturn> {
  requireOnline();
  const clientOperationId = newClientOperationId();
  const { saleReturn } = await retryOnTransport(() =>
    posApi.processReturn({
      clientOperationId,
      saleId: req.saleId,
      lines: req.lines.filter((l) => l.quantity > 0),
      reason: req.reason.trim().slice(0, 500),
    }),
  );
  return toSaleReturn(saleReturn.id, saleReturn);
}

/* ================================================================ queries */

export interface SalesFilter {
  from: string;
  to: string;
  kind?: SaleKind | 'all';
  customerId?: string | null;
}

export interface Page<T> {
  items: T[];
  cursor: QueryDocumentSnapshot | null;
  hasMore: boolean;
}

/** Cursor fields only. The page does not keep Firestore snapshots from earlier pages. */
export interface SalesCursor {
  localDate: string;
  createdAtMs: number;
  id: string;
}

export interface SalesList {
  items: Sale[];
  cursor: SalesCursor | null;
  hasMore: boolean;
}

export async function listSales(tenantId: string, filter: SalesFilter, cursor: SalesCursor | null): Promise<SalesList> {
  const constraints: QueryConstraint[] = [
    where('localDate', '>=', filter.from),
    where('localDate', '<=', filter.to),
  ];
  if (filter.kind && filter.kind !== 'all') constraints.push(where('kind', '==', filter.kind));
  if (filter.customerId) constraints.push(where('customerId', '==', filter.customerId));
  constraints.push(orderBy('localDate', 'desc'), orderBy('createdAtMs', 'desc'), orderBy(documentId(), 'desc'), limit(PAGE_SIZE));
  if (cursor) constraints.push(startAfter(cursor.localDate, cursor.createdAtMs, cursor.id));
  const snap = await getDocs(query(paths.col(tenantId, 'sales'), ...constraints));
  const last = snap.docs[snap.docs.length - 1];
  return {
    items: snap.docs.map((d) => toSale(d.id, d.data())),
    cursor: last
      ? { localDate: String(last.get('localDate') ?? ''), createdAtMs: Number(last.get('createdAtMs')) || 0, id: last.id }
      : null,
    hasMore: snap.docs.length === PAGE_SIZE,
  };
}

/** Exact invoice match. This does not load a page and search it. */
export async function findSaleByInvoice(tenantId: string, invoiceNumber: string): Promise<Sale | null> {
  const snap = await getDocs(
    query(paths.col(tenantId, 'sales'), where('invoiceNumber', '==', invoiceNumber.trim().toUpperCase()), limit(1)),
  );
  const d = snap.docs[0];
  return d ? toSale(d.id, d.data()) : null;
}

export async function getSale(tenantId: string, saleId: string): Promise<Sale | null> {
  const snap = await getDoc(paths.doc(tenantId, 'sales', saleId));
  return snap.exists() ? toSale(snap.id, snap.data()) : null;
}

/** Returns that belong to one sale. Repeated-return checks use the sale document, not this list. */
export async function listReturnsForSale(tenantId: string, saleId: string): Promise<SaleReturn[]> {
  const snap = await getDocs(
    query(
      paths.col(tenantId, 'returns'),
      where('saleId', '==', saleId),
      orderBy('createdAtMs', 'desc'),
      orderBy(documentId(), 'desc'),
      limit(50),
    ),
  );
  return snap.docs.map((d) => toSaleReturn(d.id, d.data()));
}
