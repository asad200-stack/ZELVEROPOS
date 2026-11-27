import { FieldValue, type DocumentData, type Transaction } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db } from '../admin.js';
import { subUntilOf } from '../claims.js';
import { BUSINESS_TIMEZONE, DAY_MS } from '../config.js';
import { fail } from '../errors.js';
import { normalizePermissions, type PermissionKey } from '../permissions.js';
import type {
  CashboxSummary,
  Customer,
  ImeiEntry,
  Product,
  Purchase,
  Sale,
  SaleItem,
  TierPrice,
} from '../shared/models.js';
import { CURRENT_API_COMPAT, clientApiAllowed } from '../shared/release.js';
import { STOCK_LINKS_MAX, isLinked } from '../shared/stockUnits.js';
import { previewBinding } from '../previewContext.js';
import { caller } from '../validate.js';

const MIN_CLIENT_API = CURRENT_API_COMPAT;
const MAX_CLIENT_API = CURRENT_API_COMPAT;

export function assertClientApi(request: CallableRequest): void {
  const raw = request.data as { clientApiVersion?: unknown } | null;
  const version = raw && typeof raw === 'object' ? raw.clientApiVersion : undefined;
  if (!clientApiAllowed(version, MIN_CLIENT_API, MAX_CLIENT_API)) fail('failed-precondition', 'error.updateRequired');
}

/* ================================================================ access */

export interface PosActor {
  tenantId: string;
  uid: string;
  name: string;
  isOwner: boolean;
  can: (perm: PermissionKey) => boolean;
}

/**
 * Authorizes a POS operation from the LIVE profile and subscription (not only the token claims),
 * so a deactivated user, a removed permission or an expired subscription is effective immediately —
 * including for offline sales being synced later (the subscription is checked at sync time).
 * `anyOf`: the caller needs at least one of these permissions (owners have all).
 */
/**
 * Tenant a POS write is allowed to touch. A preview binding, set only inside previewPos,
 * replaces the token tenant. Ordinary calls keep the token tenant.
 */
export function posWriteTenant(request: CallableRequest): string {
  const c = caller(request);
  const bound = previewBinding();
  if (!c.emailVerified) fail('permission-denied', 'error.permissionDenied');
  if (bound) {
    if (bound.uid !== c.uid || !c.superAdmin) fail('permission-denied', 'error.permissionDenied');
    return bound.tenantId;
  }
  if (!c.tenantId) fail('permission-denied', 'error.permissionDenied');
  return c.tenantId;
}

export async function posActor(request: CallableRequest, anyOf: PermissionKey[]): Promise<PosActor> {
  assertClientApi(request);
  const c = caller(request);
  const bound = previewBinding();
  if (!c.emailVerified) fail('permission-denied', 'error.permissionDenied');
  if (!bound && !c.tenantId) fail('permission-denied', 'error.permissionDenied');
  if (!c.active && !bound) fail('permission-denied', 'error.userInactive');
  if (bound && (bound.uid !== c.uid || !c.superAdmin)) fail('permission-denied', 'error.permissionDenied');
  const tenantId = bound ? bound.tenantId : c.tenantId!;
  const [profileSnap, subSnap] = await Promise.all([db.doc(`users/${c.uid}`).get(), db.doc(`subscriptions/${tenantId}`).get()]);
  const profile = profileSnap.data();
  if (!profile || profile.tenantId !== tenantId) fail('permission-denied', 'error.permissionDenied');
  if (bound && (profile.internalDemo !== true || subSnap.get('internalDemo') !== true)) fail('permission-denied', 'error.fn.notAllowed');
  if (profile.isActive === false) fail('permission-denied', 'error.userInactive');

  const isOwner = profile.role === 'owner';
  const perms = normalizePermissions(profile.permissions);
  const can = (perm: PermissionKey) => isOwner || perms[perm];
  if (anyOf.length && !anyOf.some(can)) fail('permission-denied', 'error.permissionDenied');

  if (subUntilOf(subSnap.data()) <= Date.now()) fail('failed-precondition', 'error.fn.subscriptionInactive');

  const name = typeof profile.fullName === 'string' && profile.fullName ? profile.fullName : c.email;
  return { tenantId, uid: c.uid, name, isOwner, can };
}

export function requirePerm(actor: PosActor, perm: PermissionKey): void {
  if (!actor.can(perm)) fail('permission-denied', 'error.permissionDenied');
}

/* ================================================================= input */

export const idField = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const cents = z.number().int().min(0).max(1_000_000_000_00);
export const lbpField = z.number().int().min(0).max(1_000_000_000_000);
export const noteField = z.string().trim().max(300).default('');
/** Client time of an operation created offline (bounded so it can't back-date or future-date data). */
export const clientTimeField = z.number().int().positive().optional();

