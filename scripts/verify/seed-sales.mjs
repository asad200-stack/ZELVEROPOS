/**
 * Writes deterministic sales into the LOCAL Firestore emulator only.
 * Documents stay in the emulator process (project demo-zelvero) until it stops.
 * The script does not keep the collection in memory: each batch is committed and dropped.
 *
 * Usage:
 *   node scripts/verify/seed-sales.mjs 10000
 *   node scripts/verify/seed-sales.mjs 100000
 *   node scripts/verify/seed-sales.mjs 1000000
 *   node scripts/verify/seed-sales.mjs customers
 *
 * Tenants: scale-sales-10000, scale-sales-100000, scale-sales-1000000, scale-customer-sales.
 * Customer tenant: c10 has 10 sales, c1000 has 1,000, c10000 has 10,000.
 */
import { execSync } from 'node:child_process';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, writeBatch } from 'firebase/firestore';

const PROJECT_ID = 'demo-zelvero';
const arg = process.argv[2];
const customers = arg === 'customers';
const statsOnly = arg === 'stats';
const count = customers ? 11_010 : statsOnly ? 0 : Number(arg);
const allowed = new Set([10_000, 100_000, 1_000_000]);

if (!PROJECT_ID.startsWith('demo-')) throw new Error('refusing to seed a non-demo project');
if (!customers && !statsOnly && !allowed.has(count)) {
  throw new Error('usage: node scripts/verify/seed-sales.mjs <10000|100000|1000000|customers|stats>');
}

const tenantId = statsOnly ? 'scale-stats-1000' : customers ? 'scale-customer-sales' : `scale-sales-${count}`;
const DAY = 86_400_000;
const START = Date.UTC(2025, 0, 1);

function dateOnDay(dayIndex) {
  const day = new Date(START + dayIndex * DAY);
  const month = String(day.getUTCMonth() + 1).padStart(2, '0');
  const date = String(day.getUTCDate()).padStart(2, '0');
  return `${day.getUTCFullYear()}-${month}-${date}`;
}

function localDate(index) {
  const day = new Date(START + (index % 400) * DAY);
  const month = String(day.getUTCMonth() + 1).padStart(2, '0');
  const date = String(day.getUTCDate()).padStart(2, '0');
  return `${day.getUTCFullYear()}-${month}-${date}`;
}

function customerId(index) {
  if (!customers) return null;
  if (index < 10) return 'c10';
  if (index < 1_010) return 'c1000';
  return 'c10000';
}

function saleDoc(index) {
  const id = `s${String(index).padStart(7, '0')}`;
  const customer = customerId(index);
  return [
    id,
    {
      invoiceNumber: `INV-${String(index).padStart(8, '0')}`,
      kind: index % 5 === 0 ? 'credit' : 'cash',
      currency: 'USD',
      exchangeRate: 89_500,
      items: [{ productId: 'p1', name: 'Item', quantity: 1, returnedQty: 0, unitUsdCents: 500, costUsdCents: 200 }],
      totalUsdCents: 500,
      totalLbp: 0,
      discountUsdCents: 0,
      costUsdCents: 200,
      customerId: customer,
      customerName: customer ?? '',
      orderLabel: '',
      note: '',
      payment: { receivedUsdCents: 500, receivedLbp: 0, changeUsdCents: 0, changeLbp: 0 },
      returnedUsdCents: 0,
      returnedDebtUsdCents: 0,
      refundedUsdCents: 0,
      refundedLbp: 0,
      returnStatus: 'none',
      lastReturnId: null,
      offline: false,
      localDate: localDate(index),
      createdAtMs: 1_735_689_600_000 + index,
      createdBy: 'scale',
      createdByName: 'Scale',
    },
  ];
}

function javaRss() {
  try {
    const out = execSync(
      'powershell -NoProfile -Command "(Get-Process java -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum"',
      { encoding: 'utf8' },
    );
    const bytes = Number(out.trim());
    return Number.isFinite(bytes) ? bytes : null;
  } catch {
    return null;
  }
}

