import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyCartDraft, priceCart, type Cart } from '@/domain/cart';
import { product } from '@/domain/fixtures.test-utils';
import { sdkEncode, withoutUndefined } from '@/services/callableData';
import type { CheckoutCall, CheckoutResponse } from '@/services/functionsClient';
import { buildCheckoutCall, buildSaleSnapshot } from './checkoutPayload';
import { classifyError, isTransportFailure, retryDelay } from './classify';
import { newSaleOperation, offlineRefFor, resolveOperation, retryOperation } from './operations';
import { openOperationStore, type OperationStore } from './store';
import { cashHeldOffline, summarize, visibleQueue } from './summary';
import { createSyncEngine, LEASE_TTL_MS, MAX_AUTO_RETRIES, PAUSED, SYNCED_RETENTION_MS } from './syncEngine';
import { needsAction, type OfflineOperation } from './types';

const T = 'shop1';
const UID = 'cashier1';
const RATE = 89_500;

let factory: IDBFactory;
let clock: number;
const now = () => clock;

/** Callable-style errors, as thrown by the Firebase SDK. */
const businessError = (key: string, code = 'functions/failed-precondition') => Object.assign(new Error(key), { code, details: { key } });
const networkError = () => Object.assign(new Error('unavailable'), { code: 'functions/unavailable' });

/** Scriptable fake `posCheckout`: records every call and answers from a queue of behaviours. */
function fakeServer() {
  const calls: CheckoutCall[] = [];
  const script: ((p: CheckoutCall) => Promise<CheckoutResponse>)[] = [];
  const recorded = new Set<string>();
  let invoice = 100;
  const ok = async (p: CheckoutCall): Promise<CheckoutResponse> => {
    const duplicate = recorded.has(p.saleId);
    recorded.add(p.saleId);
    return { sale: { invoiceNumber: `INV-${duplicate ? invoice : ++invoice}`, totalUsdCents: p.expectedTotalUsdCents }, duplicate };
  };
  return {
    calls,
    recorded,
    next(...fns: ((p: CheckoutCall) => Promise<CheckoutResponse>)[]) {
      script.push(...fns);
    },
    ok,
    send: (p: CheckoutCall) => {
      calls.push(structuredClone(p));
      return (script.shift() ?? ok)(p);
    },
  };
}

function cartOf(saleId: string, lines: Partial<Cart['lines'][number]>[] = [{}]): Cart {
  return {
    id: '1',
    label: '',
    note: '',
    tier: 'retail',
    currency: 'USD',
    customerId: null,
    debtLineUsdCents: null,
    checkoutDiscountUsdCents: 0,
    checkoutDiscountKind: null,
    saleId,
    draft: emptyCartDraft(),
    lines: lines.map((l, i) => ({ key: String(i), productId: 'p1', name: 'Phone case', tier: 'retail', quantity: 1, customUsdCents: null, imei: null, ...l })),
  };
}

function saleOp(saleId: string, at = clock, overrides: Partial<Parameters<typeof buildSaleSnapshot>[1]> = {}): OfflineOperation {
  const cart = cartOf(saleId);
  const totals = priceCart(cart, new Map([['p1', product()]]), RATE);
  const req = { cart, kind: 'cash' as const, rate: RATE, totals, cash: { receivedUsdCents: totals.productsUsdCents, receivedLbp: 0 } };
  const ctx = { tenantId: T, uid: UID, cashierName: 'Ali', customerName: '', ...overrides };
  return newSaleOperation({ tenantId: ctx.tenantId, uid: ctx.uid, payload: buildCheckoutCall(req), snapshot: buildSaleSnapshot(req, ctx), now: at });
}

async function open(): Promise<OperationStore> {
  return openOperationStore(factory as unknown as globalThis.IDBFactory, 'test-offline');
}

function engine(store: OperationStore, server: ReturnType<typeof fakeServer>, opts: { owner?: string; online?: () => boolean; uid?: string } = {}) {
  return createSyncEngine({
    store,
    send: server.send,
    identity: () => ({ tenantId: T, uid: opts.uid ?? UID }),
    owner: opts.owner ?? 'tabA',
    isOnline: opts.online,
    now,
    random: () => 0.5,
  });
}

beforeEach(() => {
  factory = new IDBFactory();
  clock = 1_800_000_000_000;
});

