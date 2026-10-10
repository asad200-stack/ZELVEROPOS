/**
 * Phase D concurrency stress against the local emulator only.
 * Business corruption stops the rest of this file. Emulator timeouts are recorded separately.
 */
import { appendFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { assertFails } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { lbpToUsdCents } from '@/domain/money';
import {
  asAdmin,
  clearAuth,
  createEnv,
  createUser,
  DAY,
  PROJECT_ID,
  RATE,
  seedTenant,
  settleUntil,
  tp,
  type SeedProfile,
} from './helpers';

const METRICS = join(tmpdir(), 'zelvero-phase-d.jsonl');
const INFRA =
  /INTERNAL|UNAVAILABLE|DEADLINE|UNAUTHENTICATED|RESOURCE_EXHAUSTED|ABORTED|CANCELLED|ECONNRESET|ECONNREFUSED|socket|fetch failed|invalid-json|network|error\.network|Too many|lock|contention/i;

const TENANT = 'dConc';
const FUNCTIONS = 'http://127.0.0.1:5001';
const USERS = 50;
const CASHIERS: SeedProfile[] = Array.from({ length: USERS }, (_, i) => ({
  uid: `dC${i}`,
  role: 'subUser' as const,
  permissions: { canSell: true },
}));
const MANAGER: SeedProfile = {
  uid: 'dMgr',
  role: 'subUser',
  permissions: {
    canSell: true,
    canViewSales: true,
    canManageCashDrawer: true,
    canViewCustomers: true,
    canViewSuppliers: true,
    canViewProducts: true,
    canEditProducts: true,
  },
};

let env: RulesTestEnvironment;
let halted: string | null = null;
const tokens: string[] = [];
let manager = '';

type Doc = { id: string } & Record<string, unknown>;
interface Books {
  sales: Doc[];
  returns: Doc[];
  movements: Doc[];
  cash: Doc[];
  ledger: Doc[];
  stats: Doc[];
  purchases: Doc[];
  supplierPayments: Doc[];
  purchaseReturns: Doc[];
  products: Doc[];
  box: Record<string, unknown>;
  customer: Record<string, unknown>;
  supplier: Record<string, unknown>;
  counter: Record<string, unknown>;
}

interface Attempt {
  id: string;
  ms: number;
  ok: boolean;
  business: boolean;
  technical: boolean;
  timeout: boolean;
  retry: boolean;
  invoice: string | null;
  duplicate: boolean | null;
  error: string | null;
  thrown: string | null;
}

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const items = (doc: Doc) => (Array.isArray(doc.items) ? (doc.items as Record<string, unknown>[]) : []);
const payment = (doc: Doc) => (doc.payment && typeof doc.payment === 'object' ? (doc.payment as Record<string, unknown>) : {});

function halt(reason: string): never {
  halted = reason;
  appendFileSync(METRICS, `${JSON.stringify({ phaseDStop: reason })}\n`);
  throw new Error(`PHASE D STOP: ${reason}`);
}

function tokenFor(uid: string): string {
  if (uid === MANAGER.uid) return manager;
  const index = CASHIERS.findIndex((cashier) => cashier.uid === uid);
  return index >= 0 ? tokens[index]! : tokens[0]!;
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? null;
}

async function reset() {
  await env.clearFirestore();
  await seedTenant(env, TENANT, [{ uid: TENANT, role: 'owner' }, MANAGER, ...CASHIERS]);
}

async function load(): Promise<Books> {
  return asAdmin(env, async (fs) => {
    const rows = async (name: string) =>
      (await getDocs(collection(fs, tp(TENANT, name)))).docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
    const one = async (...parts: string[]) => (await getDoc(doc(fs, tp(TENANT, ...parts)))).data() as Record<string, unknown> | undefined;
    const [sales, returns, movements, cash, ledger, stats, purchases, supplierPayments, purchaseReturns, products, box, customer, supplier, counter] =
      await Promise.all([
        rows('sales'),
        rows('returns'),
        rows('stockMovements'),
        rows('cashTransactions'),
        rows('customerLedger'),
        rows('dailyStats'),
        rows('purchases'),
        rows('supplierPayments'),
        rows('purchaseReturns'),
        rows('products'),
        one('cashbox', 'summary'),
        one('customers', 'c1'),
        one('suppliers', 'sup1'),
        one('counters', 'sales'),
      ]);
    return {
      sales,
      returns,
      movements,
      cash,
      ledger,
      stats,
      purchases,
      supplierPayments,
      purchaseReturns,
      products,
      box: box ?? {},
      customer: customer ?? {},
      supplier: supplier ?? {},
      counter: counter ?? {},
    };
  });
}

function keyOf(books: Books) {
  return JSON.stringify({
    sales: books.sales.length,
    returns: books.returns.length,
    movements: books.movements.length,
    cash: books.cash.length,
    ledger: books.ledger.length,
    purchases: books.purchases.length,
    supplierPayments: books.supplierPayments.length,
    purchaseReturns: books.purchaseReturns.length,
    stock: books.products.map((p) => [p.id, p.stock]).sort(),
    usd: books.box.usdCents,
    lbp: books.box.lbp,
    debt: books.customer.debtUsdCents,
    supplier: books.supplier.balanceUsdCents,
    next: books.counter.nextId,
    stats: books.stats.map((s) => [s.id, s.salesCount, s.revenueUsdCents, s.costUsdCents, s.returnsUsdCents, s.debtCollectedUsdCents, s.expensesUsdCents]).sort(),
  });
}

async function settled() {
  return settleUntil(load, keyOf, 1_500, 40_000);
}

const MONEY_FNS = new Set([
  'posPayDebt',
  'posCashMove',
  'posAdjustDrawer',
  'posPaySupplier',
  'posReturnToSupplier',
  'posReturn',
  'posAdjustStock',
  'posAdjustDebt',
  'posCreatePurchase',
  'posCreateCustomer',
]);

function withClientOperationId(name: string, data: unknown): unknown {
  if (!MONEY_FNS.has(name) || !data || typeof data !== 'object') return data;
  const rec = data as Record<string, unknown>;
  if (typeof rec.clientOperationId === 'string') return data;
  return { ...rec, clientOperationId: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}` };
}

async function invoke(token: string, name: string, data: unknown, timeoutMs = 90_000) {
  const started = Date.now();
  try {
    const res = await fetch(`${FUNCTIONS}/${PROJECT_ID}/europe-west1/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ data: withClientOperationId(name, data) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    type CallableBody = { result?: Record<string, unknown>; error?: { status?: string; message?: string; details?: { key?: string } } };
    let parsed: CallableBody | null = null;
    try {
      parsed = JSON.parse(text) as CallableBody;
    } catch {
      parsed = null;
    }
    const ms = Date.now() - started;
    if (!parsed) {
      return { ms, ok: false, business: false, technical: true, timeout: false, invoice: null as string | null, duplicate: null as boolean | null, error: `invalid-json:${res.status}`, thrown: text.slice(0, 80), retry: false };
    }
    const key = parsed.error ? (parsed.error.details?.key ?? parsed.error.status ?? parsed.error.message ?? 'error') : null;
    const sale = parsed.result?.sale as { invoiceNumber?: string } | undefined;
    const invoice = typeof sale?.invoiceNumber === 'string' ? sale.invoiceNumber : null;
    const duplicate = typeof parsed.result?.duplicate === 'boolean' ? parsed.result.duplicate : null;
    const ok = !parsed.error && parsed.result != null;
    const business = !ok && key != null && !INFRA.test(key);
    return { ms, ok, business, technical: !ok && !business, timeout: false, invoice, duplicate, error: key, thrown: null as string | null, retry: false };
  } catch (e) {
    const thrown = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return { ms: Date.now() - started, ok: false, business: false, technical: true, timeout: /Timeout|Abort/i.test(thrown), invoice: null, duplicate: null, error: null, thrown, retry: false };
  }
}

