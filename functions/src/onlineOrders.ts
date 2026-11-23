/**
 * Online Store — Milestone B: website orders.
 *
 *   publicPlaceOrder       guest checkout from a published store (cash on delivery / pay at pickup)
 *   onlineOrdersList       owner inbox
 *   onlineOrdersSetStatus  owner moves an order through the status machine
 *   publicTrackOrder       guest looks up an order by reference + phone (status timeline only)
 *   publicSubmitReview     guest reviews a product from a delivered order (held for moderation)
 *   publicProductReviews   approved reviews and rating summary for one visible product
 *   onlineReviewsList      owner moderation queue
 *   onlineReviewsSetStatus owner approves or rejects a review
 *
 * The tenant always comes from the server-owned slug index (public) or from the caller's own
 * principal (owner); strict schemas reject any tenant/store/uid/price field. Prices, availability
 * and stock are decided on the server inside one transaction: the client only sends product ids and
 * quantities. Stock is taken when the order is placed and given back exactly once on cancel/reject.
 * Orders live at onlineStores/{tenantId}/orders/{id}, which Firestore rules deny to every client.
 */
import type { DocumentData, DocumentSnapshot } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { onCall, onRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db } from './admin.js';
import { REGION, STORE_SITE_ORIGIN } from './config.js';
import { fail, rethrowClientSafe } from './errors.js';
import { clientIp, ownerCall, publicFn, publicSlug, rateLimit, resolvePublishedStore, statsRef, storeRef, stripTransport } from './onlineStore.js';
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
  waitsForPayment,
  MANUAL_PAYMENTS,
  manualPayment,
  canSettleByHand,
  toOnlineOrder,
  toReceipt,
  paymentStatusFromWhish,
  whishAmount,
  whishExternalId,
  type PaymentStatus,
  REVIEW_STATUSES,
  REVIEW_TEXT_MAX,
  canReviewOrder,
  normalizeOrderRef,
  publicReviewerName,
  summarizeRatings,
  toHistory,
  toProductReview,
  type OnlineOrder,
  type OnlineOrderLine,
  type ProductReview,
  type PublicOrderReceipt,
  type PublicOrderTracking,
  type PublicReview,
  type ReviewSummary,
} from './shared/onlineOrders.js';
import { deliveryQuote } from './shared/onlineStore.js';
import { tierLbp, tierUsdCents } from './shared/pricing.js';
import { parse } from './validate.js';
import { createWhishPayment, loadWhish, whishStatus, type WhishCreds } from './whish.js';

const PLACE_ORDER_PER_HOUR = 20;
const LIST_DEFAULT = 50;
const LIST_MAX = 200;
const ONLINE_ACTOR = { createdBy: 'online-store', createdByName: 'Online order' } as const;

const TRACK_PER_HOUR = 30;
const REVIEW_PER_HOUR = 10;
const REVIEWS_READ_PER_HOUR = 300;
const PUBLIC_REVIEWS_MAX = 20;

const ordersCol = (tenantId: string) => storeRef(tenantId).collection('orders');
const reviewsCol = (tenantId: string) => storeRef(tenantId).collection('reviews');