describe('durable queue (IndexedDB)', () => {
  it('stores a complete offline sale snapshot as PENDING_SYNC with an OFF reference', async () => {
    const store = await open();
    const op = saleOp('saleAbc123');
    await store.add(op);
    const saved = await store.get('saleAbc123');
    expect(saved).toMatchObject({
      status: 'PENDING_SYNC',
      offlineRef: 'OFF-ABC123',
      attempts: 0,
      tenantId: T,
      uid: UID,
      payload: { saleId: 'saleAbc123', offlineRef: 'OFF-ABC123', clientCreatedAtMs: clock, rate: RATE, expectedTotalUsdCents: 500 },
    });
    expect(saved?.payload.lines[0]).toMatchObject({ productId: 'p1', tier: 'retail', quantity: 1, expectedUnitUsdCents: 500, expectedUnitLbp: 500 * 895 });
    expect(saved?.snapshot).toMatchObject({ rate: RATE, totalUsdCents: 500, received: { usdCents: 500, lbp: 0 }, cashierName: 'Ali' });
    expect(saved?.snapshot.lines[0]).toMatchObject({ name: 'Phone case', unitUsdCents: 500, originalUnitUsdCents: 500, customUsdCents: null });
  });

  it('records the displayed override price and LBP price in the snapshot', () => {
    const cart = cartOf('s1', [{ customUsdCents: 450, quantity: 2 }]);
    const totals = priceCart(cart, new Map([['p1', product()]]), RATE);
    const req = { cart, kind: 'cash' as const, rate: RATE, totals, cash: { receivedUsdCents: 900, receivedLbp: 0 } };
    const snap = buildSaleSnapshot(req, { tenantId: T, uid: UID, cashierName: 'Ali', customerName: '' });
    expect(snap.lines[0]).toMatchObject({ unitUsdCents: 450, originalUnitUsdCents: 500, customUsdCents: 450, lineUsdCents: 900 });
    expect(buildCheckoutCall(req).lines[0]).toMatchObject({ customUsdCents: 450, expectedUnitUsdCents: 450 });
  });

  it('D: previous debt is collected without counting as sale revenue', () => {
    const cart = cartOf('prev-only', []);
    cart.customerId = 'cust-1';
    cart.debtLineUsdCents = 10_000;
    cart.lines = [];
    const totals = priceCart(cart, new Map(), RATE);
    const payload = buildCheckoutCall({
      cart,
      kind: 'cash',
      rate: RATE,
      totals,
      cash: { receivedUsdCents: 10_000, receivedLbp: 0 },
    });
    expect(totals.productsUsdCents).toBe(0);
    expect(totals.dueUsdCents).toBe(10_000);
    expect(payload.expectedTotalUsdCents).toBe(0);
    expect(payload.debtLineUsdCents).toBe(10_000);
    expect(payload.lines).toEqual([]);
  });

  it('never overwrites an existing operation (same clientOperationId)', async () => {
    const store = await open();
    await store.add(saleOp('dup1'));
    await expect(store.add(saleOp('dup1'))).rejects.toBeTruthy();
    expect(await store.list()).toHaveLength(1);
  });

  it('survives a page refresh / browser restart (new connection sees the same queue)', async () => {
    const first = await open();
    await first.add(saleOp('keep1'));
    first.close();
    const reopened = await open();
    expect((await reopened.list()).map((o) => o.id)).toEqual(['keep1']);
    const server = fakeServer();
    await engine(reopened, server).syncNow();
    expect((await reopened.get('keep1'))?.status).toBe('SYNCED');
  });

  it('offlineRefFor is stable and uppercase', () => {
    expect(offlineRefFor('aBc9xYz12Q')).toBe('OFF-XYZ12Q');
    expect(offlineRefFor('ab')).toBe('OFF-0000AB');
  });
});