interface CheckoutPayload {
  saleId: string;
  kind: string;
  currency: string;
  rate: number;
  customerId: string | null;
  debtLineUsdCents: null;
  lines: { productId: string; tier: string; quantity: number; customUsdCents: null; imei: null; expectedUnitUsdCents: number }[];
  expectedTotalUsdCents: number;
  cash?: { receivedUsdCents: number; receivedLbp: number; changeUsdCents?: number; changeLbp?: number };
  credit?: { paidUsdCents: number; paidLbp: number };
  offlineRef?: string;
  clientCreatedAtMs?: number;
}

let seq = 0;
function checkout(productId: string, quantity: number, extra: Record<string, unknown> = {}, cash?: { receivedUsdCents: number; receivedLbp: number; changeUsdCents?: number; changeLbp?: number }): CheckoutPayload {
  seq += 1;
  const unit = 500;
  const total = unit * quantity;
  const kind = extra.kind === 'credit' ? 'credit' : 'cash';
  return {
    saleId: typeof extra.saleId === 'string' ? extra.saleId : `s_${seq.toString(36)}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`,
    kind,
    currency: 'USD',
    rate: RATE,
    customerId: (extra.customerId as string | null | undefined) ?? null,
    debtLineUsdCents: null,
    lines: [{ productId, tier: 'retail', quantity, customUsdCents: null, imei: null, expectedUnitUsdCents: unit }],
    expectedTotalUsdCents: total,
    ...(kind === 'cash'
      ? { cash: cash ?? { receivedUsdCents: total, receivedLbp: 0, changeUsdCents: 0, changeLbp: 0 } }
      : { credit: { paidUsdCents: num(extra.paidUsdCents), paidLbp: num(extra.paidLbp) } }),
    ...(typeof extra.offlineRef === 'string' ? { offlineRef: extra.offlineRef, clientCreatedAtMs: Date.now() } : {}),
  };
}

async function wave(payloads: CheckoutPayload[], opts: { timeoutMs?: number; retry?: boolean; token?: string } = {}) {
  const jobs = payloads.map((data, index) => ({ id: data.saleId, data, token: opts.token ?? tokens[index % tokens.length]! }));
  let attempts: Attempt[] = await Promise.all(
    jobs.map(async (job) => ({ id: job.id, ...(await invoke(job.token, 'posCheckout', job.data, opts.timeoutMs ?? 90_000)) })),
  );
  let retries = 0;
  if (opts.retry !== false) {
    for (let round = 0; round < 4; round += 1) {
      const pendingIds = [...new Set(jobs.map((job) => job.id))].filter(
        (id) => !attempts.some((row) => row.id === id && (row.ok || row.business)),
      );
      if (!pendingIds.length) break;
      const again = pendingIds.filter((id) => attempts.some((row) => row.id === id && row.technical));
      if (!again.length) break;
      retries += again.length;
      const extra = await Promise.all(
        again.map(async (id) => {
          const job = jobs.find((item) => item.id === id)!;
          return { id, ...(await invoke(job.token, 'posCheckout', job.data, opts.timeoutMs ?? 90_000)), retry: true };
        }),
      );
      attempts = [...attempts, ...extra];
    }
  }
  let books = await settled();
  for (let round = 0; round < 3; round += 1) {
    const pending = books.sales.filter((sale) => !attempts.some((row) => row.id === sale.id && row.ok && row.invoice === String(sale.invoiceNumber)));
    if (!pending.length) break;
    const recovered = await Promise.all(
      pending.map(async (sale) => {
        const creator = tokenFor(String(sale.createdBy ?? ''));
        const job = jobs.find((item) => item.id === sale.id && item.token === creator) ?? jobs.find((item) => item.id === sale.id);
        const data = job?.data ?? { ...payloads[0], saleId: sale.id };
        return { id: sale.id, ...(await invoke(creator, 'posCheckout', data, opts.timeoutMs ?? 90_000)), retry: true };
      }),
    );
    retries += recovered.length;
    attempts = [...attempts, ...recovered];
    books = await settled();
  }
  return { attempts, retries, books, payloads };
}

function report(label: string, attempts: Attempt[], retries: number, books: Books, extra: Record<string, unknown> = {}) {
  const ok = attempts.filter((row) => row.ok);
  const ms = ok.map((row) => row.ms);
  const row = {
    label,
    requests: attempts.filter((item) => !item.retry).length,
    successes: new Set(ok.map((item) => item.id)).size,
    business: attempts.filter((item) => item.business && !item.retry).length,
    technical: attempts.filter((item) => item.technical).length,
    timeouts: attempts.filter((item) => item.timeout).length,
    committed: books.sales.length,
    clientSuccesses: ok.length,
    clientFailures: attempts.filter((item) => !item.ok && !item.retry).length,
    retries,
    p50: percentile(ms, 50),
    p95: percentile(ms, 95),
    max: ms.length ? Math.max(...ms) : null,
    ...extra,
  };
  const technicalSamples = attempts
    .filter((item) => item.technical)
    .slice(0, 5)
    .map((item) => item.error ?? item.thrown);
  const recorded = { ...row, technicalSamples };
  appendFileSync(METRICS, `${JSON.stringify({ phaseD: recorded })}\n`);
  console.info(JSON.stringify({ phaseD: recorded }));
  return recorded;
}