const guestOrderFields = {
  slug: z.string().min(1).max(64),
  ref: z.string().max(20),
  phone: z.string().max(40),
};
const trackSchema = z.strictObject(guestOrderFields);
const submitReviewSchema = z.strictObject({
  ...guestOrderFields,
  productId: idField,
  rating: z.number().int().min(1).max(5),
  text: z.string().max(REVIEW_TEXT_MAX * 2),
});
const productReviewsSchema = z.strictObject({ slug: z.string().min(1).max(64), productId: idField });
const reviewsListSchema = z.strictObject({
  status: z.enum(REVIEW_STATUSES).optional(),
  limit: z.number().int().min(1).max(LIST_MAX).optional(),
});
const reviewSetStatusSchema = z.strictObject({ reviewId: z.string().min(1).max(300), status: z.enum(REVIEW_STATUSES) });

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
  // Optional for older storefronts; required by deliveryQuote when the store has zones.
  zoneId: z.string().max(20).optional(),
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

    // Whish only when the shop has connected its own Whish account; never silently downgraded.
    const whish = input.payment === 'whish' ? await loadWhish(tenantId) : null;
    if (input.payment === 'whish' && !whish) fail('failed-precondition', 'error.onlineOrders.paymentUnavailable');

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
      // Delivery fee and minimum are decided here from the published store, never by the client.
      const itemsUsdCents = priced.reduce((s, l) => s + l.lineUsdCents, 0);
      const delivery = deliveryQuote(config.published ?? { deliveryZones: [], freeDeliveryOverUsdCents: null, minOrderUsdCents: null }, itemsUsdCents, input.fulfillment, input.zoneId);
      if (delivery.problem) fail('invalid-argument', `error.onlineOrders.${delivery.problem}`);

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
        payment: input.payment,
        paymentStatus: input.payment === 'whish' ? 'unpaid' : 'none',
        payerPhone: '',
        customerName: input.name.trim(),
        customerPhone: normalizeOrderPhone(input.phone),
        address: input.address.trim(),
        note,
        lines: priced,
        deliveryZone: delivery.zone?.name ?? '',
        deliveryFeeUsdCents: delivery.feeUsdCents,
        totalUsdCents: itemsUsdCents + delivery.feeUsdCents,
        // The fee is set in USD; the LBP total converts it at the store's rate so both totals agree.
        totalLbp: priced.reduce((s, l) => s + l.lineLbp, 0) + Math.round((delivery.feeUsdCents / 100) * rate),
        createdAtMs: now,
        updatedAtMs: now,
      };
      tx.set(storeRef(tenantId), { orderSeq: seq }, { merge: true });
      tx.set(
        statsRef(tenantId, businessDate(now)),
        { orders: FieldValue.increment(1), revenueUsdCents: FieldValue.increment(doc.totalUsdCents), updatedAt: now },
        { merge: true },
      );
      tx.set(orderRef, { ...doc, ...audit, history: [{ status: 'pending', atMs: now, by: ONLINE_ACTOR.createdBy }] });
      return doc;
    });

    if (whish) {
      // The order is already saved (stock reserved). If Whish can't start now, the guest gets
      // the receipt with a "pay now" button that retries through publicPayOrder.
      const payUrl = await startWhish(tenantId, slug, orderRef.id, order, whish).catch((err: unknown) => {
        console.warn('[whish] start failed', tenantId, orderRef.id, err instanceof Error ? err.message : err);
        return undefined;
      });
      return { ...toReceipt(order), ...(payUrl ? { payUrl } : {}) };
    }
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
      if (waitsForPayment(order, input.status)) fail('failed-precondition', 'error.onlineOrders.unpaid');

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

const settleSchema = z.strictObject({
  orderId: idField,
  how: z.enum(MANUAL_PAYMENTS),
});

/**
 * Owner: settles an unpaid Whish order by hand, either because the money reached the shop's
 * Whish account outside the link (how: 'whish') or because the customer will pay cash ('cash').
 */
export const onlineOrdersSettlePayment = onCall({ region: REGION }, (request) =>
  ownerCall(request, async ({ tenantId, uid }, data): Promise<OnlineOrderStatusResponse> => {
    const input = parse(settleSchema, data);
    const orderRef = ordersCol(tenantId).doc(input.orderId);
    const now = Date.now();
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(orderRef);
      if (!snap.exists) fail('not-found', 'error.onlineOrders.notFound');
      const order = toOnlineOrder(snap.id, snap.data());
      if (!canSettleByHand(order)) fail('failed-precondition', 'error.onlineOrders.badTransition');
      const next = manualPayment(input.how);
      tx.update(orderRef, {
        ...next,
        ...(input.how === 'whish' ? { paidAtMs: now, paidManually: true } : {}),
        updatedAtMs: now,
        history: FieldValue.arrayUnion({ status: order.status, atMs: now, by: `${uid}:${input.how === 'whish' ? 'paid' : 'cash'}` }),
      });
      return { order: { ...order, ...next, updatedAtMs: now } };
    });
  }),
);

/* ------------------------------------------------------------------ guest tracking */

/**
 * Finds a guest's order from the reference and the phone used at checkout. Every mismatch answers
 * the same not-found so the endpoint cannot be used to learn which references exist.
 */