export function operationTime(clientMs: number | undefined): number {
  const now = Date.now();
  if (clientMs === undefined) return now;
  if (clientMs > now + 5 * 60_000 || clientMs < now - 7 * DAY_MS) return now;
  return clientMs;
}

/* ================================================================= paths */

export const tenantPaths = (t: string) => ({
  col: (name: string) => db.collection(`tenants/${t}/${name}`),
  doc: (name: string, id: string) => db.doc(`tenants/${t}/${name}/${id}`),
  newRef: (name: string) => db.collection(`tenants/${t}/${name}`).doc(),
  settings: db.doc(`tenants/${t}/settings/main`),
  cashbox: db.doc(`tenants/${t}/cashbox/summary`),
  categories: db.doc(`tenants/${t}/lists/categories`),
  counter: (name: 'sales' | 'purchases') => db.doc(`tenants/${t}/counters/${name}`),
  dailyStats: (date: string) => db.doc(`tenants/${t}/dailyStats/${date}`),
});

/* ============================================================ idempotency */

export type ClientOpResult = Record<string, unknown>;

export function isRetryableCommitError(error: unknown): boolean {
  const grpcCode = (error as { code?: unknown }).code;
  return (
    grpcCode === 4 ||
    grpcCode === 10 ||
    grpcCode === 14 ||
    grpcCode === 'DEADLINE_EXCEEDED' ||
    grpcCode === 'ABORTED' ||
    grpcCode === 'UNAVAILABLE' ||
    (typeof grpcCode === 'string' && /deadline|aborted|unavailable/i.test(grpcCode) && grpcCode !== 'failed-precondition')
  );
}

async function replayClientOp(
  tenantId: string,
  opId: string,
  uid: string,
  kind: string,
): Promise<(ClientOpResult & { duplicate: true }) | null> {
  const snap = await tenantPaths(tenantId).doc('clientOps', opId).get();
  if (!snap.exists) return null;
  const data = snap.data()!;
  if (data.createdBy !== uid || data.kind !== kind) fail('already-exists', 'error.alreadyExists');
  const result = data.result && typeof data.result === 'object' ? (data.result as ClientOpResult) : { ok: true };
  return { ...result, duplicate: true };
}

/**
 * Runs a money mutation at most once per `clientOperationId`. A retry after a lost response
 * returns the stored canonical result (including after the user/subscription later becomes inactive).
 */
export async function runClientOp(
  request: CallableRequest,
  opId: string,
  kind: string,
  anyOf: PermissionKey[],
  run: (tx: Transaction, actor: PosActor) => Promise<ClientOpResult>,
  extraAuth?: (actor: PosActor) => void,
): Promise<ClientOpResult & { duplicate: boolean }> {
  const auth = caller(request);
  const tenantId = posWriteTenant(request);
  const early = await replayClientOp(tenantId, opId, auth.uid, kind);
  if (early) return early;
  const opRef = tenantPaths(tenantId).doc('clientOps', opId);
  try {
    const actor = await posActor(request, anyOf);
    extraAuth?.(actor);
    return await db.runTransaction(async (tx) => {
      const existing = await tx.get(opRef);
      if (existing.exists) {
        const data = existing.data()!;
        if (data.createdBy !== actor.uid || data.kind !== kind) fail('already-exists', 'error.alreadyExists');
        const result = data.result && typeof data.result === 'object' ? (data.result as ClientOpResult) : { ok: true };
        return { ...result, duplicate: true };
      }
      const result = await run(tx, actor);
      tx.set(opRef, {
        kind,
        result,
        createdBy: actor.uid,
        createdAtMs: Date.now(),
        createdAt: FieldValue.serverTimestamp(),
      });
      return { ...result, duplicate: false };
    });
  } catch (error) {
    const recovered = await replayClientOp(tenantId, opId, auth.uid, kind);
    if (recovered) return recovered;
    if (isRetryableCommitError(error)) fail('unavailable', 'error.network');
    throw error;
  }
}

/* ================================================================= audit */