function assertBooks(final: Books, opening: Books, attempts: Attempt[]) {
  const seenMoves = new Set(opening.movements.map((row) => row.id));
  const seenCash = new Set(opening.cash.map((row) => row.id));
  const seenLedger = new Set(opening.ledger.map((row) => row.id));
  const seenSales = new Set(opening.sales.map((row) => row.id));
  const seenReturns = new Set(opening.returns.map((row) => row.id));
  const openStock = new Map(opening.products.map((p) => [p.id, num(p.stock)]));
  for (const product of final.products) {
    const moved = final.movements
      .filter((m) => m.productId === product.id && !seenMoves.has(m.id))
      .reduce((sum, m) => sum + num(m.quantity), 0);
    const baseline = openStock.has(product.id) ? openStock.get(product.id)! : 0;
    const expected = baseline + moved;
    if (num(product.stock) < 0) halt(`negative stock on ${product.id}`);
    if (num(product.stock) !== expected) halt(`stock drift on ${product.id}: stored ${product.stock}, movements ${expected}`);
  }
  const usd = num(opening.box.usdCents) + final.cash.filter((row) => !seenCash.has(row.id)).reduce((sum, row) => sum + num(row.usdCents), 0);
  const lbp = num(opening.box.lbp) + final.cash.filter((row) => !seenCash.has(row.id)).reduce((sum, row) => sum + num(row.lbp), 0);
  if (num(final.box.usdCents) < 0 || num(final.box.lbp) < 0) halt(`negative drawer usd=${final.box.usdCents} lbp=${final.box.lbp}`);
  if (num(final.box.usdCents) !== usd || num(final.box.lbp) !== lbp) halt(`drawer drift usd ${final.box.usdCents} vs ${usd}, lbp ${final.box.lbp} vs ${lbp}`);
  const debt = num(opening.customer.debtUsdCents) + final.ledger.filter((row) => !seenLedger.has(row.id)).reduce((sum, row) => sum + num(row.amountUsdCents), 0);
  if (debt < 0) halt(`negative customer debt ${debt}`);
  if (num(final.customer.debtUsdCents) !== debt) halt(`customer debt drift ${final.customer.debtUsdCents} vs ${debt}`);
  const remaining = final.purchases.reduce((sum, row) => sum + num(row.remainingUsdCents), 0);
  if (num(final.supplier.balanceUsdCents) !== remaining) halt(`supplier balance ${final.supplier.balanceUsdCents} vs bills ${remaining}`);
  for (const purchase of final.purchases) {
    if (num(purchase.remainingUsdCents) < 0) halt(`negative bill ${purchase.id}`);
    for (const item of items(purchase)) {
      if (num(item.returnedQty) > num(item.quantity)) halt(`supplier return exceeds purchased qty on ${purchase.id}`);
    }
  }
  const salesCount = final.sales.length;
  const revenue = final.sales.reduce((sum, row) => sum + num(row.totalUsdCents), 0);
  const cost = final.sales.reduce((sum, row) => sum + num(row.costUsdCents), 0);
  const cashSales = final.sales.filter((row) => row.kind === 'cash').reduce((sum, row) => sum + num(row.totalUsdCents), 0);
  const creditSales = final.sales.filter((row) => row.kind === 'credit').reduce((sum, row) => sum + num(row.totalUsdCents), 0);
  const returnsUsd = final.returns.reduce((sum, row) => sum + num(row.amountUsdCents), 0);
  const returnCost = final.returns.reduce((sum, row) => sum + items(row).reduce((costSum, item) => costSum + num(item.costUsdCents) * num(item.quantity), 0), 0);
  const debtCollected =
    final.sales.reduce((sum, row) => sum + num(payment(row).settledPreviousUsdCents), 0) +
    final.ledger.filter((row) => row.type === 'payment').reduce((sum, row) => sum + Math.abs(num(row.amountUsdCents)), 0);
  const expenses = final.cash
    .filter((row) => row.type === 'expense')
    .reduce((sum, row) => sum + Math.abs(num(row.usdCents)) + lbpToUsdCents(Math.abs(num(row.lbp)), RATE), 0);
  const stat = (name: string) => final.stats.reduce((sum, row) => sum + num(row[name]), 0);
  const statsOk =
    stat('salesCount') === salesCount &&
    stat('revenueUsdCents') === revenue &&
    stat('costUsdCents') === cost &&
    stat('cashSalesUsdCents') === cashSales &&
    stat('creditSalesUsdCents') === creditSales &&
    stat('returnsUsdCents') === returnsUsd &&
    stat('returnsCostUsdCents') === returnCost &&
    stat('debtCollectedUsdCents') === debtCollected &&
    stat('expensesUsdCents') === expenses;
  if (!statsOk) {
    halt(
      `dailyStats drift sales ${stat('salesCount')}/${salesCount} revenue ${stat('revenueUsdCents')}/${revenue} cost ${stat('costUsdCents')}/${cost} cash ${stat('cashSalesUsdCents')}/${cashSales} credit ${stat('creditSalesUsdCents')}/${creditSales} returns ${stat('returnsUsdCents')}/${returnsUsd} returnCost ${stat('returnsCostUsdCents')}/${returnCost} debt ${stat('debtCollectedUsdCents')}/${debtCollected} expenses ${stat('expensesUsdCents')}/${expenses}`,
    );
  }
  const newSales = final.sales.filter((row) => !seenSales.has(row.id));
  const newReturns = final.returns.filter((row) => !seenReturns.has(row.id));
  const used = [
    ...newSales.map((row) => Number(String(row.invoiceNumber).split('-')[1])),
    ...newReturns.map((row) => Number(String(row.number).split('-')[1])),
  ].sort((a, b) => a - b);
  const start = num(opening.counter.nextId);
  // The sales counter only advances inside the same transaction that writes INV/CR/RF.
  // Failed checkouts/returns therefore cannot consume a number. Gaps would mean a
  // committed document is missing from this snapshot, which is treated as corruption.
  if (num(final.counter.nextId) !== start + newSales.length + newReturns.length) halt(`counter moved to ${final.counter.nextId}, expected ${start + newSales.length + newReturns.length}`);
  used.forEach((n, index) => {
    if (n !== start + index) halt(`invoice counter gap or duplicate at ${n}`);
  });
  if (new Set(final.sales.map((row) => String(row.invoiceNumber))).size !== final.sales.length) halt('duplicate invoice number');
  const saleMoves = final.movements.filter((row) => row.type === 'sale');
  if (new Set(saleMoves.map((row) => String(row.refId))).size !== saleMoves.length) halt('duplicate stock movement for one sale');
  const saleCash = final.cash.filter((row) => row.type === 'sale').map((row) => String(row.refId ?? ''));
  if (new Set(saleCash).size !== saleCash.length) halt('duplicate drawer posting for one sale');
  for (const sale of newSales) {
    const lineCost = items(sale).reduce((sum, item) => sum + num(item.costUsdCents) * num(item.quantity), 0);
    if (num(sale.costUsdCents) !== lineCost) halt(`COGS mismatch on ${sale.id}`);
    const acked = attempts.filter((row) => row.id === sale.id && row.ok);
    if (!acked.length) {
      const trail = attempts
        .filter((row) => row.id === sale.id)
        .map((row) => ({ ok: row.ok, business: row.business, technical: row.technical, timeout: row.timeout, retry: row.retry, invoice: row.invoice, error: row.error, thrown: row.thrown }));
      halt(`committed sale ${sale.id} ${sale.invoiceNumber} has no successful client result trail=${JSON.stringify(trail)}`);
    }
    if (acked.some((row) => row.invoice !== String(sale.invoiceNumber))) halt(`client invoice does not match ${sale.invoiceNumber}`);
  }
  for (const row of attempts.filter((item) => item.ok && item.invoice)) {
    if (!final.sales.some((sale) => sale.id === row.id)) halt(`client success ${row.id} has no sale document`);
  }
  for (const row of attempts.filter((item) => item.business)) {
    if (final.sales.some((sale) => sale.id === row.id) && !attempts.some((item) => item.id === row.id && item.ok)) {
      const detail = attempts
        .filter((item) => item.id === row.id)
        .map((item) => item.error ?? item.thrown ?? 'unknown')
        .join(' | ');
      halt(`business rejection still committed ${row.id}: ${detail}`);
    }
  }
}