async function findGuestOrder(tenantId: string, refRaw: string, phoneRaw: string) {
  const ref = normalizeOrderRef(refRaw);
  const phone = normalizeOrderPhone(phoneRaw);
  if (!ref || phone.length < 6) fail('not-found', 'error.onlineOrders.notFound');
  const snap = await ordersCol(tenantId).where('ref', '==', ref).limit(1).get();
  const doc = snap.docs[0];
  const data = doc?.data();
  if (!doc || !data || data.customerPhone !== phone) fail('not-found', 'error.onlineOrders.notFound');
  return { id: doc.id, data, order: toOnlineOrder(doc.id, data) };
}

export const publicTrackOrder = onCall(publicFn, async (request): Promise<PublicOrderTracking> => {
  try {
    const input = parse(trackSchema, stripTransport(request.data));
    const slug = publicSlug(input.slug);
    await rateLimit('trackOrder', clientIp(request), Date.now(), TRACK_PER_HOUR);
    const { tenantId } = await resolvePublishedStore(slug);
    const { data, order } = await findGuestOrder(tenantId, input.ref, input.phone);
    return {
      ref: order.ref,
      status: order.status,
      fulfillment: order.fulfillment,
      totalUsdCents: order.totalUsdCents,
      totalLbp: order.totalLbp,
      createdAtMs: order.createdAtMs,
      history: toHistory(data.history),
    };
  } catch (err) {
    rethrowClientSafe(err);
  }
});

/* ------------------------------------------------------------------ reviews */

export interface SubmitReviewResponse {
  ok: true;
}

/** Verified-buyer review: the order must be delivered and contain the product. One per order line. */
export const publicSubmitReview = onCall(publicFn, async (request): Promise<SubmitReviewResponse> => {
  try {
    const input = parse(submitReviewSchema, stripTransport(request.data));
    const slug = publicSlug(input.slug);
    const text = input.text.trim();
    if (text.length > REVIEW_TEXT_MAX) fail('invalid-argument', 'error.onlineOrders.reviewText');
    const now = Date.now();
    await rateLimit('submitReview', clientIp(request), now, REVIEW_PER_HOUR);
    const { tenantId } = await resolvePublishedStore(slug);
    const { id, order } = await findGuestOrder(tenantId, input.ref, input.phone);
    if (!canReviewOrder(order.status)) fail('failed-precondition', 'error.onlineOrders.notDelivered');
    const line = order.lines.find((l) => l.productId === input.productId);
    if (!line) fail('failed-precondition', 'error.onlineOrders.notInOrder');

    const review: Omit<ProductReview, 'id'> = {
      productId: line.productId,
      productName: line.name,
      orderRef: order.ref,
      name: publicReviewerName(order.customerName),
      rating: input.rating,
      text,
      status: 'pending',
      createdAtMs: now,
    };
    try {
      await reviewsCol(tenantId).doc(`${id}_${line.productId}`).create({ ...review, updatedAtMs: now });
    } catch (err) {
      if ((err as { code?: unknown }).code === 6) fail('already-exists', 'error.onlineOrders.alreadyReviewed');
      throw err;
    }
    return { ok: true };
  } catch (err) {
    rethrowClientSafe(err);
  }
});

export interface ProductReviewsResponse {
  reviews: PublicReview[];
  summary: ReviewSummary;
}

/** Approved reviews of one visible product, newest first, with the rating summary. */
export const publicProductReviews = onCall(publicFn, async (request): Promise<ProductReviewsResponse> => {
  try {
    const input = parse(productReviewsSchema, stripTransport(request.data));
    const slug = publicSlug(input.slug);
    await rateLimit('productReviews', clientIp(request), Date.now(), REVIEWS_READ_PER_HOUR);
    const { tenantId, config } = await resolvePublishedStore(slug);
    if (!config.visibleProductIds.includes(input.productId)) fail('not-found', 'error.onlineStore.notFound');
    const snap = await reviewsCol(tenantId)
      .where('productId', '==', input.productId)
      .where('status', '==', 'approved')
      .limit(200)
      .get();
    const all = snap.docs.map((d) => toProductReview(d.id, d.data())).sort((a, b) => b.createdAtMs - a.createdAtMs);
    return {
      reviews: all.slice(0, PUBLIC_REVIEWS_MAX).map((r) => ({ name: r.name, rating: r.rating, text: r.text, createdAtMs: r.createdAtMs })),
      summary: summarizeRatings(all.map((r) => r.rating)),
    };
  } catch (err) {
    rethrowClientSafe(err);
  }
});

export interface OnlineReviewsListResponse {
  reviews: ProductReview[];
}

