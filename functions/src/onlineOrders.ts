/**
 * Online Store — Milestone B: website orders.
 *
 *   publicPlaceOrder       guest checkout from a published store (cash on delivery / pay at pickup)
 *   onlineOrdersList       owner inbox
 *   onlineOrdersSetStatus  owner moves an order through the status machine
 *
 * The tenant always comes from the server-owned slug index (public) or from the caller's own
 * principal (owner); strict schemas reject any tenant/store/uid/price field. Prices, availability
 * and stock are decided on the server inside one transaction: the client only sends product ids and
 * quantities. Stock is taken when the order is placed and given back exactly once on cancel/reject.
 * Orders live at onlineStores/{tenantId}/orders/{id}, which Firestore rules deny to every client.
 */
import type { DocumentData, DocumentSnapshot } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db } from './admin.js';
import { REGION } from './config.js';
import { fail, rethrowClientSafe } from './errors.js';
import { clientIp, ownerCall, publicFn, publicSlug, rateLimit, resolvePublishedStore, storeRef, stripTransport } from './onlineStore.js';
import { businessDate, exchangeRateOf, idField, tenantPaths, toProduct } from './pos/common.js';
import {
  FULFILLMENT_METHODS,
  ORDER_ADDRESS_MAX,
  ORDER_MAX_LINES,
  ORDER_MAX_QTY,
  ORDER_NAME_MAX,
  ORDER_NOTE_MAX,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  canTransition,
  formatOrderRef,
  mergeOrderLines,
  normalizeOrderPhone,
  orderProblem,
  restoresStock,
  toOnlineOrder,
  toReceipt,
  type OnlineOrder,
  type OnlineOrderLine,
  type PublicOrderReceipt,
} from './shared/onlineOrders.js';
import { tierLbp, tierUsdCents } from './shared/pricing.js';
import { parse } from './validate.js';

const PLACE_ORDER_PER_HOUR = 20;
const LIST_DEFAULT = 50;
const LIST_MAX = 200;
const ONLINE_ACTOR = { createdBy: 'online-store', createdByName: 'Online order' } as const;

const ordersCol = (tenantId: string) => storeRef(tenantId).collection('orders');

const placeOrderSchema = z.strictObject({
  slug: z.string().min(1).max(64),
  lines: z
    .array(z.strictObject({ productId: idField, qty: z.number().int().min(1).max(ORDER_MAX_QTY) }))
    .min(1)
    .max(ORDER_MAX_LINES),
  name: z.string().max(ORDER_NAME_MAX * 2),
  phone: z.string().max(40),
  address: z.string().max(ORDER_ADDRESS_MAX * 2),
  note: z.string().max(ORDER_NOTE_MAX * 2),
  fulfillment: z.enum(FULFILLMENT_METHODS),
  payment: z.enum(PAYMENT_METHODS),
});

const listSchema = z.strictObject({
  status: z.enum(ORDER_STATUSES).optional(),
  limit: z.number().int().min(1).max(LIST_MAX).optional(),
});

const setStatusSchema = z.strictObject({
  orderId: idField,
  status: z.enum(ORDER_STATUSES),
});

function auditAt(ms: number) {
  return { createdAt: FieldValue.serverTimestamp(), createdAtMs: ms, localDate: businessDate(ms), ...ONLINE_ACTOR };
}

/* ------------------------------------------------------------------ public checkout */

