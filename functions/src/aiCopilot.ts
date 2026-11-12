/**
 * Zelvero AI copilot — server-enforced data access, scoped per tenant.
 *
 * Rollout policy (hard-coded, no flag, no subscription switch): two paths, both fail closed.
 *   1. The platform Super Admin's own internal demo tenant (unchanged, for internal testing).
 *   2. A real tenant's owner (or a sub-user explicitly granted canUseZelveroAI), only while that
 *      tenant holds a live, active Feature Center entitlement for 'zelvero_ai' (set by Publish +
 *      the customer's own Update action), the platform-wide feature kill switch is off, and the
 *      tenant's subscription is active.
 *
 * Every call re-checks, live, against Firestore and the Auth token claims. The tenant is resolved
 * here from the caller's own token, never from the request body; any tenant/store/uid the client
 * sends is rejected by the strict input schema. Reads only; this module writes nothing.
 *
 * Customer POS functions, Firestore rules, and the existing live AI functions are untouched.
 */
import type { DocumentData } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { auth, db } from './admin.js';
import { subUntilOf } from './claims.js';
import { REGION } from './config.js';
import { fail } from './errors.js';
import { toCashbox, toCustomer, toProduct, toPurchase } from './pos/common.js';
import { caller, parse, type Caller } from './validate.js';

export const AI_MAX_RANGE_DAYS = 400;
export const AI_SALES_RANGE_DAYS = 93;
export const AI_SALES_CAP = 1500;
export const AI_CATALOG_CAP = 2000;
export const AI_PURCHASES_CAP = 500;
export const AI_LIST_CAP = 50;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 90;

const DAILY_FIELDS = [
  'salesCount',
  'revenueUsdCents',
  'costUsdCents',
  'discountUsdCents',
  'cashSalesUsdCents',
  'creditSalesUsdCents',
  'debtCollectedUsdCents',
  'creditIssuedUsdCents',
  'returnsCount',
  'returnsUsdCents',
  'returnsCostUsdCents',
  'expensesUsdCents',
] as const;

/* ------------------------------------------------------------------ authorization */

export interface AiPrincipal {
  uid: string;
  tenantId: string;
}

/** True for the platform super admin's own internal demo tenant, re-checked live. */
async function internalDemoPrincipal(c: Caller): Promise<AiPrincipal | null> {
  if (!c.superAdmin) return null;
  const record = await auth.getUser(c.uid);
  if (record.customClaims?.superAdmin !== true || record.emailVerified !== true || record.disabled === true) {
    return null;
  }
  const tenantId = c.uid;
  const [user, subscription, tenant] = await Promise.all([
    db.doc(`users/${c.uid}`).get(),
    db.doc(`subscriptions/${tenantId}`).get(),
    db.doc(`tenants/${tenantId}`).get(),
  ]);
  if (
    user.get('internalDemo') !== true ||
    user.get('tenantId') !== tenantId ||
    user.get('role') !== 'owner' ||
    user.get('isActive') === false ||
    subscription.get('internalDemo') !== true ||
    !tenant.exists ||
    subUntilOf(subscription.data()) <= Date.now()
  ) {
    return null;
  }
  return { uid: c.uid, tenantId };
}

/**
 * True for a real tenant's owner (or a sub-user explicitly granted canUseZelveroAI), only while
 * that tenant's own Feature Center entitlement for 'zelvero_ai' is active, the platform kill
 * switch is off, and the tenant's subscription is active. Re-checked live on every call.
 */
async function customerAiPrincipal(c: Caller): Promise<AiPrincipal | null> {
  const hasAiPermission = c.role === 'owner' || (c.role === 'subUser' && c.perms.canUseZelveroAI === true);
  if (!c.tenantId || !hasAiPermission || !c.active || !c.emailVerified) return null;
  const tenantId = c.tenantId;
  const [subscription, control, entitlement] = await Promise.all([
    db.doc(`subscriptions/${tenantId}`).get(),
    db.doc('platformFeatureControl/global').get(),
    db.doc(`platformFeatureEntitlements/${tenantId}__zelvero_ai`).get(),
  ]);
  if (
    subUntilOf(subscription.data()) <= Date.now() ||
    control.get('killed') === true ||
    entitlement.get('status') !== 'active'
  ) {
    return null;
  }
  return { uid: c.uid, tenantId };
}