describe('sync engine', () => {
  it('does nothing while offline, then syncs on reconnect and stores the official invoice number', async () => {
    const store = await open();
    await store.add(saleOp('s1'));
    const server = fakeServer();
    let online = false;
    const e = engine(store, server, { online: () => online });
    expect((await e.syncNow()).skipped).toBe('offline');
    expect(server.calls).toHaveLength(0);
    online = true;
    const summary = await e.syncNow();
    expect(summary.synced).toBe(1);
    const op = await store.get('s1');
    expect(op).toMatchObject({ status: 'SYNCED', attempts: 1, result: { invoiceNumber: 'INV-101', duplicate: false } });
    expect(op?.history.map((h) => h.status)).toEqual(['PENDING_SYNC', 'SYNCING', 'SYNCED']);
  });

  it('processes operations in creation order, one at a time', async () => {
    const store = await open();
    await store.add(saleOp('late', clock + 2));
    await store.add(saleOp('early', clock + 1));
    clock += 10;
    const server = fakeServer();
    await engine(store, server).syncNow();
    expect(server.calls.map((c) => c.saleId)).toEqual(['early', 'late']);
  });

  it('network failure keeps the sale PENDING_SYNC with backoff, then resends the SAME id', async () => {
    const store = await open();
    await store.add(saleOp('net1'));
    const server = fakeServer();
    server.next(() => Promise.reject(networkError()));
    const e = engine(store, server);
    const first = await e.syncNow();
    expect(first.interrupted).toBe(true);
    let op = await store.get('net1');
    expect(op).toMatchObject({ status: 'PENDING_SYNC', attempts: 1, transportFailures: 1, lastError: { code: 'unavailable' } });
    expect(op!.nextAttemptAt).toBe(clock + retryDelay(1, () => 0.5));
    expect(op?.history.map((h) => h.status)).toEqual(['PENDING_SYNC', 'SYNCING', 'PENDING_SYNC']);

    await e.syncNow();
    expect(server.calls).toHaveLength(1);

    clock = op!.nextAttemptAt;
    await e.syncNow();
    op = await store.get('net1');
    expect(op).toMatchObject({ status: 'SYNCED', attempts: 2, transportFailures: 0 });
    expect(server.calls.map((c) => c.saleId)).toEqual(['net1', 'net1']);
    expect(server.calls[0]).toEqual(server.calls[1]);
  });

  it('a lost response retried twice produces ONE sale (server answers duplicate)', async () => {
    const store = await open();
    await store.add(saleOp('lost1'));
    const server = fakeServer();
    server.next(async (p) => {
      await server.ok(p);
      throw networkError();
    });
    const e = engine(store, server);
    await e.syncNow();
    clock += 60_000;
    await e.syncNow();
    expect(server.recorded.size).toBe(1);
    expect(await store.get('lost1')).toMatchObject({ status: 'SYNCED', result: { invoiceNumber: 'INV-101', duplicate: true } });
  });

  it('backoff grows exponentially and is capped; retries pause after MAX_AUTO_RETRIES (no endless loop)', async () => {
    expect([1, 2, 3, 4].map((n) => retryDelay(n, () => 0.5))).toEqual([2_000, 4_000, 8_000, 16_000]);
    expect(retryDelay(50, () => 0.5)).toBe(300_000);

    const store = await open();
    await store.add(saleOp('flaky'));
    const server = fakeServer();
    for (let i = 0; i < MAX_AUTO_RETRIES; i++) server.next(() => Promise.reject(networkError()));
    const e = engine(store, server);
    for (let i = 0; i < MAX_AUTO_RETRIES + 5; i++) {
      await e.syncNow();
      clock += 10 * 60_000;
    }
    const op = (await store.get('flaky'))!;
    expect(server.calls).toHaveLength(MAX_AUTO_RETRIES);
    expect(op).toMatchObject({ status: 'PENDING_SYNC', nextAttemptAt: PAUSED, transportFailures: MAX_AUTO_RETRIES });
    expect(needsAction(op)).toBe(true);

    await retryOperation(store, 'flaky', clock);
    await e.syncNow();
    expect(await store.get('flaky')).toMatchObject({ status: 'SYNCED' });
  });

  it('a paused earlier sale does not hold later sales', async () => {
    const store = await open();
    const first = saleOp('first', clock);
    first.nextAttemptAt = PAUSED;
    first.transportFailures = MAX_AUTO_RETRIES;
    await store.add(first);
    await store.add(saleOp('second', clock + 1));
    clock += 5;
    const server = fakeServer();
    const e = engine(store, server);
    await e.syncNow();
    expect(server.calls.map((c) => c.saleId)).toEqual(['second']);
    expect(await store.get('first')).toMatchObject({ status: 'PENDING_SYNC', nextAttemptAt: PAUSED });
    expect((await store.get('second'))?.status).toBe('SYNCED');
  });

  it('a waiting earlier sale blocks later ones (keeps stock priority)', async () => {
    const store = await open();
    await store.add(saleOp('first', clock));
    await store.add(saleOp('second', clock + 1));
    clock += 5;
    const server = fakeServer();
    server.next(() => Promise.reject(networkError()));
    const e = engine(store, server);
    await e.syncNow();
    expect(server.calls.map((c) => c.saleId)).toEqual(['first']);
    expect((await store.get('second'))?.status).toBe('PENDING_SYNC');
  });

  it('business failures become CONFLICT / REJECTED, are never retried automatically, and do not block later sales', async () => {
    const store = await open();
    await store.add(saleOp('c1', clock));
    await store.add(saleOp('r1', clock + 1));
    await store.add(saleOp('ok1', clock + 2));
    clock += 5;
    const server = fakeServer();
    server.next(
      () => Promise.reject(businessError('error.insufficientStock')),
      () => Promise.reject(businessError('error.userInactive', 'functions/permission-denied')),
    );
    const e = engine(store, server);
    const s = await e.syncNow();
    expect(s).toMatchObject({ synced: 1, conflicts: 1, rejected: 1 });
    expect(await store.get('c1')).toMatchObject({ status: 'CONFLICT', reason: 'OUT_OF_STOCK', lastError: { key: 'error.insufficientStock' } });
    expect(await store.get('r1')).toMatchObject({ status: 'REJECTED', reason: 'USER_DISABLED' });
    expect((await store.get('c1'))?.serverResponse).toMatchObject({ key: 'error.insufficientStock' });
    clock += 3_600_000;
    await e.syncNow();
    expect(server.calls).toHaveLength(3);
  });

  it('only sends the signed-in user’s own operations', async () => {
    const store = await open();
    await store.add(saleOp('mine'));
    await store.add({ ...saleOp('theirs'), uid: 'someoneElse' });
    const server = fakeServer();
    await engine(store, server).syncNow();
    expect(server.calls.map((c) => c.saleId)).toEqual(['mine']);
    expect((await store.get('theirs'))?.status).toBe('PENDING_SYNC');
  });

  it('prunes old SYNCED records but never failed ones', async () => {
    const store = await open();
    await store.add(saleOp('old-ok'));
    await store.add(saleOp('old-bad', clock + 1));
    const server = fakeServer();
    server.next(server.ok, () => Promise.reject(businessError('error.pricesChanged')));
    await engine(store, server).syncNow();
    clock += SYNCED_RETENTION_MS + 1;
    await engine(store, server).syncNow();
    expect((await store.list()).map((o) => o.id)).toEqual(['old-bad']);
  });
});