async function runSales(label: string, count: number, build: (index: number) => CheckoutPayload, opts: { timeoutMs?: number; token?: string } = {}) {
  const opening = await load();
  const payloads = Array.from({ length: count }, (_, index) => build(index));
  const result = await wave(payloads, opts);
  const summary = report(label, result.attempts, result.retries, result.books);
  assertBooks(result.books, opening, result.attempts);
  return { ...result, summary, opening };
}

async function putProduct(id: string, stock: number, retail = 500) {
  const now = Timestamp.now();
  await asAdmin(env, (fs) =>
    setDoc(doc(fs, tp(TENANT, 'products', id)), {
      name: id,
      nameNormalized: id,
      status: 'active',
      category: 'Accessories',
      barcode: '',
      prices: { retail: { usdCents: retail, lbp: null }, wholesale: { usdCents: 0, lbp: null }, vip: { usdCents: 0, lbp: null } },
      costUsdCents: 200,
      stock,
      minStock: null,
      supplierId: null,
      supplierName: '',
      expiryDate: null,
      imeiTracking: false,
      imeis: [],
      imageUrl: null,
      imagePath: null,
      lastMovementId: null,
      createdAt: now,
      createdAtMs: Date.now(),
      createdBy: TENANT,
    }),
  );
}

beforeAll(async () => {
  rmSync(METRICS, { force: true });
  env = await createEnv();
  await clearAuth();
  manager = await createUser({ uid: 'dMgr', tenantId: TENANT, role: 'subUser', perms: MANAGER.permissions });
  const issued = await Promise.all(
    CASHIERS.map((cashier) => createUser({ uid: cashier.uid, tenantId: TENANT, role: 'subUser', perms: { canSell: true } })),
  );
  tokens.push(...issued);
}, 180_000);

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  if (halted) throw new Error(`PHASE D STOP: ${halted}`);
  await reset();
});

describe('concurrent cash sales on different products', () => {
  it('keeps one sale, one movement, one drawer posting and one stats increment per success', async () => {
    for (const count of [5, 20, 50]) {
      await reset();
      await Promise.all(Array.from({ length: count }, (_, index) => putProduct(`px${index}`, 5)));
      const result = await runSales(`different-products-${count}`, count, (index) => checkout(`px${index}`, 1));
      const committed = result.books.sales.length;
      expect(committed).toBeLessThanOrEqual(count);
      expect(result.summary.business).toBe(0);
      if (count === 5) expect(committed).toBe(count);
      const soldIds = new Set(result.books.sales.flatMap((sale) => items(sale).map((item) => String(item.productId))));
      const products = result.books.products.filter((product) => String(product.id).startsWith('px'));
      expect(products.filter((product) => soldIds.has(String(product.id))).every((product) => product.stock === 4)).toBe(true);
      expect(products.filter((product) => !soldIds.has(String(product.id))).every((product) => product.stock === 5)).toBe(true);
      const dropped = [...new Set(result.attempts.map((row) => row.id))].filter((id) => !result.attempts.some((row) => row.id === id && row.ok));
      expect(dropped.every((id) => result.attempts.some((row) => row.id === id && row.technical && !result.books.sales.some((sale) => sale.id === id)))).toBe(true);
    }
  }, 360_000);
});

describe('same-product stock race', () => {
  it('sells exactly the units on hand when every request fits', async () => {
    for (const count of [5, 10, 20, 50]) {
      await reset();
      await putProduct('p1', count);
      const result = await runSales(`same-product-fit-${count}`, count, () => checkout('p1', 1));
      const committed = result.books.sales.length;
      expect(committed).toBeLessThanOrEqual(count);
      expect(result.summary.business).toBe(0);
      if (count === 5) expect(committed).toBe(count);
      const units = result.books.sales.reduce((sum, sale) => sum + items(sale).reduce((q, item) => q + num(item.quantity), 0), 0);
      expect(units).toBe(committed);
      expect(result.books.products.find((p) => p.id === 'p1')?.stock).toBe(count - committed);
      const dropped = [...new Set(result.attempts.map((row) => row.id))].filter((id) => !result.attempts.some((row) => row.id === id && row.ok));
      expect(dropped.every((id) => result.attempts.some((row) => row.id === id && row.technical && !result.books.sales.some((sale) => sale.id === id)))).toBe(true);
    }
  }, 360_000);

  it('never oversells a product with 10 units', async () => {
    for (const pass of [1, 2, 3]) {
      await reset();
      await putProduct('p1', 10);
      const result = await runSales(`oversell-10-of-20-pass-${pass}`, 20, () => checkout('p1', 1));
      const sold = result.books.sales.reduce((sum, sale) => sum + items(sale).reduce((q, item) => q + num(item.quantity), 0), 0);
      expect(sold).toBeLessThanOrEqual(10);
      expect(result.books.products.find((p) => p.id === 'p1')?.stock).toBe(10 - sold);
      const ids = [...new Set(result.attempts.map((row) => row.id))];
      const rejected = ids.filter((id) => !result.attempts.some((row) => row.id === id && row.ok));
      expect(rejected.every((id) => !result.books.sales.some((sale) => sale.id === id))).toBe(true);
      const stockErrors = rejected.filter((id) => result.attempts.some((row) => row.id === id && row.error === 'error.insufficientStock'));
      const infraRejects = rejected.filter((id) => result.attempts.some((row) => row.id === id && row.technical) && !stockErrors.includes(id));
      expect(rejected.every((id) => stockErrors.includes(id) || infraRejects.includes(id))).toBe(true);
      if (sold < 10 && infraRejects.length) {
        console.warn(JSON.stringify({ phaseDInfra: `oversell-pass-${pass}`, sold, infraRejects: infraRejects.length, stockErrors: stockErrors.length }));
      } else {
        expect(sold).toBe(10);
        expect(stockErrors.length).toBeGreaterThanOrEqual(10);
      }
    }
    await reset();
    await putProduct('p1', 10);
    const heavy = await runSales('oversell-10-of-50', 50, () => checkout('p1', 1));
    const sold = heavy.books.sales.reduce((sum, sale) => sum + items(sale).reduce((q, item) => q + num(item.quantity), 0), 0);
    expect(sold).toBeLessThanOrEqual(10);
    expect(heavy.books.products.find((p) => p.id === 'p1')?.stock).toBe(10 - sold);
    if (sold < 10) {
      console.warn(JSON.stringify({ phaseDInfra: 'oversell-10-of-50', sold, technical: heavy.summary.technical }));
    }
  }, 420_000);
});