/**
 * Resolves the caller to an AI principal via the internal-demo path or the real-customer path,
 * trying the internal-demo path first. Fails closed (permission-denied) if neither matches.
 * Nothing from the request body is consulted; the tenant always comes from the caller's own token.
 */
export async function resolveAiPrincipal(c: Caller): Promise<AiPrincipal> {
  const principal = (await internalDemoPrincipal(c)) ?? (await customerAiPrincipal(c));
  if (!principal) fail('permission-denied', 'error.fn.notAllowed');
  return principal;
}

const hits = new Map<string, number[]>();
function rateLimit(uid: string, now = Date.now()): void {
  const recent = (hits.get(uid) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) fail('resource-exhausted', 'error.fn.rateLimited');
  recent.push(now);
  hits.set(uid, recent);
}

/* ------------------------------------------------------------------ input */

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Range = z.strictObject({ from: DateStr, to: DateStr });

export const AiReadInput = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('dailyStats'), range: Range }),
  z.strictObject({ op: z.literal('saleLines'), range: Range }),
  z.strictObject({ op: z.literal('catalog') }),
  z.strictObject({ op: z.literal('purchases'), range: Range }),
  z.strictObject({ op: z.literal('suppliers') }),
  z.strictObject({ op: z.literal('settings') }),
  z.strictObject({ op: z.literal('cashbox') }),
  z.strictObject({ op: z.literal('debts') }),
]);
export type AiReadInput = z.infer<typeof AiReadInput>;

function spanDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

function checkRange(range: { from: string; to: string }, maxDays: number): void {
  const days = spanDays(range.from, range.to);
  if (!Number.isFinite(days) || days < 1 || days > maxDays) fail('invalid-argument', 'error.invalidInput');
}

/* ------------------------------------------------------------------ reads */

const col = (t: string, name: string) => db.collection(`tenants/${t}/${name}`);

async function readDailyStats(t: string, from: string, to: string) {
  const snap = await col(t, 'dailyStats').where('date', '>=', from).where('date', '<=', to).orderBy('date', 'asc').limit(1000).get();
  return snap.docs.map((d) => {
    const data = d.data();
    const row: Record<string, number | string | boolean> = { date: String(data.date ?? d.id) };
    for (const f of DAILY_FIELDS) row[f] = typeof data[f] === 'number' ? data[f] : 0;
    row.costsComplete = typeof data.costUsdCents === 'number' && typeof data.returnsCostUsdCents === 'number';
    return row;
  });
}

async function readSaleLines(t: string, from: string, to: string) {
  const snap = await col(t, 'sales').where('localDate', '>=', from).where('localDate', '<=', to).orderBy('localDate', 'asc').limit(AI_SALES_CAP + 1).get();
  const docs = snap.docs.slice(0, AI_SALES_CAP);
  return {
    complete: snap.docs.length <= AI_SALES_CAP,
    sales: docs.map((d) => {
      const data = d.data();
      const items = Array.isArray(data.items) ? (data.items as DocumentData[]) : [];
      return {
        id: d.id,
        soldOn: String(data.localDate ?? ''),
        currency: data.currency === 'LBP' ? 'LBP' : 'USD',
        lines: items.map((i) => ({
          productId: String(i.productId ?? ''),
          name: String(i.name ?? ''),
          quantity: typeof i.quantity === 'number' ? i.quantity : 0,
          returnedQty: typeof i.returnedQty === 'number' ? i.returnedQty : 0,
          unitUsdCents: typeof i.unitUsdCents === 'number' ? i.unitUsdCents : 0,
          unitLbp: typeof i.unitLbp === 'number' ? i.unitLbp : 0,
          // null = no cost was stored on this line. Never turned into zero here.
          costUsdCents: typeof i.costUsdCents === 'number' ? i.costUsdCents : null,
        })),
      };
    }),
  };
}

async function readCatalog(t: string) {
  const snap = await col(t, 'products').where('status', '==', 'active').limit(AI_CATALOG_CAP + 1).get();
  const docs = snap.docs.slice(0, AI_CATALOG_CAP);
  return {
    complete: snap.docs.length <= AI_CATALOG_CAP,
    items: docs.map((d) => {
      const p = toProduct(d.id, d.data());
      const raw = d.data();
      return {
        id: p.id,
        name: p.name,
        barcode: p.barcode,
        stock: p.stock,
        minStock: p.minStock,
        costUsdCents: typeof raw.costUsdCents === 'number' && p.costKnown !== false ? p.costUsdCents : null,
        supplierId: p.supplierId,
        supplierName: p.supplierName,
        expiryDate: p.expiryDate,
      };
    }),
  };
}