export const onlineReviewsList = onCall({ region: REGION }, (request) =>
  ownerCall(request, async ({ tenantId }, data): Promise<OnlineReviewsListResponse> => {
    const input = parse(reviewsListSchema, data);
    const base = input.status ? reviewsCol(tenantId).where('status', '==', input.status) : reviewsCol(tenantId);
    const snap = await base.orderBy('createdAtMs', 'desc').limit(input.limit ?? LIST_DEFAULT).get();
    return { reviews: snap.docs.map((d: DocumentSnapshot) => toProductReview(d.id, d.data())) };
  }),
);

export interface OnlineReviewStatusResponse {
  review: ProductReview;
}

export const onlineReviewsSetStatus = onCall({ region: REGION }, (request) =>
  ownerCall(request, async ({ tenantId, uid }, data): Promise<OnlineReviewStatusResponse> => {
    const input = parse(reviewSetStatusSchema, data);
    const ref = reviewsCol(tenantId).doc(input.reviewId);
    const now = Date.now();
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) fail('not-found', 'error.onlineOrders.reviewNotFound');
      // Keep the per-product approved totals in step so the catalog can show stars without a query.
      const before = toProductReview(snap.id, snap.data());
      const wasCounted = before.status === 'approved';
      const counts = input.status === 'approved';
      if (wasCounted !== counts && /^[A-Za-z0-9_-]{1,128}$/.test(before.productId) && before.rating >= 1 && before.rating <= 5) {
        const sign = counts ? 1 : -1;
        tx.update(storeRef(tenantId), {
          [`ratings.${before.productId}.count`]: FieldValue.increment(sign),
          [`ratings.${before.productId}.sum`]: FieldValue.increment(sign * before.rating),
        });
      }
      tx.update(ref, { status: input.status, moderatedBy: uid, updatedAtMs: now });
      return { review: { ...toProductReview(snap.id, snap.data()), status: input.status } };
    });
  }),
);

/* ------------------------------------------------------------------ Whish Money */

const PAY_PER_HOUR = 30;