describe('multi-tab safety', () => {
  it('while tab A is syncing, tab B sees the queue but does not submit the same operation', async () => {
    const storeA = await open();
    const storeB = await open();
    await storeA.add(saleOp('shared'));
    const server = fakeServer();
    let release!: () => void;
    server.next((p) => new Promise((resolve) => (release = () => void server.ok(p).then(resolve))));
    const a = engine(storeA, server, { owner: 'tabA' });
    const b = engine(storeB, server, { owner: 'tabB' });

    const pending = a.syncNow();
    await new Promise((r) => setTimeout(r, 20));
    expect((await storeB.get('shared'))?.status).toBe('SYNCING');
    expect((await b.syncNow()).skipped).toBe('busy');
    release();
    await pending;
    await b.syncNow();
    expect(server.calls).toHaveLength(1);
    expect((await storeB.get('shared'))?.status).toBe('SYNCED');
  });

  it('two tabs starting at the same instant: exactly one submits', async () => {
    const [s1, s2] = await Promise.all([open(), open()]);
    await s1.add(saleOp('race'));
    const server = fakeServer();
    await Promise.all([engine(s1, server, { owner: 'tab1' }).syncNow(), engine(s2, server, { owner: 'tab2' }).syncNow()]);
    expect(server.calls).toHaveLength(1);
  });

  it('the atomic claim alone prevents double-processing even if both tabs got past the lease', async () => {
    const store = await open();
    await store.add(saleOp('cas'));
    const claim = () =>
      store.mutate('cas', (cur) => (cur.status === 'PENDING_SYNC' ? { ...cur, status: 'SYNCING', attempts: cur.attempts + 1 } : null));
    const results = await Promise.all([claim(), claim(), claim()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await store.get('cas'))?.attempts).toBe(1);
  });

  it('a crashed tab’s lease expires and the stuck SYNCING sale is recovered and resent with the same id', async () => {
    const store = await open();
    await store.add(saleOp('stuck'));
    const server = fakeServer();
    server.next(() => new Promise<never>(() => undefined));
    void engine(store, server, { owner: 'crashed' }).syncNow();
    await new Promise((r) => setTimeout(r, 20));
    expect((await store.get('stuck'))?.status).toBe('SYNCING');

    const survivor = engine(store, server, { owner: 'survivor' });
    clock += 30_000;
    expect((await survivor.syncNow()).skipped).toBe('busy');
    clock += LEASE_TTL_MS;
    const s = await survivor.syncNow();
    expect(s.synced).toBe(1);
    const op = await store.get('stuck');
    expect(op).toMatchObject({ status: 'SYNCED', attempts: 2 });
    expect(op?.history.some((h) => h.note === 'recovered from an interrupted sync')).toBe(true);
    expect(server.calls.map((c) => c.saleId)).toEqual(['stuck', 'stuck']);
  });

  it('lease: free/expired/own → granted, held by another → refused', async () => {
    const store = await open();
    expect(await store.acquireLease('a', clock, 1_000)).toBe(true);
    expect(await store.acquireLease('b', clock + 500, 1_000)).toBe(false);
    expect(await store.acquireLease('a', clock + 500, 1_000)).toBe(true);
    expect(await store.acquireLease('b', clock + 1_600, 1_000)).toBe(true);
    await store.releaseLease('b');
    expect(await store.acquireLease('a', clock + 1_700, 1_000)).toBe(true);
  });
});