/** Business date (YYYY-MM-DD) in the store's time zone. */
export function businessDate(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE.value() || 'Asia/Beirut',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

export function auditFields(actor: PosActor, atMs: number) {
  return {
    createdAt: FieldValue.serverTimestamp(),
    createdAtMs: atMs,
    localDate: businessDate(atMs),
    createdBy: actor.uid,
    createdByName: actor.name,
  };
}

/** Adds to the day's aggregates. Only Cloud Functions write dailyStats. */
export function bumpDailyStats(tx: Transaction, t: string, date: string, deltas: Record<string, number>): void {
  const data: DocumentData = { date, updatedAt: FieldValue.serverTimestamp() };
  for (const [key, value] of Object.entries(deltas)) if (value) data[key] = FieldValue.increment(value);
  tx.set(tenantPaths(t).dailyStats(date), data, { merge: true });
}

/* ============================================================ converters */

const num = (v: unknown, def = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : def);
const int = (v: unknown, def = 0): number => Math.round(num(v, def));
const str = (v: unknown, def = ''): string => (typeof v === 'string' ? v : def);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

const DEFAULT_RATE = 89500;
const DEFAULT_CREDIT_LIMIT = 500_00;

const tierPrice = (v: unknown): TierPrice => {
  const o = (v ?? {}) as DocumentData;
  return { usdCents: int(o.usdCents), lbp: typeof o.lbp === 'number' && o.lbp > 0 ? Math.round(o.lbp) : null };
};

/** Size/colour set fields, only on products that belong to one (see domain/variants). */
function variantFields(d: DocumentData): Pick<Product, 'groupId' | 'groupName' | 'options'> {
  if (typeof d.groupId !== 'string' || !d.groupId) return {};
  const options = Array.isArray(d.options)
    ? (d.options as unknown[])
        .filter((o): o is { name: string; value: string } => !!o && typeof (o as { name?: unknown }).name === 'string' && typeof (o as { value?: unknown }).value === 'string')
        .map((o) => ({ name: o.name, value: o.value }))
    : [];
  return { groupId: d.groupId, groupName: typeof d.groupName === 'string' ? d.groupName : '', options };
}

function galleryField(d: DocumentData): Pick<Product, 'gallery'> {
  if (!Array.isArray(d.gallery)) return {};
  const gallery = (d.gallery as unknown[])
    .filter((x): x is { url: string; path: string } => !!x && typeof (x as { url?: unknown }).url === 'string' && typeof (x as { path?: unknown }).path === 'string')
    .slice(0, 5)
    .map((x) => ({ url: x.url, path: x.path }));
  return gallery.length ? { gallery } : {};
}

function stockLinksField(d: DocumentData): Pick<Product, 'stockLinks'> {
  if (!Array.isArray(d.stockLinks)) return {};
  const links = (d.stockLinks as unknown[])
    .filter(
      (x): x is { productId: string; quantity: number } =>
        !!x && typeof (x as { productId?: unknown }).productId === 'string' && Number.isInteger((x as { quantity?: unknown }).quantity),
    )
    .slice(0, STOCK_LINKS_MAX)
    .map((x) => ({ productId: x.productId, quantity: x.quantity }));
  return links.length ? { stockLinks: links } : {};
}

/** Refuses a direct stock change (purchase, count, return to supplier, web order) on a carton or set. */
export function assertOwnStock(product: Pick<Product, 'name' | 'stockLinks'>): void {
  if (isLinked(product)) fail('failed-precondition', 'error.linkedNoStock', { name: product.name });
}

export function toProduct(id: string, d: DocumentData): Product {
  const prices = (d.prices ?? {}) as DocumentData;
  return {
    id,
    name: str(d.name),
    category: str(d.category),
    barcode: str(d.barcode),
    prices: { retail: tierPrice(prices.retail), wholesale: tierPrice(prices.wholesale), vip: tierPrice(prices.vip) },
    costUsdCents: int(d.costUsdCents),
    costKnown: d.costKnown !== false,
    stock: int(d.stock),
    minStock: typeof d.minStock === 'number' ? d.minStock : null,
    supplierId: strOrNull(d.supplierId),
    supplierName: str(d.supplierName),
    expiryDate: strOrNull(d.expiryDate),
    imageUrl: strOrNull(d.imageUrl),
    imagePath: strOrNull(d.imagePath),
    imeiTracking: d.imeiTracking === true,
    imeis: arr<ImeiEntry>(d.imeis).filter((e) => e && typeof e.imei === 'string'),
    lastMovementId: strOrNull(d.lastMovementId),
    ...variantFields(d),
    ...galleryField(d),
    ...stockLinksField(d),
    status: d.status === 'archived' ? 'archived' : 'active',
    archivedAt: null,
    createdAt: null,
    updatedAt: null,
  };
}

export function toCustomer(id: string, d: DocumentData): Customer {
  return {
    id,
    name: str(d.name),
    phone: str(d.phone),
    email: str(d.email),
    address: str(d.address),
    creditLimitUsdCents: int(d.creditLimitUsdCents, DEFAULT_CREDIT_LIMIT),
    debtUsdCents: int(d.debtUsdCents),
    totalPurchasesUsdCents: int(d.totalPurchasesUsdCents),
    lastLedgerId: strOrNull(d.lastLedgerId),
    createdAt: null,
    updatedAt: null,
  };
}

function toSaleItem(i: DocumentData): SaleItem {
  return {
    productId: str(i.productId),
    name: str(i.name),
    quantity: int(i.quantity),
    tier: str(i.tier, 'retail') as SaleItem['tier'],
    unitUsdCents: int(i.unitUsdCents),
    unitLbp: int(i.unitLbp),
    originalUnitUsdCents: int(i.originalUnitUsdCents),
    discountUsdCents: int(i.discountUsdCents),
    costUsdCents: int(i.costUsdCents),
    imei: strOrNull(i.imei),
    returnedQty: int(i.returnedQty),
  };
}

export function toSale(id: string, d: DocumentData): Sale {
  const p = (d.payment ?? {}) as DocumentData;
  return {
    id,
    invoiceNumber: str(d.invoiceNumber),
    kind: d.kind === 'credit' ? 'credit' : 'cash',
    currency: d.currency === 'LBP' ? 'LBP' : 'USD',
    exchangeRate: num(d.exchangeRate, DEFAULT_RATE),
    items: arr<DocumentData>(d.items).map(toSaleItem),
    totalUsdCents: int(d.totalUsdCents),
    totalLbp: int(d.totalLbp),
    discountUsdCents: int(d.discountUsdCents),
    checkoutDiscountUsdCents: int(d.checkoutDiscountUsdCents),
    checkoutDiscountLbp: int(d.checkoutDiscountLbp),
    checkoutDiscountKind: d.checkoutDiscountKind === 'fixed' || d.checkoutDiscountKind === 'roundDown' ? d.checkoutDiscountKind : null,
    payableUsdCents: int(d.payableUsdCents),
    payableLbp: int(d.payableLbp),
    costUsdCents: int(d.costUsdCents),
    customerId: strOrNull(d.customerId),
    customerName: str(d.customerName),
    orderLabel: str(d.orderLabel),
    note: str(d.note),
    payment: {
      receivedUsdCents: int(p.receivedUsdCents),
      receivedLbp: int(p.receivedLbp),
      changeUsdCents: int(p.changeUsdCents),
      changeLbp: int(p.changeLbp),
      previousDebtUsdCents: int(p.previousDebtUsdCents),
      settledPreviousUsdCents: int(p.settledPreviousUsdCents),
      unpaidUsdCents: int(p.unpaidUsdCents),
      debtAddedUsdCents: int(p.debtAddedUsdCents),
      debtAfterUsdCents: typeof p.debtAfterUsdCents === 'number' ? p.debtAfterUsdCents : null,
    },
    returnedUsdCents: int(d.returnedUsdCents),
    returnedDebtUsdCents: int(d.returnedDebtUsdCents),
    refundedUsdCents: int(d.refundedUsdCents),
    refundedLbp: int(d.refundedLbp),
    returnStatus: d.returnStatus === 'full' || d.returnStatus === 'partial' ? d.returnStatus : 'none',
    lastReturnId: strOrNull(d.lastReturnId),
    offline: d.offline === true,
    localDate: str(d.localDate),
    createdAt: int(d.createdAtMs),
    createdBy: str(d.createdBy),
    createdByName: str(d.createdByName),
  };
}

export function toPurchase(id: string, d: DocumentData): Purchase {
  return {
    id,
    number: str(d.number),
    supplierId: str(d.supplierId),
    supplierName: str(d.supplierName),
    date: str(d.date),
    dueDate: strOrNull(d.dueDate),
    items: arr<DocumentData>(d.items).map((i) => ({
      productId: str(i.productId),
      name: str(i.name),
      quantity: int(i.quantity),
      unitCostUsdCents: int(i.unitCostUsdCents),
      returnedQty: int(i.returnedQty),
    })),
    totalUsdCents: int(d.totalUsdCents),
    returnedUsdCents: int(d.returnedUsdCents),
    paidUsdCents: int(d.paidUsdCents),
    remainingUsdCents: int(d.remainingUsdCents),
    status: str(d.status, 'unpaid') as Purchase['status'],
    updateCost: d.updateCost === true,
    note: str(d.note),
    createdAt: int(d.createdAtMs),
    createdBy: str(d.createdBy),
    createdByName: str(d.createdByName),
  };
}

export function toCashbox(d: DocumentData | undefined): CashboxSummary {
  return { usdCents: int(d?.usdCents), lbp: int(d?.lbp), lastTxId: strOrNull(d?.lastTxId), updatedAt: null };
}

export function exchangeRateOf(settings: DocumentData | undefined): number {
  const rate = int(settings?.exchangeRate, DEFAULT_RATE);
  return rate > 0 ? rate : DEFAULT_RATE;
}

/** Replaces FieldValue sentinels so a written document can be returned to the client as JSON. */
export function plain(data: DocumentData, atMs: number): DocumentData {
  const out: DocumentData = {};
  for (const [k, v] of Object.entries(data)) out[k] = v instanceof FieldValue ? atMs : v;
  return out;
}