describe('multi-quantity race', () => {
  it('keeps sold units inside the 20 on hand when each request asks for 3', async () => {
    await putProduct('p1', 20);
    const result = await runSales('qty-3-stock-20', 10, () => checkout('p1', 3));
    const sold = result.books.sales.reduce((sum, sale) => sum + items(sale).reduce((q, item) => q + num(item.quantity), 0), 0);
    expect(sold).toBeLessThanOrEqual(20);
    expect(sold % 3).toBe(0);
    expect(result.books.products.find((p) => p.id === 'p1')?.stock).toBe(20 - sold);
    if (result.summary.technical) {
      console.warn(JSON.stringify({ phaseDInfra: 'qty-3-stock-20', sold, technical: result.summary.technical }));
    } else {
      expect(sold).toBe(18);
    }
  }, 180_000);
});

describe('idempotency stress', () => {
  it('collapses simultaneous retries of one sale id onto one canonical sale', async () => {
    for (const count of [5, 20, 50]) {
      for (const pass of [1, 2, 3]) {
        await reset();
        await putProduct('p1', 10);
        const payload = checkout('p1', 1);
        const result = await runSales(`idempotent-${count}-pass-${pass}`, count, () => ({ ...payload }), { token: tokens[0]! });
        expect(result.books.sales).toHaveLength(1);
        expect(result.books.movements.filter((row) => row.type === 'sale')).toHaveLength(1);
        expect(result.books.cash.filter((row) => row.type === 'sale')).toHaveLength(1);
        expect(result.books.products.find((p) => p.id === 'p1')?.stock).toBe(9);
        expect(result.books.stats.reduce((sum, row) => sum + num(row.salesCount), 0)).toBe(1);
        const acknowledged = result.attempts.filter((row) => row.ok);
        expect(new Set(acknowledged.map((row) => row.invoice)).size).toBe(1);
        if (acknowledged.length > 1) expect(acknowledged.some((row) => row.duplicate === true)).toBe(true);
      }
    }
  }, 600_000);
});

describe('committed sale with an uncertain client result', () => {
  it('recovers the same invoice on a same-id retry', async () => {
    for (const pass of [1, 2, 3]) {
      await reset();
      await putProduct('p1', 80);
      const result = await runSales(`uncertain-${pass}`, 50, () => checkout('p1', 1), { timeoutMs: 45_000 });
      expect(result.books.sales.length).toBeGreaterThan(0);
      expect(result.attempts.filter((row) => row.ok).length).toBeGreaterThan(0);
      const hidden = result.books.sales.filter((sale) => !result.attempts.some((row) => row.id === sale.id && row.ok && row.invoice === String(sale.invoiceNumber)));
      expect(hidden).toEqual([]);
    }
  }, 600_000);
});

describe('invoice counter', () => {
  it('does not consume a number when checkout is refused', async () => {
    for (const pass of [1, 2, 3]) {
      await reset();
      const opening = await load();
      const bad = checkout('p1', 1);
      bad.expectedTotalUsdCents = 1;
      bad.cash = { receivedUsdCents: 1, receivedLbp: 0, changeUsdCents: 0, changeLbp: 0 };
      const refused = await invoke(tokens[0]!, 'posCheckout', bad);
      expect(refused.business, `pass ${pass}`).toBe(true);
      expect(refused.error).toBe('error.pricesChanged');
      const books = await settled();
      expect(books.sales).toHaveLength(0);
      expect(books.counter.nextId).toBe(opening.counter.nextId);
    }
  }, 120_000);

  it('assigns unique invoice numbers under a concurrent checkout burst', async () => {
    for (const pass of [1, 2, 3]) {
      await reset();
      await Promise.all(Array.from({ length: 20 }, (_, index) => putProduct(`inv${index}`, 2)));
      const result = await runSales(`invoice-burst-20-pass-${pass}`, 20, (index) => checkout(`inv${index}`, 1));
      const numbers = result.books.sales.map((sale) => String(sale.invoiceNumber));
      expect(new Set(numbers).size).toBe(numbers.length);
      const seqs = numbers.map((value) => Number(value.split('-')[1])).sort((a, b) => a - b);
      seqs.forEach((n, index) => expect(n).toBe(seqs[0]! + index));
    }
  }, 240_000);

  it('shares one monotonic counter between a sale and a return, without reusing a number', async () => {
    for (const pass of [1, 2, 3]) {
      await reset();
      await putProduct('p1', 10);
      const opening = await load();
      const sold = await invoke(tokens[0]!, 'posCheckout', checkout('p1', 2));
      expect(sold.ok, `pass ${pass}`).toBe(true);
      const created = await settled();
      const sale = created.sales[0]!;
      const returned = await invoke(manager, 'posReturn', { saleId: sale.id, lines: [{ index: 0, quantity: 1 }], reason: 'race' });
      expect(returned.ok).toBe(true);
      const books = await settled();
      assertBooks(books, opening, [{ id: sale.id, ms: sold.ms, ok: true, business: false, technical: false, timeout: false, retry: false, invoice: sold.invoice, duplicate: false, error: null, thrown: null }]);
      expect(String(books.sales[0]?.invoiceNumber)).not.toBe(String(books.returns[0]?.number));
    }
  }, 180_000);
});