describe('recovery actions and cash visibility', () => {
  async function conflicted(store: OperationStore, id = 'cashSale') {
    await store.add(saleOp(id));
    const server = fakeServer();
    server.next(() => Promise.reject(businessError('error.insufficientStock')));
    await engine(store, server).syncNow();
    return server;
  }

  it('an offline cash sale that later conflicts stays visible as ACTION REQUIRED with its cash', async () => {
    const store = await open();
    await conflicted(store);
    const ops = await store.list();
    expect(summarize(ops)).toMatchObject({ pending: 0, actionRequired: 1 });
    expect(cashHeldOffline(ops)).toEqual({ count: 1, usdCents: 500, lbp: 0 });
  });

  it('dismissing keeps the record (audit) and clears ACTION REQUIRED; a handled record cannot be retried', async () => {
    const store = await open();
    await conflicted(store);
    await resolveOperation(store, 'cashSale', 'dismissed', 'refunded customer', clock);
    const op = (await store.get('cashSale'))!;
    expect(op).toMatchObject({ status: 'CONFLICT', resolution: { action: 'dismissed', note: 'refunded customer' } });
    expect(needsAction(op)).toBe(false);
    expect(summarize([op]).actionRequired).toBe(0);
    expect(await retryOperation(store, 'cashSale', clock)).toBeNull();
    expect(await store.list()).toHaveLength(1);
  });

  it('manual Retry after the cause is fixed sends the same sale again', async () => {
    const store = await open();
    const server = await conflicted(store);
    await retryOperation(store, 'cashSale', clock);
    await engine(store, server).syncNow();
    expect(await store.get('cashSale')).toMatchObject({ status: 'SYNCED' });
    expect(server.calls.map((c) => c.saleId)).toEqual(['cashSale', 'cashSale']);
  });
});

describe('shared-device isolation', () => {
  const ops = () => [
    saleOp('mine'),
    saleOp('colleague', clock, { uid: 'cashier2' }),
    saleOp('otherStore', clock, { tenantId: 'shop2', uid: 'owner2' }),
  ];

  it('a user sees only their own operations; colleagues are a count; other stores are invisible', () => {
    const view = visibleQueue(ops(), { tenantId: T, uid: UID });
    expect(view.own.map((op) => op.id)).toEqual(['mine']);
    expect(view.othersInStore).toBe(1);
    const other = visibleQueue(ops(), { tenantId: 'shop2', uid: 'owner2' });
    expect(other.own.map((op) => op.id)).toEqual(['otherStore']);
    expect(other.othersInStore).toBe(0);
  });

  it("signing in as someone else neither shows nor deletes the previous user's pending sales", async () => {
    const store = await open();
    for (const op of ops()) await store.add(op);
    const server = fakeServer();
    await engine(store, server, { uid: 'cashier2' }).syncNow();
    expect(server.calls.map((c) => c.saleId)).toEqual(['colleague']);
    expect(await store.get('mine')).toMatchObject({ status: 'PENDING_SYNC' });
    expect(await store.list()).toHaveLength(3);
  });
});

