/**
 * Resumable synthetic seed into the Phase I benchmark project only.
 * Usage:
 *   node scripts/verify/phase-i-seed.mjs 10000
 *   node scripts/verify/phase-i-seed.mjs 100000
 *   node scripts/verify/phase-i-seed.mjs 500000
 *   node scripts/verify/phase-i-seed.mjs 1000000
 *   node scripts/verify/phase-i-seed.mjs customers
 *   node scripts/verify/phase-i-seed.mjs stats
 *   node scripts/verify/phase-i-seed.mjs extras 10000
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CUSTOMER_HISTORY_COUNT,
  CUSTOMER_TENANT,
  DATE_SPAN,
  SALES_SIZES,
  STATS_TENANT,
  assertBenchProject,
  createdAtMs,
  customerForScaleSale,
  customerHistoryId,
  dateOnDay,
  invoiceNumber,
  localDate,
  saleFields,
  saleId,
  salesTenant,
} from './phase-i-config.mjs';
import { commit, countQuery, docName, encode } from './phase-i-rest.mjs';

assertBenchProject();

const arg = process.argv[2];
const BATCH = 250;
const PARALLEL = 3;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const CHECK_DIR = join(ROOT, 'scripts/verify/.phase-i');

function checkpointPath(tenantId) {
  return join(CHECK_DIR, `${tenantId}.json`);
}

function loadCheckpoint(tenantId) {
  const file = checkpointPath(tenantId);
  if (!existsSync(file)) return { next: 0, writes: 0, retries: 0 };
  return JSON.parse(readFileSync(file, 'utf8'));
}

function saveCheckpoint(tenantId, data) {
  mkdirSync(CHECK_DIR, { recursive: true });
  writeFileSync(checkpointPath(tenantId), `${JSON.stringify(data)}\n`);
}

function updateWrite(path, data) {
  return { update: { name: docName(path), fields: encode(data).mapValue.fields } };
}

function dailyStatsDoc(date, salesCount) {
  const cash = Math.round(salesCount * 0.8);
  const credit = salesCount - cash;
  return {
    date,
    salesCount,
    revenueUsdCents: salesCount * 500,
    costUsdCents: salesCount * 200,
    discountUsdCents: 0,
    cashSalesUsdCents: cash * 500,
    creditSalesUsdCents: credit * 500,
    debtCollectedUsdCents: 0,
    creditIssuedUsdCents: 0,
    returnsCount: 0,
    returnsUsdCents: 0,
    returnsCostUsdCents: 0,
    expensesUsdCents: 0,
  };
}

function returnDoc(saleIndex, n, saleCountHint) {
  return {
    number: `RF-${String(n).padStart(4, '0')}`,
    saleId: saleId(saleIndex),
    saleInvoiceNumber: invoiceNumber(saleIndex),
    customerId: saleCountHint === 'customers' ? customerHistoryId(saleIndex) : customerForScaleSale(saleIndex),
    customerName: '',
    items: [],
    amountUsdCents: 100,
    refundUsdCents: 100,
    refundLbp: 0,
    debtReducedUsdCents: 0,
    reason: 'scale',
    localDate: localDate(saleIndex),
    createdAtMs: createdAtMs(saleIndex) + n,
    createdBy: 'scale',
    createdByName: 'Scale',
  };
}

async function commitBatches(jobs) {
  let retries = 0;
  const queue = [...jobs];
  const workers = Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => {
    while (queue.length) {
      const writes = queue.shift();
      let attempt = 0;
      for (;;) {
        try {
          await commit(writes);
          break;
        } catch (error) {
          attempt += 1;
          retries += 1;
          if (attempt >= 16) throw error;
          await new Promise((r) => setTimeout(r, Math.min(20_000, 250 * 2 ** attempt)));
        }
      }
    }
  });
  await Promise.all(workers);
  return retries;
}

async function seedSales({ tenantId, count, customerOf }) {
  const started = Date.now();
  const check = loadCheckpoint(tenantId);
  let next = check.next;
  let writes = check.writes || 0;
  let retries = check.retries || 0;
  console.info(JSON.stringify({ tenantId, resumeFrom: next, target: count }));

  while (next < count) {
    const jobs = [];
    let end = next;
    for (let p = 0; p < PARALLEL && end < count; p += 1) {
      const start = end;
      end = Math.min(count, start + BATCH);
      const writesBatch = [];
      for (let i = start; i < end; i += 1) {
        writesBatch.push(updateWrite(`tenants/${tenantId}/sales/${saleId(i)}`, saleFields(i, customerOf(i))));
      }
      jobs.push(writesBatch);
    }
    retries += await commitBatches(jobs);
    writes += end - next;
    next = end;
    saveCheckpoint(tenantId, { next, writes, retries, ms: Date.now() - started, target: count });
    console.info(JSON.stringify({ tenantId, written: next, writes, retries, ms: Date.now() - started, heapUsed: process.memoryUsage().heapUsed }));
  }

  const perDay = new Array(DATE_SPAN).fill(0);
  for (let i = 0; i < count; i += 1) perDay[i % DATE_SPAN] += 1;
  const statJobs = [];
  for (let day = 0; day < DATE_SPAN; day += BATCH) {
    const batch = [];
    const stop = Math.min(DATE_SPAN, day + BATCH);
    for (let d = day; d < stop; d += 1) {
      const date = localDate(d);
      batch.push(updateWrite(`tenants/${tenantId}/dailyStats/${date}`, dailyStatsDoc(date, perDay[d])));
    }
    statJobs.push(batch);
  }
  retries += await commitBatches(statJobs);

  const kind = tenantId === CUSTOMER_TENANT ? 'customers' : 'sales';
  const ret = [];
  ret.push(updateWrite(`tenants/${tenantId}/returns/r1-${saleId(0)}-0`, returnDoc(0, 0, kind)));
  for (let n = 0; n < 5; n += 1) ret.push(updateWrite(`tenants/${tenantId}/returns/r5-${saleId(1)}-${n}`, returnDoc(1, n, kind)));
  for (let n = 0; n < 50; n += 1) ret.push(updateWrite(`tenants/${tenantId}/returns/r50-${saleId(2)}-${n}`, returnDoc(2, n, kind)));
  retries += await commitBatches([ret]);

  const salesCount = await countQuery(`tenants/${tenantId}`, 'sales');
  saveCheckpoint(tenantId, { next: count, writes, retries, ms: Date.now() - started, target: count, verified: salesCount });
  const ok = salesCount === count;
  console.info(JSON.stringify({ tenantId, verified: salesCount, expected: count, ok, writes, retries, ms: Date.now() - started }));
  if (!ok) process.exitCode = 1;
}

async function seedStats() {
  const started = Date.now();
  const tenantId = STATS_TENANT;
  const jobs = [];
  for (let day = 0; day < 1000; day += BATCH) {
    const batch = [];
    const stop = Math.min(1000, day + BATCH);
    for (let d = day; d < stop; d += 1) {
      const date = dateOnDay(d);
      batch.push(updateWrite(`tenants/${tenantId}/dailyStats/${date}`, dailyStatsDoc(date, 2)));
    }
    jobs.push(batch);
  }
  const retries = await commitBatches(jobs);
  const n = await countQuery(`tenants/${tenantId}`, 'dailyStats');
  console.info(JSON.stringify({ tenantId, verified: n, expected: 1000, ok: n === 1000, retries, ms: Date.now() - started }));
  if (n !== 1000) process.exitCode = 1;
}

if (arg === 'stats') {
  await seedStats();
} else if (arg === 'customers') {
  await seedSales({
    tenantId: CUSTOMER_TENANT,
    count: CUSTOMER_HISTORY_COUNT,
    customerOf: customerHistoryId,
  });
} else {
  const count = Number(arg);
  if (!SALES_SIZES.includes(count)) {
    throw new Error('usage: node scripts/verify/phase-i-seed.mjs <10000|100000|500000|1000000|customers|stats>');
  }
  await seedSales({
    tenantId: salesTenant(count),
    count,
    customerOf: customerForScaleSale,
  });
}