const env = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: { host: '127.0.0.1', port: 8080 },
});

const started = Date.now();
const before = javaRss();
await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();
  if (statsOnly) {
    for (let start = 0; start < 1000; start += 400) {
      const batch = writeBatch(db);
      const end = Math.min(1000, start + 400);
      for (let day = start; day < end; day += 1) {
        const date = dateOnDay(day);
        batch.set(doc(db, `tenants/${tenantId}/dailyStats/${date}`), {
          date,
          salesCount: 2,
          revenueUsdCents: 3_000,
          costUsdCents: 1_200,
          discountUsdCents: 50,
          cashSalesUsdCents: 1_000,
          creditSalesUsdCents: 2_000,
          debtCollectedUsdCents: 140,
          creditIssuedUsdCents: 0,
          returnsCount: 1,
          returnsUsdCents: 300,
          returnsCostUsdCents: 120,
          expensesUsdCents: 75,
        });
      }
      await batch.commit();
    }
    return;
  }
  const batchSize = 400;
  const from = Number(process.env.SEED_FROM || 0);
  for (let start = from; start < count; start += batchSize) {
    const batch = writeBatch(db);
    const end = Math.min(count, start + batchSize);
    for (let index = start; index < end; index += 1) {
      const [id, data] = saleDoc(index);
      batch.set(doc(db, `tenants/${tenantId}/sales/${id}`), data);
    }
    await batch.commit();
    if (end % 20_000 === 0 || end === count) {
      const memory = process.memoryUsage();
      const rss = javaRss();
      console.info(JSON.stringify({ tenantId, written: end, ms: Date.now() - started, heapUsed: memory.heapUsed, javaRss: rss }));
      if (rss !== null && rss > 10_000_000_000) throw new Error(`stopping seed: emulator process is ${rss} bytes`);
    }
  }

  const stats = writeBatch(db);
  const perDay = new Array(400).fill(0);
  for (let index = 0; index < count; index += 1) perDay[index % 400] += 1;
  for (let day = 0; day < 400; day += 1) {
    const date = localDate(day);
    stats.set(doc(db, `tenants/${tenantId}/dailyStats/${date}`), {
      date,
      salesCount: perDay[day],
      revenueUsdCents: perDay[day] * 500,
      costUsdCents: perDay[day] * 200,
      discountUsdCents: 0,
      cashSalesUsdCents: perDay[day] * 400,
      creditSalesUsdCents: perDay[day] * 100,
      debtCollectedUsdCents: 0,
      creditIssuedUsdCents: 0,
      returnsCount: 0,
      returnsUsdCents: 0,
      returnsCostUsdCents: 0,
      expensesUsdCents: 0,
    });
  }
  await stats.commit();

  const returns = writeBatch(db);
  for (let index = 0; index < 5; index += 1) {
    returns.set(doc(db, `tenants/${tenantId}/returns/r${index}`), {
      number: `RF-${String(index).padStart(4, '0')}`,
      saleId: 's0000000',
      saleInvoiceNumber: 'INV-00000000',
      customerId: customerId(0),
      customerName: '',
      items: [],
      amountUsdCents: 100,
      refundUsdCents: 100,
      refundLbp: 0,
      debtReducedUsdCents: 0,
      reason: 'scale',
      localDate: localDate(0),
      createdAtMs: 1_735_689_600_000 + index,
      createdBy: 'scale',
      createdByName: 'Scale',
    });
  }
  await returns.commit();
});
await env.cleanup();
console.info(
  JSON.stringify({
    tenantId,
    count,
    ms: Date.now() - started,
    javaRssBefore: before,
    javaRssAfter: javaRss(),
    heapUsed: process.memoryUsage().heapUsed,
    note: 'emulator memory only; not written to git',
  }),
);