describe('long offline session and large reconnect', () => {
  it('keeps 150 queued sales for a several-hour simulated shift, then syncs each id once', async () => {
    const store = await open();
    const started = clock;
    for (let i = 0; i < 150; i += 1) {
      clock = started + i * 90_000;
      await store.add(saleOp(`long${i}`, clock));
    }
    clock = started + 4 * 3_600_000;
    store.close();
    const reopened = await open();
    expect((await reopened.list()).filter((o) => o.status === 'PENDING_SYNC')).toHaveLength(150);
    const loadStarted = Date.now();
    await reopened.list();
    const loadMs = Date.now() - loadStarted;
    const server = fakeServer();
    const syncStarted = Date.now();
    const summary = await engine(reopened, server).syncNow();
    const syncMs = Date.now() - syncStarted;
    expect(summary.synced).toBe(150);
    expect(server.recorded.size).toBe(150);
    expect(new Set(server.calls.map((c) => c.saleId)).size).toBe(150);
    console.info(JSON.stringify({ phaseEPerf: { queue: 150, loadMs, syncMs } }));
  });

  it('measures reconnect of 10 / 50 / 100 queued operations without double replay', async () => {
    const rows: { n: number; ms: number }[] = [];
    for (const n of [10, 50, 100]) {
      factory = new IDBFactory();
      const store = await open();
      for (let i = 0; i < n; i += 1) await store.add(saleOp(`q${n}-${i}`, clock + i));
      clock += n + 10;
      const server = fakeServer();
      const started = Date.now();
      const summary = await engine(store, server).syncNow();
      rows.push({ n, ms: Date.now() - started });
      expect(summary.synced).toBe(n);
      expect(server.calls).toHaveLength(n);
    }
    console.info(JSON.stringify({ phaseEReconnect: rows }));
  });

  it('a conflict in the middle of the queue does not drop later valid sales', async () => {
    const store = await open();
    await store.add(saleOp('ok1', clock));
    await store.add(saleOp('stalePrice', clock + 1));
    await store.add(saleOp('ok2', clock + 2));
    await store.add(saleOp('archived', clock + 3));
    await store.add(saleOp('ok3', clock + 4));
    clock += 10;
    const server = fakeServer();
    server.next(
      server.ok,
      () => Promise.reject(businessError('error.pricesChanged')),
      server.ok,
      () => Promise.reject(businessError('error.productArchived')),
      server.ok,
    );
    const s = await engine(store, server).syncNow();
    expect(s).toMatchObject({ synced: 3, conflicts: 2, rejected: 0 });
    expect((await store.get('ok1'))?.status).toBe('SYNCED');
    expect((await store.get('stalePrice'))?.status).toBe('CONFLICT');
    expect((await store.get('ok2'))?.status).toBe('SYNCED');
    expect((await store.get('archived'))?.status).toBe('CONFLICT');
    expect((await store.get('ok3'))?.status).toBe('SYNCED');
  });

  it('reconnect that drops mid-sync, then reconnects again, still commits each sale once', async () => {
    const store = await open();
    for (let i = 0; i < 8; i += 1) await store.add(saleOp(`dup${i}`, clock + i));
    clock += 20;
    const server = fakeServer();
    server.next(server.ok, server.ok, () => Promise.reject(networkError()));
    const e = engine(store, server);
    await e.syncNow();
    clock += 60_000;
    await e.syncNow();
    expect(server.recorded.size).toBe(8);
    expect((await store.list()).filter((o) => o.status === 'SYNCED')).toHaveLength(8);
  });

  it('operations several days old are not auto-deleted and still conflict correctly', async () => {
    const store = await open();
    await store.add(saleOp('stale-day', clock));
    clock += 3 * 86_400_000;
    const server = fakeServer();
    server.next(() => Promise.reject(businessError('error.insufficientStock')));
    await engine(store, server).syncNow();
    expect(await store.get('stale-day')).toMatchObject({ status: 'CONFLICT', reason: 'OUT_OF_STOCK' });
    expect(await store.list()).toHaveLength(1);
  });
});