describe('cash drawer concurrency', () => {
  it('matches USD and LBP to the cash ledger and refuses an overdraft', async () => {
    await putProduct('p1', 20);
    await asAdmin(env, (fs) => updateDoc(doc(fs, tp(TENANT, 'customers', 'c1')), { debtUsdCents: 2_000, creditLimitUsdCents: 50_000 }));
    const purchase = await invoke(manager, 'posCreatePurchase', {
      supplierId: 'sup1',
      date: '2026-10-09',
      dueDate: null,
      items: [{ productId: 'p1', quantity: 1, unitCostUsdCents: 2_000 }],
      updateCost: false,
      paidNowUsdCents: 0,
      payFromCashbox: false,
      note: '',
    });
    expect(purchase.ok).toBe(true);
    const opening = await load();
    const salePayloads = Array.from({ length: 5 }, () => checkout('p1', 1));
    const tagged = [
      ...Array.from({ length: 5 }, (_, index) => ({ id: `dep${index}`, run: () => invoke(manager, 'posCashMove', { type: 'deposit', usdCents: 1_000, lbp: 0, category: '', note: '' }) })),
      ...Array.from({ length: 5 }, (_, index) => ({ id: `wd${index}`, run: () => invoke(manager, 'posCashMove', { type: 'withdrawal', usdCents: 500, lbp: 0, category: '', note: '' }) })),
      ...salePayloads.map((data, index) => ({ id: data.saleId, run: () => invoke(tokens[index]!, 'posCheckout', data) })),
      { id: 'expense', run: () => invoke(manager, 'posCashMove', { type: 'expense', usdCents: 1_000, lbp: 0, category: 'rent', note: '' }) },
      { id: 'debt', run: () => invoke(manager, 'posPayDebt', { customerId: 'c1', usdCents: 1_000, lbp: 0, rate: RATE, note: '' }) },
      { id: 'supplier', run: () => invoke(manager, 'posPaySupplier', { supplierId: 'sup1', currency: 'USD', amount: 500, rate: RATE, method: 'cash', note: '' }) },
    ];
    const attempts = await Promise.all(tagged.map(async (job) => ({ id: job.id, ...(await job.run()), retry: false })));
    const books = await settled();
    assertBooks(books, opening, attempts);
    const usd = num(books.box.usdCents);
    const fromLedger =
      num(opening.box.usdCents) + books.cash.filter((row) => !opening.cash.some((prior) => prior.id === row.id)).reduce((sum, row) => sum + num(row.usdCents), 0);
    expect(usd).toBe(fromLedger);
    report('drawer-mix', attempts, 0, books, { technical: attempts.filter((row) => row.technical).length });

    const beforeOverdraft = await load();
    const withdrawals = await Promise.all(
      Array.from({ length: 20 }, () => invoke(manager, 'posCashMove', { type: 'withdrawal', usdCents: 2_000, lbp: 0, category: '', note: '' })),
    );
    const after = await settled();
    const succeeded = withdrawals.filter((row) => row.ok).length;
    expect(num(after.box.usdCents)).toBeGreaterThanOrEqual(0);
    expect(num(after.box.usdCents)).toBe(num(beforeOverdraft.box.usdCents) - succeeded * 2_000);
    expect(succeeded).toBe(Math.floor(num(beforeOverdraft.box.usdCents) / 2_000));
    expect(withdrawals.filter((row) => row.business).every((row) => row.error === 'error.drawerInsufficient')).toBe(true);
    report('drawer-overdraft-20', withdrawals.map((row) => ({ ...row, id: 'wd', retry: false })), 0, after, { succeeded });

    await reset();
    await putProduct('p1', 8);
    const soldForRefund = await runSales('drawer-refund-setup', 4, () => checkout('p1', 1));
    const beforeRefund = await load();
    const refunds = await Promise.all(
      soldForRefund.books.sales.map((sale) => invoke(manager, 'posReturn', { saleId: sale.id, lines: [{ index: 0, quantity: 1 }], reason: 'drawer' })),
    );
    const afterRefund = await settled();
    expect(refunds.filter((row) => row.ok)).toHaveLength(soldForRefund.books.sales.length);
    expect(afterRefund.cash.filter((row) => row.type === 'refund')).toHaveLength(soldForRefund.books.sales.length);
    const priorSales = soldForRefund.books.sales.map((sale) => ({
      id: sale.id,
      ms: 0,
      ok: true,
      business: false,
      technical: false,
      timeout: false,
      retry: false,
      invoice: String(sale.invoiceNumber ?? ''),
      duplicate: false,
      error: null,
      thrown: null,
    }));
    assertBooks(afterRefund, beforeRefund, priorSales);
    report('drawer-refunds', refunds.map((row, index) => ({ ...row, id: `rf${index}`, retry: false })), 0, afterRefund);
  }, 300_000);
});

describe('mixed USD and LBP', () => {
  it('posts each physical currency movement separately', async () => {
    await putProduct('p1', 20);
    await asAdmin(env, (fs) => updateDoc(doc(fs, tp(TENANT, 'cashbox', 'summary')), { lbp: 50_000_000 }));
    const shapes = [
      { receivedUsdCents: 500, receivedLbp: 0, changeUsdCents: 0, changeLbp: 0 },
      { receivedUsdCents: 1_000, receivedLbp: 0, changeUsdCents: 500, changeLbp: 0 },
      { receivedUsdCents: 0, receivedLbp: 447_500, changeUsdCents: 0, changeLbp: 0 },
      { receivedUsdCents: 250, receivedLbp: 223_750, changeUsdCents: 0, changeLbp: 0 },
      { receivedUsdCents: 500, receivedLbp: 447_500, changeUsdCents: 0, changeLbp: 447_500 },
    ];
    const opening = await load();
    const payloads = shapes.map((shape) => checkout('p1', 1, {}, shape));
    const result = await wave(payloads);
    assertBooks(result.books, opening, result.attempts);
    expect(result.books.sales).toHaveLength(shapes.length);
    for (const payload of payloads) {
      const tx = result.books.cash.find((row) => row.refId === payload.saleId && row.type === 'sale');
      expect(num(tx?.usdCents)).toBe(payload.cash!.receivedUsdCents - (payload.cash!.changeUsdCents ?? 0));
      expect(num(tx?.lbp)).toBe(payload.cash!.receivedLbp - (payload.cash!.changeLbp ?? 0));
    }
    report('mixed-currency', result.attempts, result.retries, result.books);
  }, 180_000);
});

describe('customer debt race', () => {
  it('blocks the credit limit and applies each payment once', async () => {
    await putProduct('p1', 30);
    await asAdmin(env, (fs) => updateDoc(doc(fs, tp(TENANT, 'customers', 'c1')), { debtUsdCents: 0, creditLimitUsdCents: 5_000 }));
    const opening = await load();
    const credit = Array.from({ length: 10 }, () => checkout('p1', 2, { kind: 'credit', customerId: 'c1', paidUsdCents: 0 }));
    const creditWave = await wave(credit);
    assertBooks(creditWave.books, opening, creditWave.attempts);
    const creditSold = creditWave.books.sales.length;
    expect(creditSold).toBeLessThanOrEqual(5);
    expect(creditWave.books.customer.debtUsdCents).toBe(creditSold * 1_000);
    expect(creditWave.attempts.filter((row) => row.business && !row.retry).every((row) => row.error === 'error.credit.creditLimit')).toBe(true);
    if (creditWave.attempts.some((row) => row.technical)) {
      console.warn(JSON.stringify({ phaseDInfra: 'credit-limit', creditSold, technical: creditWave.attempts.filter((row) => row.technical).length }));
    } else {
      expect(creditSold).toBe(5);
      expect(creditWave.books.customer.debtUsdCents).toBe(5_000);
    }

    const near = await load();
    const blocked = await wave(Array.from({ length: 10 }, () => checkout('p1', 2, { kind: 'credit', customerId: 'c1', paidUsdCents: 0 })));
    assertBooks(blocked.books, near, blocked.attempts);
    expect(num(blocked.books.customer.debtUsdCents)).toBeLessThanOrEqual(5_000);
    expect(num(blocked.books.customer.debtUsdCents)).toBe(blocked.books.sales.length * 1_000);
    if (num(near.customer.debtUsdCents) === 5_000) {
      expect(blocked.books.sales.length).toBe(near.sales.length);
    }

    const beforePay = await load();
    const payments = await Promise.all(
      Array.from({ length: 8 }, () => invoke(manager, 'posPayDebt', { customerId: 'c1', usdCents: 1_000, lbp: 0, rate: RATE, note: '' })),
    );
    const paid = await settled();
    const payAttempts = payments.map((row, index) => ({ ...row, id: `pay${index}`, retry: false }));
    assertBooks(paid, beforePay, payAttempts);
    const accepted = payments.filter((row) => row.ok).length;
    expect(num(paid.customer.debtUsdCents)).toBe(num(beforePay.customer.debtUsdCents) - accepted * 1_000);
    expect(paid.ledger.filter((row) => row.type === 'payment')).toHaveLength(accepted);
    if (payments.some((row) => row.technical)) {
      console.warn(JSON.stringify({ phaseDInfra: 'debt-payments', accepted, technical: payments.filter((row) => row.technical).length }));
    } else {
      expect(accepted).toBe(Math.min(8, Math.floor(num(beforePay.customer.debtUsdCents) / 1_000)));
      expect(paid.customer.debtUsdCents).toBe(0);
    }
    report('debt-race', payAttempts, 0, paid, { creditSales: creditWave.books.sales.length, payments: accepted });
  }, 240_000);
});