export const publicPlaceOrder = onCall(publicFn, async (request): Promise<PublicOrderReceipt> => {
  try {
    const input = parse(placeOrderSchema, stripTransport(request.data));
    const slug = publicSlug(input.slug);
    const customer = { name: input.name, phone: input.phone, address: input.address };
    const problem = orderProblem(input.lines, customer, input.fulfillment);
    if (problem) fail('invalid-argument', `error.onlineOrders.${problem}`);
    const note = input.note.trim();
    if (note.length > ORDER_NOTE_MAX) fail('invalid-argument', 'error.onlineOrders.note');

    const now = Date.now();
    await rateLimit('placeOrder', clientIp(request), now, PLACE_ORDER_PER_HOUR);
    const { tenantId, config } = await resolvePublishedStore(slug);
    const visible = new Set(config.visibleProductIds);
    const lines = mergeOrderLines(input.lines);
    if (lines.some((l) => !visible.has(l.productId))) fail('failed-precondition', 'error.onlineOrders.unavailable');

    const paths = tenantPaths(tenantId);
    const rate = exchangeRateOf((await paths.settings.get()).data());
    const orderRef = ordersCol(tenantId).doc();

    const order = await db.runTransaction(async (tx) => {
      const storeSnap = await tx.get(storeRef(tenantId));
      const productSnaps = await tx.getAll(...lines.map((l) => paths.doc('products', l.productId)));

      const priced: OnlineOrderLine[] = [];
      const products = productSnaps.map((snap, i) => {
        const line = lines[i]!;
        const data = snap.data();
        if (!data) fail('failed-precondition', 'error.onlineOrders.unavailable');
        const product = toProduct(snap.id, data);
        if (product.status === 'archived' || product.imeiTracking) fail('failed-precondition', 'error.onlineOrders.unavailable');
        if (product.stock < line.qty) fail('failed-precondition', 'error.onlineOrders.outOfStock', { name: product.name });
        const unitUsdCents = tierUsdCents(product, 'retail', rate);
        const unitLbp = tierLbp(product, 'retail', rate);
        if (unitUsdCents <= 0 && unitLbp <= 0) fail('failed-precondition', 'error.onlineOrders.unavailable');
        priced.push({
          productId: product.id,
          name: product.name,
          qty: line.qty,
          unitUsdCents,
          unitLbp,
          lineUsdCents: unitUsdCents * line.qty,
          lineLbp: unitLbp * line.qty,
        });
        return product;
      });

      // Re-check the store inside the transaction so an unpublish racing the checkout wins.
      if (storeSnap.get('publication') !== 'published' || storeSnap.get('enabled') !== true) {
        fail('not-found', 'error.onlineStore.notFound');
      }
      const seq = Number(storeSnap.get('orderSeq') ?? 0) + 1;
      const ref = formatOrderRef(seq);
      const audit = auditAt(now);

      products.forEach((product, i) => {
        const qty = priced[i]!.qty;
        const movementRef = paths.newRef('stockMovements');
        tx.update(paths.doc('products', product.id), {
          stock: product.stock - qty,
          lastMovementId: movementRef.id,
          updatedAt: FieldValue.serverTimestamp(),
        });
        tx.set(movementRef, {
          productId: product.id,
          productName: product.name,
          type: 'sale',
          quantity: -qty,
          stockAfter: product.stock - qty,
          refId: orderRef.id,
          refNumber: ref,
          note: 'Online order',
          ...audit,
        });
      });

      const doc: Omit<OnlineOrder, 'id'> = {
        ref,
        status: 'pending',
        fulfillment: input.fulfillment,
        payment: 'cod',
        customerName: input.name.trim(),
        customerPhone: normalizeOrderPhone(input.phone),
        address: input.address.trim(),
        note,
        lines: priced,
        totalUsdCents: priced.reduce((s, l) => s + l.lineUsdCents, 0),
        totalLbp: priced.reduce((s, l) => s + l.lineLbp, 0),
        createdAtMs: now,
        updatedAtMs: now,
      };
      tx.set(storeRef(tenantId), { orderSeq: seq }, { merge: true });
      tx.set(orderRef, { ...doc, ...audit, history: [{ status: 'pending', atMs: now, by: ONLINE_ACTOR.createdBy }] });
      return doc;
    });

    return toReceipt(order);
  } catch (err) {
    rethrowClientSafe(err);
  }
});

/* ------------------------------------------------------------------ owner inbox */

export interface OnlineOrdersListResponse {
  orders: OnlineOrder[];
}

export const onlineOrdersList = onCall({ region: REGION }, (request) =>
  ownerCall(request, async ({ tenantId }, data): Promise<OnlineOrdersListResponse> => {
    const input = parse(listSchema, data);
    let q = ordersCol(tenantId).orderBy('createdAtMs', 'desc');
    if (input.status) q = ordersCol(tenantId).where('status', '==', input.status).orderBy('createdAtMs', 'desc');
    const snap = await q.limit(input.limit ?? LIST_DEFAULT).get();
    return { orders: snap.docs.map((d: DocumentSnapshot) => toOnlineOrder(d.id, d.data() as DocumentData)) };
  }),
);

export interface OnlineOrderStatusResponse {
  order: OnlineOrder;
}

export const onlineOrdersSetStatus = onCall({ region: REGION }, (request) =>
  ownerCall(request, async ({ tenantId, uid }, data): Promise<OnlineOrderStatusResponse> => {
    const input = parse(setStatusSchema, data);
    const paths = tenantPaths(tenantId);
    const orderRef = ordersCol(tenantId).doc(input.orderId);
    const now = Date.now();

    return db.runTransaction(async (tx) => {
      const snap = await tx.get(orderRef);
      if (!snap.exists) fail('not-found', 'error.onlineOrders.notFound');
      const order = toOnlineOrder(snap.id, snap.data());
      if (!canTransition(order.status, input.status)) fail('failed-precondition', 'error.onlineOrders.badTransition');

      if (restoresStock(order.status, input.status)) {
        const lines = order.lines.filter((l) => l.productId && l.qty > 0);
        const productSnaps = lines.length ? await tx.getAll(...lines.map((l) => paths.doc('products', l.productId))) : [];
        const audit = { createdAt: FieldValue.serverTimestamp(), createdAtMs: now, localDate: businessDate(now), createdBy: uid, createdByName: 'Online order' };
        productSnaps.forEach((ps, i) => {
          const pdata = ps.data();
          if (!pdata) return; // product deleted since; nothing to give back to
          const product = toProduct(ps.id, pdata);
          const qty = lines[i]!.qty;
          const movementRef = paths.newRef('stockMovements');
          tx.update(ps.ref, { stock: product.stock + qty, lastMovementId: movementRef.id, updatedAt: FieldValue.serverTimestamp() });
          tx.set(movementRef, {
            productId: product.id,
            productName: product.name,
            type: 'return',
            quantity: qty,
            stockAfter: product.stock + qty,
            refId: order.id,
            refNumber: order.ref,
            note: `Online order ${input.status}`,
            ...audit,
          });
        });
      }

      tx.update(orderRef, {
        status: input.status,
        updatedAtMs: now,
        history: FieldValue.arrayUnion({ status: input.status, atMs: now, by: uid }),
      });
      return { order: { ...order, status: input.status, updatedAtMs: now } };
    });
  }),
);