describe('callable payload encoding', () => {
  it('a stored cash sale reaches the server with no null placeholders for absent fields', () => {
    const op = saleOp('wire1');
    const wire = sdkEncode(withoutUndefined(op.payload)) as Record<string, unknown>;
    expect('credit' in wire).toBe(false);
    expect(wire.cash).toEqual(op.payload.cash);
    expect(sdkEncode(op.payload)).toHaveProperty('credit', null);
  });

  it('keeps meaningful nulls and nested values', () => {
    expect(withoutUndefined({ a: null, b: undefined, c: [{ d: undefined, e: 1 }] })).toEqual({ a: null, c: [{ e: 1 }] });
  });
});

describe('error classification', () => {
  const cases: [unknown, ReturnType<typeof classifyError>][] = [
    [networkError(), { kind: 'retry' }],
    [Object.assign(new Error('x'), { code: 'functions/deadline-exceeded' }), { kind: 'retry' }],
    [Object.assign(new Error('x'), { code: 'functions/internal' }), { kind: 'retry' }],
    [new TypeError('Failed to fetch'), { kind: 'retry' }],
    [businessError('error.insufficientStock'), { kind: 'conflict', reason: 'OUT_OF_STOCK' }],
    [businessError('error.pricesChanged'), { kind: 'conflict', reason: 'PRICE_CHANGED' }],
    [businessError('error.imeiUnavailable'), { kind: 'conflict', reason: 'IMEI_UNAVAILABLE' }],
    [businessError('error.productArchived'), { kind: 'conflict', reason: 'PRODUCT_ARCHIVED' }],
    [businessError('error.productMissing', 'functions/not-found'), { kind: 'conflict', reason: 'PRODUCT_MISSING' }],
    [businessError('error.credit.creditLimit'), { kind: 'conflict', reason: 'CREDIT_LIMIT' }],
    [businessError('error.rateChanged'), { kind: 'conflict', reason: 'EXCHANGE_RATE_CHANGED' }],
    [businessError('error.debtChanged'), { kind: 'conflict', reason: 'CUSTOMER_CHANGED' }],
    [businessError('error.permissionDenied', 'functions/permission-denied'), { kind: 'rejected', reason: 'PERMISSION_CHANGED' }],
    [businessError('error.userInactive', 'functions/permission-denied'), { kind: 'rejected', reason: 'USER_DISABLED' }],
    [businessError('error.fn.subscriptionInactive'), { kind: 'rejected', reason: 'SUBSCRIPTION_EXPIRED' }],
    [businessError('error.invalidInput', 'functions/invalid-argument'), { kind: 'rejected', reason: 'INVALID' }],
    [Object.assign(new Error('x'), { code: 'functions/permission-denied' }), { kind: 'rejected', reason: 'PERMISSION_CHANGED' }],
    [Object.assign(new Error('x'), { code: 'functions/invalid-argument' }), { kind: 'rejected', reason: 'INVALID' }],
    [businessError('error.somethingNew'), { kind: 'conflict', reason: 'UNKNOWN' }],
  ];
  it.each(cases)('%s → %o', (error, expected) => {
    expect(classifyError(error)).toEqual(expected);
  });

  it('online checkout falls back to the queue ONLY for transport failures', () => {
    expect(isTransportFailure(networkError())).toBe(true);
    expect(isTransportFailure(new TypeError('Failed to fetch'))).toBe(true);
    expect(isTransportFailure(Object.assign(new Error('x'), { code: 'functions/deadline-exceeded' }))).toBe(true);
    expect(isTransportFailure(businessError('error.insufficientStock'))).toBe(false);
    expect(isTransportFailure(businessError('error.permissionDenied', 'functions/permission-denied'))).toBe(false);
    expect(isTransportFailure(businessError('error.fn.subscriptionInactive'))).toBe(false);
    expect(isTransportFailure(Object.assign(new Error('x'), { code: 'functions/permission-denied' }))).toBe(false);
    expect(isTransportFailure(Object.assign(new Error('x'), { code: 'functions/unauthenticated' }))).toBe(false);
  });
});