describe('supplier balance race', () => {
  it('keeps the supplier balance equal to open bills under concurrent purchases, payments and returns', async () => {
    await putProduct('p1', 0);
    const first = await invoke(manager, 'posCreatePurchase', {
      supplierId: 'sup1',
      date: '2026-10-01',
      dueDate: null,
      items: [{ productId: 'p1', quantity: 10, unitCostUsdCents: 100 }],
      updateCost: false,
      paidNowUsdCents: 0,
      payFromCashbox: false,
      note: '',
    });
    expect(first.ok).toBe(true);
    const created = await settled();
    const purchaseId = created.purchases[0]!.id;
    const opening = await load();
    const calls = await Promise.all([
      ...Array.from({ length: 4 }, () =>
        invoke(manager, 'posCreatePurchase', {
          supplierId: 'sup1',
          date: '2026-10-09',
          dueDate: null,
          items: [{ productId: 'p1', quantity: 1, unitCostUsdCents: 100 }],
          updateCost: false,
          paidNowUsdCents: 0,
          payFromCashbox: false,
          note: '',
        }),
      ),
      ...Array.from({ length: 6 }, () => invoke(manager, 'posPaySupplier', { supplierId: 'sup1', currency: 'USD', amount: 200, rate: RATE, method: 'cash', note: '' })),
      ...Array.from({ length: 6 }, () => invoke(manager, 'posReturnToSupplier', { purchaseId, lines: [{ index: 0, quantity: 3 }], note: '' })),
    ]);
    const books = await settled();
    const priorSales = opening.sales.map((sale) => ({
      id: sale.id,
      ms: 0,
      ok: true,
      business: false,
      technical: false,
      timeout: false,
      retry: false,
      invoice: String(sale.invoiceNumber ?? ''),
      duplicate: false,
      error: null,
      thrown: null,
    }));
    assertBooks(books, opening, priorSales);
    const returnedQty = books.purchaseReturns.reduce((sum, row) => sum + items(row).reduce((q, item) => q + num(item.quantity), 0), 0);
    expect(returnedQty).toBeLessThanOrEqual(10);
    expect(num(books.supplier.balanceUsdCents)).toBe(books.purchases.reduce((sum, row) => sum + num(row.remainingUsdCents), 0));
    expect(num(books.products.find((p) => p.id === 'p1')?.stock)).toBeGreaterThanOrEqual(0);
    expect(calls.filter((row) => row.ok).length).toBeGreaterThan(0);
    report('supplier-race', calls.map((row, index) => ({ ...row, id: `sup${index}`, retry: false })), 0, books, { returnedQty });
  }, 240_000);
});

describe('return concurrency', () => {
  it('restocks and refunds a full return once, and partial returns only up to the quantity sold', async () => {
    await putProduct('p1', 30);
    const sold = await invoke(tokens[0]!, 'posCheckout', checkout('p1', 10));
    expect(sold.ok).toBe(true);
    const sale = (await settled()).sales[0]!;
    const opening = await load();
    const full = await Promise.all(Array.from({ length: 5 }, () => invoke(manager, 'posReturn', { saleId: sale.id, lines: [{ index: 0, quantity: 10 }], reason: 'full' })));
    const afterFull = await settled();
    expect(full.filter((row) => row.ok)).toHaveLength(1);
    expect(full.filter((row) => row.business).every((row) => String(row.error).startsWith('error.return.'))).toBe(true);
    expect(afterFull.products.find((p) => p.id === 'p1')?.stock).toBe(num(opening.products.find((p) => p.id === 'p1')?.stock) + 10);
    expect(afterFull.cash.filter((row) => row.type === 'refund')).toHaveLength(1);
    expect(afterFull.returns).toHaveLength(1);
    assertBooks(afterFull, opening, []);

    await reset();
    await putProduct('p1', 30);
    const again = await invoke(tokens[0]!, 'posCheckout', checkout('p1', 10));
    expect(again.ok).toBe(true);
    const partialSale = (await settled()).sales[0]!;
    const beforePartial = await load();
    const partial = await Promise.all(
      Array.from({ length: 20 }, () => invoke(manager, 'posReturn', { saleId: partialSale.id, lines: [{ index: 0, quantity: 1 }], reason: 'partial' })),
    );
    const afterPartial = await settled();
    const accepted = partial.filter((row) => row.ok).length;
    const units = afterPartial.returns.reduce((sum, row) => sum + items(row).reduce((q, item) => q + num(item.quantity), 0), 0);
    expect(units).toBeLessThanOrEqual(10);
    expect(accepted).toBe(units);
    if (partial.some((row) => row.technical)) {
      console.warn(JSON.stringify({ phaseDInfra: 'partial-returns', accepted, technical: partial.filter((row) => row.technical).length }));
    } else {
      expect(accepted).toBe(10);
      expect(units).toBe(10);
    }
    expect(num(afterPartial.products.find((p) => p.id === 'p1')?.stock)).toBe(num(beforePartial.products.find((p) => p.id === 'p1')?.stock) + units);
    expect(afterPartial.cash.filter((row) => row.type === 'refund')).toHaveLength(accepted);
    const prior = [{ id: partialSale.id, ms: 0, ok: true, business: false, technical: false, timeout: false, retry: false, invoice: again.invoice, duplicate: false, error: null, thrown: null }];
    assertBooks(afterPartial, beforePartial, prior);
    report('returns', partial.map((row, index) => ({ ...row, id: `ret${index}`, retry: false })), 0, afterPartial, { accepted });
  }, 240_000);
});