function siteOrigin(): string {
  const raw = (STORE_SITE_ORIGIN.value() || '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(raw) ? raw : 'https://zelvoropos.web.app';
}

/** Public URL of whishCallback (emulator URL when running locally). */
function callbackBase(): string {
  const project = process.env.GCLOUD_PROJECT ?? '';
  return process.env.FUNCTIONS_EMULATOR === 'true'
    ? `http://127.0.0.1:5001/${project}/${REGION}/whishCallback`
    : `https://${REGION}-${project}.cloudfunctions.net/whishCallback`;
}

/** Opens a new Whish payment attempt for an order and returns the page the guest pays on. */
async function startWhish(
  tenantId: string,
  slug: string,
  orderId: string,
  order: Pick<OnlineOrder, 'ref' | 'totalUsdCents' | 'totalLbp'>,
  creds: WhishCreds,
): Promise<string> {
  const currency = order.totalUsdCents >= 100 ? 'USD' : 'LBP';
  const amount = whishAmount(currency, order.totalUsdCents, order.totalLbp);
  if (!amount) fail('failed-precondition', 'error.onlineOrders.paymentAmount');
  const externalId = whishExternalId(Date.now());
  await ordersCol(tenantId).doc(orderId).update({
    whishCurrency: currency,
    whishExternalId: externalId,
    whishAttempts: FieldValue.arrayUnion(externalId),
    updatedAtMs: Date.now(),
  });
  return createWhishPayment(creds, {
    amount,
    currency,
    invoice: `Order ${order.ref}`,
    externalId,
    callbackUrl: `${callbackBase()}?t=${encodeURIComponent(tenantId)}&o=${encodeURIComponent(orderId)}`,
    redirectUrl: `${siteOrigin()}/s/${encodeURIComponent(slug)}?pay=${encodeURIComponent(order.ref)}`,
  });
}

/**
 * Asks Whish how the order's latest payment attempt went and records it. Callbacks, the guest's
 * return page and the owner's inbox all go through here, so a forged callback can only make us
 * ask Whish again; it can never mark an order paid by itself.
 */
async function refreshPayment(tenantId: string, orderId: string): Promise<PaymentStatus> {
  const ref = ordersCol(tenantId).doc(orderId);
  const snap = await ref.get();
  const data = snap.data();
  if (!data) fail('not-found', 'error.onlineOrders.notFound');
  const order = toOnlineOrder(snap.id, data);
  if (order.payment !== 'whish' || order.paymentStatus === 'paid') return order.paymentStatus;
  const externalId = typeof data.whishExternalId === 'string' ? data.whishExternalId : '';
  const currency = data.whishCurrency === 'LBP' ? 'LBP' : 'USD';
  const creds = await loadWhish(tenantId);
  if (!externalId || !creds) return order.paymentStatus;
  const result = await whishStatus(creds, currency, externalId);
  const next = paymentStatusFromWhish(result.status);
  if (next !== order.paymentStatus) {
    const now = Date.now();
    await ref.update({
      paymentStatus: next,
      ...(next === 'paid' ? { payerPhone: result.payerPhone.slice(0, 20), paidAtMs: now } : {}),
      updatedAtMs: now,
      history: FieldValue.arrayUnion({ status: order.status, atMs: now, by: `whish:${next}` }),
    });
  }
  return next;
}

export interface PublicPayResponse {
  ref: string;
  paymentStatus: PaymentStatus;
  /** Present when a new Whish attempt was opened. */
  payUrl?: string;
}

/** Guest: pay (again) for a Whish order, from the receipt or the tracking page. */
export const publicPayOrder = onCall(publicFn, async (request): Promise<PublicPayResponse> => {
  try {
    const input = parse(trackSchema, stripTransport(request.data));
    const slug = publicSlug(input.slug);
    await rateLimit('payOrder', clientIp(request), Date.now(), PAY_PER_HOUR);
    const { tenantId } = await resolvePublishedStore(slug);
    const { id, order } = await findGuestOrder(tenantId, input.ref, input.phone);
    if (order.payment !== 'whish') fail('failed-precondition', 'error.onlineOrders.paymentUnavailable');
    const current = await refreshPayment(tenantId, id);
    if (current === 'paid') return { ref: order.ref, paymentStatus: 'paid' };
    if (order.status === 'cancelled' || order.status === 'rejected') fail('failed-precondition', 'error.onlineOrders.closed');
    const creds = await loadWhish(tenantId);
    if (!creds) fail('failed-precondition', 'error.onlineOrders.paymentUnavailable');
    const payUrl = await startWhish(tenantId, slug, id, order, creds);
    return { ref: order.ref, paymentStatus: current, payUrl };
  } catch (err) {
    rethrowClientSafe(err);
  }
});

/** Guest: where the payment stands (used when Whish sends the guest back to the shop). */
export const publicCheckPayment = onCall(publicFn, async (request): Promise<PublicPayResponse> => {
  try {
    const input = parse(trackSchema, stripTransport(request.data));
    const slug = publicSlug(input.slug);
    await rateLimit('payCheck', clientIp(request), Date.now(), PAY_PER_HOUR * 2);
    const { tenantId } = await resolvePublishedStore(slug);
    const { id, order } = await findGuestOrder(tenantId, input.ref, input.phone);
    return { ref: order.ref, paymentStatus: await refreshPayment(tenantId, id) };
  } catch (err) {
    rethrowClientSafe(err);
  }
});

/** Owner: re-check a Whish order's payment from the inbox. */
export const onlineOrdersCheckPayment = onCall({ region: REGION }, (request) =>
  ownerCall(request, async ({ tenantId }, data): Promise<{ paymentStatus: PaymentStatus }> => {
    const input = parse(z.strictObject({ orderId: idField }), data);
    return { paymentStatus: await refreshPayment(tenantId, input.orderId) };
  }),
);

/**
 * Whish calls this (GET) after each payment attempt. The request is not signed, so it only
 * triggers a status check with the shop's own credentials; it never changes anything by itself.
 */
export const whishCallback = onRequest({ region: REGION, memory: '256MiB', maxInstances: 10 }, async (req, res) => {
  const t = String(req.query.t ?? '');
  const o = String(req.query.o ?? '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(t) || !/^[A-Za-z0-9_-]{1,64}$/.test(o)) {
    res.status(400).send('bad request');
    return;
  }
  try {
    await refreshPayment(t, o);
  } catch (err) {
    console.warn('[whish] callback check failed', t, o, err instanceof Error ? err.message : err);
  }
  res.status(200).send('ok');
});
