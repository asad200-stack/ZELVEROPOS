/**
 * Times bounded sales queries against the LOCAL emulator. Does not deploy.
 * A size that was not seeded is not reported as a pass.
 *
 * Usage: node scripts/verify/measure-sales.mjs scale-sales-10000
 */
import { execSync } from 'node:child_process';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, documentId, getDoc, getDocs, limit, orderBy, query, startAfter, where } from 'firebase/firestore';

const PROJECT_ID = 'demo-zelvero';
const tenantId = process.argv[2];
if (!PROJECT_ID.startsWith('demo-') || !tenantId?.startsWith('scale-')) {
  throw new Error('usage: node scripts/verify/measure-sales.mjs scale-sales-<count>|scale-customer-sales');
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

const rows = [];
await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();
  const sales = collection(db, `tenants/${tenantId}/sales`);

  function javaSample() {
    try {
      const out = execSync(
        "powershell -NoProfile -Command \"(Get-Process java -ErrorAction SilentlyContinue | Select-Object -First 1 | ForEach-Object { '{0} {1}' -f $_.CPU, $_.WorkingSet64 })\"",
        { encoding: 'utf8' },
      );
      const [cpu, rss] = out.trim().split(/\s+/);
      return { cpuSeconds: Number(cpu), rssBytes: Number(rss) };
    } catch {
      return null;
    }
  }

  async function samples(label, build) {
    const times = [];
    let snap = null;
    const before = javaSample();
    for (let pass = 0; pass < 3; pass += 1) {
      const started = performance.now();
      snap = await getDocs(build());
      times.push(Math.round(performance.now() - started));
    }
    const after = javaSample();
    rows.push({
      label,
      coldMs: times[0],
      warmMs: times[1],
      repeatMs: times[2],
      count: snap.size,
      first: snap.docs[0]?.id ?? null,
      last: snap.docs.at(-1)?.id ?? null,
      cpuSeconds: before && after ? Math.round((after.cpuSeconds - before.cpuSeconds) * 1000) / 1000 : null,
      rssBytes: after?.rssBytes ?? null,
    });
    return snap;
  }

  function page(from, to, extra = [], cursor = null) {
    const constraints = [where('localDate', '>=', from), where('localDate', '<=', to), ...extra];
    constraints.push(orderBy('localDate', 'desc'), orderBy('createdAtMs', 'desc'), orderBy(documentId(), 'desc'), limit(50));
    if (cursor) constraints.push(startAfter(cursor.get('localDate'), cursor.get('createdAtMs'), cursor.id));
    return query(sales, ...constraints);
  }

  if (tenantId === 'scale-stats-1000') {
    const origin = Date.UTC(2025, 0, 1);
    const day = (index) => {
      const date = new Date(origin + index * 86_400_000);
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const dom = String(date.getUTCDate()).padStart(2, '0');
      return `${date.getUTCFullYear()}-${month}-${dom}`;
    };
    const statsCol = collection(db, `tenants/${tenantId}/dailyStats`);
    for (const [label, from, to, expected] of [
      ['stats-30', day(0), day(29), 30],
      ['stats-365', day(0), day(364), 365],
      ['stats-1000', day(0), day(999), 1000],
    ]) {
      const snap = await samples(label, () =>
        query(statsCol, where('date', '>=', from), where('date', '<=', to), orderBy('date', 'asc'), limit(1000)),
      );
      const salesCount = snap.docs.reduce((sum, item) => sum + Number(item.get('salesCount') || 0), 0);
      const revenue = snap.docs.reduce((sum, item) => sum + Number(item.get('revenueUsdCents') || 0), 0);
      rows.push({
        label: `${label}-check`,
        count: snap.size,
        salesCount,
        revenue,
        ok: snap.size === expected && salesCount === expected * 2 && revenue === expected * 3_000,
      });
    }
    return;
  }

  const first = await samples('first-page', () => page('2025-01-01', '2026-12-31'));
  const second = await samples('next-page', () => page('2025-01-01', '2026-12-31', [], first.docs.at(-1)));
  const overlap = first.docs.filter((item) => second.docs.some((other) => other.id === item.id)).length;
  rows.push({ label: 'page-overlap', count: overlap });

  await samples('today', () => page('2025-01-01', '2025-01-01'));
  await samples('7-days', () => page('2025-01-01', '2025-01-07'));
  await samples('30-days', () => page('2025-01-01', '2025-01-30'));
  await samples('custom', () => page('2025-06-01', '2025-06-15'));
  const cash = await samples('kind-cash', () => page('2025-01-01', '2026-12-31', [where('kind', '==', 'cash')]));
  rows.push({ label: 'kind-cash-only', ok: cash.docs.every((item) => item.get('kind') === 'cash') });

  const invoice = await samples('invoice', () => query(sales, where('invoiceNumber', '==', 'INV-00000042'), limit(1)));
  rows.push({ label: 'invoice-exact', ok: invoice.size === 1 && invoice.docs[0]?.get('invoiceNumber') === 'INV-00000042' });

  const directStarted = performance.now();
  const direct = await getDoc(doc(db, `tenants/${tenantId}/sales/s0000042`));
  rows.push({ label: 'reprint-by-id', ms: Math.round(performance.now() - directStarted), exists: direct.exists() });

  const returnStarted = performance.now();
  const returns = await getDocs(
    query(
      collection(db, `tenants/${tenantId}/returns`),
      where('saleId', '==', 's0000000'),
      orderBy('createdAtMs', 'desc'),
      orderBy(documentId(), 'desc'),
      limit(50),
    ),
  );
  rows.push({ label: 'returns-for-sale', ms: Math.round(performance.now() - returnStarted), count: returns.size });

  const statsStarted = performance.now();
  const stats = await getDocs(
    query(
      collection(db, `tenants/${tenantId}/dailyStats`),
      where('date', '>=', '2025-01-01'),
      where('date', '<=', '2025-01-07'),
      orderBy('date', 'asc'),
      limit(1000),
    ),
  );
  rows.push({ label: 'daily-stats-7', ms: Math.round(performance.now() - statsStarted), count: stats.size });

  if (tenantId === 'scale-customer-sales') {
    for (const customerId of ['c10', 'c1000', 'c10000']) {
      const snap = await samples(`customer-${customerId}`, () =>
        page('2025-01-01', '2026-12-31', [where('customerId', '==', customerId)]),
      );
      const next = await samples(`customer-${customerId}-next`, () =>
        page('2025-01-01', '2026-12-31', [where('customerId', '==', customerId)], snap.docs.at(-1)),
      );
      const shared = snap.docs.filter((item) => next.docs.some((other) => other.id === item.id)).length;
      rows.push({ label: `customer-${customerId}-overlap`, count: shared });
      await samples(`customer-${customerId}-open`, () =>
        query(
          sales,
          where('customerId', '==', customerId),
          orderBy('localDate', 'desc'),
          orderBy('createdAtMs', 'desc'),
          orderBy(documentId(), 'desc'),
          limit(50),
        ),
      );
    }
  }
});

await env.cleanup();
console.info(
  JSON.stringify({
    tenantId,
    javaRss: javaRss(),
    heapUsed: process.memoryUsage().heapUsed,
    rows,
  }),
);