describe('stock adjustment versus sale', () => {
  it('applies both operations without a lost update', async () => {
    await putProduct('p1', 15);
    const opening = await load();
    const sales = Array.from({ length: 10 }, () => checkout('p1', 1));
    const saleCalls = sales.map((data, index) => invoke(tokens[index]!, 'posCheckout', data));
    const adjusts = Array.from({ length: 10 }, () =>
      invoke(manager, 'posAdjustStock', {
        productId: 'p1',
        mode: 'remove',
        quantity: 1,
        unitCostUsdCents: null,
        payFromCashbox: false,
        imeisToAdd: [],
        imeisToRemove: [],
        note: '',
      }),
    );
    const attempts = await Promise.all([...saleCalls, ...adjusts]);
    const books = await settled();
    const saleAttempts = attempts.slice(0, 10).map((row, index) => ({ ...row, id: sales[index]!.saleId, retry: false }));
    const adjustAttempts = attempts.slice(10);
    const hidden = books.sales.filter((sale) => !saleAttempts.some((row) => row.id === sale.id && row.ok));
    for (const sale of hidden) {
      const recovered = await invoke(tokenFor(String(sale.createdBy ?? '')), 'posCheckout', { ...sales[0], saleId: sale.id });
      saleAttempts.push({ ...recovered, id: sale.id, retry: true });
    }
    const finalBooks = hidden.length ? await settled() : books;
    assertBooks(finalBooks, opening, saleAttempts);
    const stock = num(finalBooks.products.find((p) => p.id === 'p1')?.stock);
    const adjustmentMoves = finalBooks.movements.filter((row) => row.type === 'adjustment').length;
    const adjustmentErrors = adjustAttempts.filter((row) => !row.ok).slice(0, 5).map((row) => row.error ?? row.thrown);
    report('stock-vs-sale', saleAttempts, hidden.length, finalBooks, {
      stock,
      adjustments: adjustAttempts.filter((row) => row.ok).length,
      adjustmentMoves,
      adjustmentErrors,
    });
    expect(stock).toBeGreaterThanOrEqual(0);
    expect(stock).toBeLessThanOrEqual(15);
    expect(adjustmentMoves).toBe(adjustAttempts.filter((row) => row.ok).length);
    expect(adjustAttempts.filter((row) => row.error === 'error.permissionDenied')).toHaveLength(0);
    expect(
      adjustAttempts.every((row) => row.ok || row.business || row.technical),
      adjustmentErrors.join(' | '),
    ).toBe(true);
    const soldUnits = finalBooks.sales.reduce((sum, sale) => sum + items(sale).reduce((q, item) => q + num(item.quantity), 0), 0);
    expect(stock).toBe(15 - soldUnits - adjustAttempts.filter((row) => row.ok).length);
  }, 180_000);
});

describe('price change versus checkout', () => {
  it('refuses a total that no longer matches the stored price', async () => {
    await putProduct('p1', 10, 500);
    const payload = checkout('p1', 1);
    const pending = invoke(tokens[0]!, 'posCheckout', payload);
    await asAdmin(env, (fs) =>
      updateDoc(doc(fs, tp(TENANT, 'products', 'p1')), {
        prices: { retail: { usdCents: 900, lbp: null }, wholesale: { usdCents: 0, lbp: null }, vip: { usdCents: 0, lbp: null } },
      }),
    );
    const online = await pending;
    const books = await settled();
    if (online.ok) {
      expect(books.sales).toHaveLength(1);
      expect(books.sales[0]?.totalUsdCents).toBe(500);
    } else {
      expect(online.error).toBe('error.pricesChanged');
      expect(books.sales).toHaveLength(0);
      expect(books.products.find((p) => p.id === 'p1')?.stock).toBe(10);
    }
    const offlinePayload = checkout('p1', 1, { offlineRef: 'OFF-PRICE1' });
    const offline = await invoke(tokens[1]!, 'posCheckout', offlinePayload);
    expect(offline.ok).toBe(false);
    expect(offline.error).toBe('error.pricesChanged');
    const after = await settled();
    expect(after.sales.every((sale) => num(sale.totalUsdCents) === 500)).toBe(true);
    report('price-change', [{ ...online, id: payload.saleId, retry: false }, { ...offline, id: offlinePayload.saleId, retry: false }], 0, after);
  }, 120_000);
});

describe('user disable during checkout', () => {
  it('rejects new sales after the profile is inactive; live rules deny stale-token reads', async () => {
    await putProduct('p1', 5);
    const payload = checkout('p1', 1);
    const pending = invoke(tokens[0]!, 'posCheckout', payload);
    await asAdmin(env, (fs) => updateDoc(doc(fs, `users/${CASHIERS[0]!.uid}`), { isActive: false }));
    const first = await pending;
    const second = await invoke(tokens[0]!, 'posCheckout', checkout('p1', 1));
    const retry = await invoke(tokens[0]!, 'posCheckout', payload);
    expect(second.ok).toBe(false);
    expect(second.error).toBe('error.userInactive');
    const books = await settled();
    if (books.sales.some((sale) => sale.id === payload.saleId)) {
      expect(retry.ok).toBe(true);
      expect(retry.duplicate).toBe(true);
      expect(retry.invoice).toBe(String(books.sales.find((sale) => sale.id === payload.saleId)?.invoiceNumber));
      expect(books.sales).toHaveLength(1);
    } else {
      expect(first.ok).toBe(false);
      expect(first.error).toBe('error.userInactive');
      expect(retry.error).toBe('error.userInactive');
    }
    const reader = env.authenticatedContext(CASHIERS[0]!.uid, {
      tenantId: TENANT,
      role: 'subUser',
      active: true,
      email_verified: true,
      perms: { canSell: true },
    });
    await assertFails(getDoc(doc(reader.firestore(), tp(TENANT, 'products', 'p1'))));
    report('user-disable', [{ ...first, id: payload.saleId, retry: false }, { ...second, id: 'after', retry: false }], 0, books);
  }, 120_000);
});

describe('subscription deactivation', () => {
  it('rejects new sales, offline sync and same-id retries after the subscription ends', async () => {
    await putProduct('p1', 5);
    const payload = checkout('p1', 1);
    const sold = await invoke(tokens[0]!, 'posCheckout', payload);
    expect(sold.ok).toBe(true);
    await asAdmin(env, (fs) => updateDoc(doc(fs, `subscriptions/${TENANT}`), { endsAt: Timestamp.fromMillis(Date.now() - DAY) }));
    const fresh = await invoke(tokens[1]!, 'posCheckout', checkout('p1', 1));
    const offline = await invoke(tokens[2]!, 'posCheckout', checkout('p1', 1, { offlineRef: 'OFF-SUB001' }));
    const retry = await invoke(tokens[0]!, 'posCheckout', payload);
    expect(fresh.error).toBe('error.fn.subscriptionInactive');
    expect(offline.error).toBe('error.fn.subscriptionInactive');
    expect(retry.ok).toBe(true);
    expect(retry.duplicate).toBe(true);
    const books = await settled();
    expect(books.sales).toHaveLength(1);
    expect(books.products.find((p) => p.id === 'p1')?.stock).toBe(4);
    report('subscription', [{ ...fresh, id: 'fresh', retry: false }, { ...offline, id: 'offline', retry: false }, { ...retry, id: payload.saleId, retry: true }], 0, books);
  }, 120_000);
});

afterAll(() => {
  try {
    const lines = readFileSync(METRICS, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line: string) => JSON.parse(line) as Record<string, unknown>);
    console.info(JSON.stringify({ phaseDSummary: lines }, null, 2));
  } catch {
    console.info(JSON.stringify({ phaseDSummary: 'no-metrics-file' }));
  }
});