async function readPurchases(t: string, from: string, to: string) {
  const snap = await col(t, 'purchases').where('date', '>=', from).where('date', '<=', to).orderBy('date', 'asc').limit(AI_PURCHASES_CAP + 1).get();
  const docs = snap.docs.slice(0, AI_PURCHASES_CAP);
  return {
    complete: snap.docs.length <= AI_PURCHASES_CAP,
    items: docs.map((d) => {
      const p = toPurchase(d.id, d.data());
      return {
        id: p.id,
        supplierId: p.supplierId,
        supplierName: p.supplierName,
        date: p.date,
        totalUsdCents: p.totalUsdCents,
        returnedUsdCents: p.returnedUsdCents,
        paidUsdCents: p.paidUsdCents,
        remainingUsdCents: p.remainingUsdCents,
        items: p.items.map((i) => ({ productId: i.productId, name: i.name, quantity: i.quantity, unitCostUsdCents: i.unitCostUsdCents, returnedQty: i.returnedQty })),
      };
    }),
  };
}

async function readSuppliers(t: string) {
  const snap = await col(t, 'suppliers').limit(AI_PURCHASES_CAP + 1).get();
  return {
    complete: snap.docs.length <= AI_PURCHASES_CAP,
    items: snap.docs.slice(0, AI_PURCHASES_CAP).map((d) => ({
      id: d.id,
      name: String(d.get('name') ?? ''),
      balanceUsdCents: typeof d.get('balanceUsdCents') === 'number' ? (d.get('balanceUsdCents') as number) : 0,
    })),
  };
}

async function readDebts(t: string) {
  const snap = await col(t, 'customers').where('debtUsdCents', '>', 0).orderBy('debtUsdCents', 'desc').limit(AI_LIST_CAP + 1).get();
  return {
    hasMore: snap.docs.length > AI_LIST_CAP,
    items: snap.docs.slice(0, AI_LIST_CAP).map((d) => {
      const c = toCustomer(d.id, d.data());
      return { name: c.name, debtUsdCents: c.debtUsdCents };
    }),
  };
}

export async function runAiRead(tenantId: string, input: AiReadInput): Promise<unknown> {
  switch (input.op) {
    case 'dailyStats':
      checkRange(input.range, AI_MAX_RANGE_DAYS);
      return { days: await readDailyStats(tenantId, input.range.from, input.range.to) };
    case 'saleLines':
      checkRange(input.range, AI_SALES_RANGE_DAYS);
      return readSaleLines(tenantId, input.range.from, input.range.to);
    case 'catalog':
      return readCatalog(tenantId);
    case 'purchases':
      checkRange(input.range, AI_MAX_RANGE_DAYS);
      return readPurchases(tenantId, input.range.from, input.range.to);
    case 'suppliers':
      return readSuppliers(tenantId);
    case 'settings': {
      const snap = await db.doc(`tenants/${tenantId}/settings/main`).get();
      const v = snap.get('lowStockThreshold');
      return { lowStockThreshold: typeof v === 'number' && v >= 0 ? v : null };
    }
    case 'cashbox': {
      const box = toCashbox((await db.doc(`tenants/${tenantId}/cashbox/summary`).get()).data());
      return { usdCents: box.usdCents, lbp: box.lbp };
    }
    case 'debts':
      return readDebts(tenantId);
  }
}

function stripTransport(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;
  const copy = { ...(data as Record<string, unknown>) };
  delete copy.clientApiVersion;
  delete copy.clientReleaseVersion;
  return copy;
}

/* ------------------------------------------------------------------ callables */

/** Live check used by the UI to decide whether to show the assistant. Fails closed. */
export const aiCopilotAccess = onCall({ region: REGION }, async (request) => {
  const principal = await resolveAiPrincipal(caller(request));
  return { allowed: true as const, tenantId: principal.tenantId };
});

/** The only data path for the copilot. Strict, read-only, tenant resolved on the server. */
export const aiCopilotRead = onCall({ region: REGION }, async (request) => {
  const c = caller(request);
  const input = parse(AiReadInput, stripTransport(request.data));
  const principal = await resolveAiPrincipal(c);
  rateLimit(principal.uid);
  return runAiRead(principal.tenantId, input);
});
