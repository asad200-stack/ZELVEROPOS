import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { IDBFactory } from 'fake-indexeddb';
import { deleteDoc, doc, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { emptyCartDraft, priceCart, type Cart, type CartLine } from '@/domain/cart';
import { product } from '@/domain/fixtures.test-utils';
import { buildCheckoutCall, buildSaleSnapshot } from '@/offline/checkoutPayload';
import { newSaleOperation } from '@/offline/operations';
import { openOperationStore, type OperationStore } from '@/offline/store';
import { cashHeldOffline, summarize } from '@/offline/summary';
import { createSyncEngine } from '@/offline/syncEngine';
import { needsAction, type OfflineOperation } from '@/offline/types';
import { sdkEncode, withoutUndefined } from '@/services/callableData';
import type { CheckoutCall, CheckoutResponse } from '@/services/functionsClient';
import type { Product } from '@/types/models';
import { asAdmin, call, callOk, clearAuth, createEnv, createUser, DAY, RATE, readDoc, readWhere, seedTenant, T, tp, type SeedProfile } from './helpers';

/**
 * Offline queue ↔ server: the REAL sync engine and IndexedDB store (fake-indexeddb) sending through
 * the REAL `posCheckout` in the Functions emulator, with the world changing between capture and sync.
 */

let env: RulesTestEnvironment;
const tokens: Record<string, string> = {};
const STAFF: SeedProfile[] = [
  { uid: 'offA', role: 'subUser', permissions: { canSell: true } },
  { uid: 'offB', role: 'subUser', permissions: { canSell: true } },
];

async function seed() {
  await env.clearFirestore();
  await seedTenant(env, T, [{ uid: T, role: 'owner' }, ...STAFF]);
}

beforeAll(async () => {
  env = await createEnv();
  await clearAuth();
  tokens[T] = await createUser({ uid: T, tenantId: T, role: 'owner' });
  for (const s of STAFF) tokens[s.uid] = await createUser({ uid: s.uid, tenantId: T, role: 'subUser', perms: s.permissions });
});
afterAll(async () => {
  await env?.cleanup();
});
beforeEach(seed);

/* ---------------------------------------------------------------- harness */

/** Local copies of the seeded products, as the POS would have them in its offline cache. */
const CATALOG = new Map<string, Product>([
  ['p1', product({ id: 'p1', name: 'Phone case', prices: { retail: { usdCents: 500, lbp: null }, wholesale: { usdCents: 0, lbp: null }, vip: { usdCents: 0, lbp: null } } })],
  [
    'ph',
    product({
      id: 'ph',
      name: 'Phone',
      stock: 2,
      prices: { retail: { usdCents: 20_000, lbp: null }, wholesale: { usdCents: 0, lbp: null }, vip: { usdCents: 0, lbp: null } },
      imeiTracking: true,
      imeis: [
        { imei: '111', status: 'available' },
        { imei: '222', status: 'available' },
      ],
    }),
  ],
  ['p3', product({ id: 'p3', name: 'Cable', prices: { retail: { usdCents: 300, lbp: null }, wholesale: { usdCents: 0, lbp: null }, vip: { usdCents: 0, lbp: null } } })],
]);

/** Same shape of error the Firebase SDK throws for a callable failure. */
function sdkError(status: string, key?: string, params?: unknown) {
  return Object.assign(new Error(key ?? status), { code: `functions/${status.toLowerCase().replace(/_/g, '-')}`, details: key ? { key, params } : undefined });
}

/** Sends exactly what the browser client puts on the wire (see `callable` in functionsClient). */
function sendAs(token: string, counter?: { n: number }) {
  return async (payload: CheckoutCall): Promise<CheckoutResponse> => {
    if (counter) counter.n += 1;
    const { result, error } = await call<CheckoutResponse>(token, 'posCheckout', sdkEncode(withoutUndefined(payload)));
    if (error) throw sdkError(error.status, error.key?.startsWith('error.') ? error.key : undefined, error.params);
    return result!;
  };
}

let seq = 0;
interface Device {
  uid: string;
  store: OperationStore;
  sync: () => ReturnType<ReturnType<typeof createSyncEngine>['syncNow']>;
  sellOffline: (lines: Partial<CartLine>[], opts?: { kind?: 'cash' | 'credit'; customerId?: string; paid?: number }) => Promise<OfflineOperation>;
  op: (id: string) => Promise<OfflineOperation | undefined>;
}

async function device(uid: string, opts: { factory?: InstanceType<typeof IDBFactory>; send?: (p: CheckoutCall) => Promise<CheckoutResponse>; owner?: string } = {}): Promise<Device> {
  const store = await openOperationStore((opts.factory ?? new IDBFactory()) as unknown as globalThis.IDBFactory, 'zelvero-offline');
  const engine = createSyncEngine({
    store,
    send: opts.send ?? sendAs(tokens[uid]!),
    identity: () => ({ tenantId: T, uid }),
    owner: opts.owner ?? `${uid}-tab`,
  });
  return {
    uid,
    store,
    sync: () => engine.syncNow(),
    op: (id) => store.get(id),
    async sellOffline(lines, o = {}) {
      seq += 1;
      const cart: Cart = {
        id: '1',
        label: '',
        note: '',
        tier: 'retail',
        currency: 'USD',
        customerId: o.customerId ?? null,
        debtLineUsdCents: null,
        saleId: `off${Date.now()}${seq}`,
        draft: emptyCartDraft(),
        lines: lines.map((l, i) => ({ key: String(i), productId: 'p1', name: '', tier: 'retail', quantity: 1, customUsdCents: null, imei: null, ...l })),
      };
      const totals = priceCart(cart, CATALOG, RATE);
      const kind = o.kind ?? 'cash';
      const req = {
        cart,
        kind,
        rate: RATE,
        totals,
        cash: kind === 'cash' ? { receivedUsdCents: totals.productsUsdCents, receivedLbp: 0 } : undefined,
        credit: kind === 'credit' ? { paidUsdCents: o.paid ?? 0, paidLbp: 0 } : undefined,
      };
      const op = newSaleOperation({
        tenantId: T,
        uid,
        payload: buildCheckoutCall(req),
        snapshot: buildSaleSnapshot(req, { tenantId: T, uid, cashierName: uid, customerName: o.customerId ? 'Ali' : '' }),
        now: Date.now(),
      });
      await store.add(op);
      return op;
    },
  };
}

const stock = async (id = 'p1') => Number((await readDoc(env, tp(T, 'products', id)))?.stock);
const drawer = async () => Number((await readDoc(env, tp(T, 'cashbox', 'summary')))?.usdCents);
const admin = (fn: Parameters<typeof asAdmin>[1]) => asAdmin(env, fn);

/* ------------------------------------------------------------------ tests */

describe('offline sale → reconnect → server', () => {
  it('syncs through posCheckout: official invoice stored locally, OFF ref linked on the server, stock and drawer updated', async () => {
    const a = await device('offA');
    const op = await a.sellOffline([{ quantity: 2 }]);
    expect(await stock()).toBe(10);
    expect(await drawer()).toBe(10_000);
    expect(await readWhere(env, tp(T, 'sales'), 'offlineRef', op.offlineRef)).toHaveLength(0);

    expect((await a.sync()).synced).toBe(1);
    const synced = await a.op(op.id);
    expect(synced).toMatchObject({ status: 'SYNCED', result: { invoiceNumber: 'INV-005', totalUsdCents: 1_000, duplicate: false } });
    const sale = await readDoc(env, tp(T, 'sales', op.id));
    expect(sale).toMatchObject({ invoiceNumber: 'INV-005', offline: true, offlineRef: op.offlineRef, createdBy: 'offA', createdAtMs: op.createdAt });
    expect(await stock()).toBe(8);
    expect(await drawer()).toBe(11_000);
  });

  it('the same clientOperationId sent twice (lost response) creates exactly ONE sale', async () => {
    let lost = true;
    const real = sendAs(tokens.offA!);
    const a = await device('offA', {
      send: async (p) => {
        const res = await real(p);
        if (lost) {
          lost = false;
          throw new TypeError('Failed to fetch');
        }
        return res;
      },
    });
    const op = await a.sellOffline([{ quantity: 1 }]);
    await a.sync();
    expect((await a.op(op.id))?.status).toBe('PENDING_SYNC');
    await a.store.mutate(op.id, (cur) => ({ ...cur, nextAttemptAt: 0 }));
    await a.sync();
    expect(await a.op(op.id)).toMatchObject({ status: 'SYNCED', attempts: 2, result: { duplicate: true, invoiceNumber: 'INV-005' } });
    expect(await readWhere(env, tp(T, 'sales'), 'offlineRef', op.offlineRef)).toHaveLength(1);
    expect(await stock()).toBe(9);
    expect(await drawer()).toBe(10_500);
  });

  it('network failure during sync leaves the sale PENDING_SYNC, and it syncs on the next pass', async () => {
    let down = true;
    const real = sendAs(tokens.offA!);
    const a = await device('offA', { send: (p) => (down ? Promise.reject(new TypeError('Failed to fetch')) : real(p)) });
    const op = await a.sellOffline([{}]);
    const s = await a.sync();
    expect(s.interrupted).toBe(true);
    expect(await a.op(op.id)).toMatchObject({ status: 'PENDING_SYNC', transportFailures: 1, lastError: { code: 'network' } });
    expect(await stock()).toBe(10);
    down = false;
    await a.store.mutate(op.id, (cur) => ({ ...cur, nextAttemptAt: 0 }));
    await a.sync();
    expect((await a.op(op.id))?.status).toBe('SYNCED');
    expect(await stock()).toBe(9);
  });

  it('two tabs of the same device: only one submits the queued sale', async () => {
    const factory = new IDBFactory();
    const counter = { n: 0 };
    const tab1 = await device('offA', { factory, owner: 'tab1', send: sendAs(tokens.offA!, counter) });
    const tab2 = await device('offA', { factory, owner: 'tab2', send: sendAs(tokens.offA!, counter) });
    const op = await tab1.sellOffline([{}]);
    const [r1, r2] = await Promise.all([tab1.sync(), tab2.sync()]);
    expect(r1.synced + r2.synced).toBe(1);
    expect(counter.n).toBe(1);
    expect((await tab2.op(op.id))?.status).toBe('SYNCED');
    expect(await stock()).toBe(9);
  });
});

describe('the world changed before sync → CONFLICT', () => {
  it('two offline devices compete for the last unit: one SYNCED, the other OUT_OF_STOCK conflict', async () => {
    await admin((fs) => updateDoc(doc(fs, tp(T, 'products', 'p1')), { stock: 1 }));
    const a = await device('offA');
    const b = await device('offB');
    const opA = await a.sellOffline([{}]);
    const opB = await b.sellOffline([{}]);
    await a.sync();
    await b.sync();
    expect((await a.op(opA.id))?.status).toBe('SYNCED');
    expect(await b.op(opB.id)).toMatchObject({ status: 'CONFLICT', reason: 'OUT_OF_STOCK', lastError: { key: 'error.insufficientStock' } });
    expect(await stock()).toBe(0);
    expect(await drawer()).toBe(10_500);
  });

  it('an offline cash sale that conflicts stays ACTION REQUIRED and keeps the cash-taken warning', async () => {
    await admin((fs) => updateDoc(doc(fs, tp(T, 'products', 'p1')), { stock: 0 }));
    const a = await device('offA');
    await a.sellOffline([{ quantity: 1 }]);
    await a.sync();
    const ops = await a.store.list();
    expect(summarize(ops).actionRequired).toBe(1);
    expect(cashHeldOffline(ops)).toMatchObject({ count: 1, usdCents: 500 });
    await a.sync();
    expect((await a.store.list())[0]?.attempts).toBe(1);
  });

  it('product archived before sync → PRODUCT_ARCHIVED', async () => {
    const a = await device('offA');
    const op = await a.sellOffline([{}]);
    await callOk(tokens[T]!, 'posSetProductStatus', { productId: 'p1', status: 'archived' });
    await a.sync();
    expect(await a.op(op.id)).toMatchObject({ status: 'CONFLICT', reason: 'PRODUCT_ARCHIVED' });
    expect(await stock()).toBe(10);
  });

  it('product deleted before sync → PRODUCT_MISSING', async () => {
    await admin((fs) => setDoc(doc(fs, tp(T, 'products', 'p3')), { name: 'Cable', prices: { retail: { usdCents: 300, lbp: null } }, stock: 5, imeis: [], costUsdCents: 100 }));
    const a = await device('offA');
    const op = await a.sellOffline([{ productId: 'p3' }]);
    await admin((fs) => deleteDoc(doc(fs, tp(T, 'products', 'p3'))));
    await a.sync();
    expect(await a.op(op.id)).toMatchObject({ status: 'CONFLICT', reason: 'PRODUCT_MISSING' });
  });

  it('price changed before sync → PRICE_CHANGED (never silently charged a different amount)', async () => {
    const a = await device('offA');
    const op = await a.sellOffline([{}]);
    await admin((fs) => updateDoc(doc(fs, tp(T, 'products', 'p1')), { 'prices.retail.usdCents': 600 }));
    await a.sync();
    expect(await a.op(op.id)).toMatchObject({ status: 'CONFLICT', reason: 'PRICE_CHANGED' });
    expect(await readDoc(env, tp(T, 'sales', op.id))).toBeUndefined();
  });

  it('per-line price check: one price up and one down with the SAME total is still PRICE_CHANGED', async () => {
    await admin((fs) => setDoc(doc(fs, tp(T, 'products', 'p3')), { name: 'Cable', prices: { retail: { usdCents: 300, lbp: null } }, stock: 5, imeis: [], costUsdCents: 100 }));
    const a = await device('offA');
    const op = await a.sellOffline([{}, { productId: 'p3' }]);
    await admin(async (fs) => {
      await updateDoc(doc(fs, tp(T, 'products', 'p1')), { 'prices.retail.usdCents': 600 });
      await updateDoc(doc(fs, tp(T, 'products', 'p3')), { 'prices.retail.usdCents': 200 });
    });
    await a.sync();
    expect(await a.op(op.id)).toMatchObject({ status: 'CONFLICT', reason: 'PRICE_CHANGED' });
  });

  it('exchange rate changed before sync → EXCHANGE_RATE_CHANGED', async () => {
    const a = await device('offA');
    const op = await a.sellOffline([{}]);
    await admin((fs) => updateDoc(doc(fs, tp(T, 'settings', 'main')), { exchangeRate: 90_000 }));
    await a.sync();
    expect(await a.op(op.id)).toMatchObject({ status: 'CONFLICT', reason: 'EXCHANGE_RATE_CHANGED' });
  });

  it('IMEI sold elsewhere before sync → IMEI_UNAVAILABLE', async () => {
    const a = await device('offA');
    const op = await a.sellOffline([{ productId: 'ph', imei: '111' }]);
    await callOk(tokens.offB!, 'posCheckout', {
      saleId: `online${Date.now()}`,
      kind: 'cash',
      currency: 'USD',
      rate: RATE,
      customerId: null,
      debtLineUsdCents: null,
      lines: [{ productId: 'ph', tier: 'retail', quantity: 1, customUsdCents: null, imei: '111' }],
      expectedTotalUsdCents: 20_000,
      cash: { receivedUsdCents: 20_000, receivedLbp: 0 },
    });
    await a.sync();
    expect(await a.op(op.id)).toMatchObject({ status: 'CONFLICT', reason: 'IMEI_UNAVAILABLE' });
    expect(await stock('ph')).toBe(1);
  });

  it('customer credit limit lowered before sync → CREDIT_LIMIT', async () => {
    const a = await device('offA');
    const op = await a.sellOffline([{ quantity: 2 }], { kind: 'credit', customerId: 'c1', paid: 0 });
    await admin((fs) => updateDoc(doc(fs, tp(T, 'customers', 'c1')), { creditLimitUsdCents: 3_500 }));
    await a.sync();
    expect(await a.op(op.id)).toMatchObject({ status: 'CONFLICT', reason: 'CREDIT_LIMIT' });
    expect((await readDoc(env, tp(T, 'customers', 'c1')))?.debtUsdCents).toBe(3_000);
  });
});

describe('identity / subscription changed before sync → REJECTED (never retried as network)', () => {
  it('cashier deactivated → USER_DISABLED', async () => {
    const a = await device('offA');
    const op = await a.sellOffline([{}]);
    await admin((fs) => updateDoc(doc(fs, 'users/offA'), { isActive: false }));
    await a.sync();
    const rejected = await a.op(op.id);
    expect(rejected).toMatchObject({ status: 'REJECTED', reason: 'USER_DISABLED', lastError: { code: 'permission-denied', key: 'error.userInactive' } });
    expect(needsAction(rejected!)).toBe(true);
    expect(await stock()).toBe(10);
  });

  it('selling permission removed → PERMISSION_CHANGED (live profile beats cached token claims)', async () => {
    const a = await device('offA');
    const op = await a.sellOffline([{}]);
    await admin((fs) => updateDoc(doc(fs, 'users/offA'), { permissions: { canViewSales: true } }));
    await a.sync();
    expect(await a.op(op.id)).toMatchObject({ status: 'REJECTED', reason: 'PERMISSION_CHANGED' });
  });

  it('subscription expired → SUBSCRIPTION_EXPIRED', async () => {
    const a = await device('offA');
    const op = await a.sellOffline([{}]);
    await admin((fs) => updateDoc(doc(fs, `subscriptions/${T}`), { endsAt: Timestamp.fromMillis(Date.now() - DAY) }));
    await a.sync();
    expect(await a.op(op.id)).toMatchObject({ status: 'REJECTED', reason: 'SUBSCRIPTION_EXPIRED' });
    expect(await stock()).toBe(10);
  });
});

describe('server-side guards on offline payloads', () => {
  it('a malformed offline reference is refused as invalid', async () => {
    const { error } = await call(tokens.offA!, 'posCheckout', {
      saleId: `bad${Date.now()}`,
      kind: 'cash',
      currency: 'USD',
      rate: RATE,
      customerId: null,
      debtLineUsdCents: null,
      lines: [{ productId: 'p1', tier: 'retail', quantity: 1, customUsdCents: null, imei: null }],
      expectedTotalUsdCents: 500,
      cash: { receivedUsdCents: 500, receivedLbp: 0 },
      offlineRef: 'INV-005',
    });
    expect(error?.status).toBe('INVALID_ARGUMENT');
  });
});
