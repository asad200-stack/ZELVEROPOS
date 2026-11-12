/**
 * Times production sales query shapes against the Phase I benchmark project.
 * Usage: node scripts/verify/phase-i-measure.mjs scale-sales-10000
 */
import {
  CUSTOMER_TENANT,
  PROJECT_ID,
  STATS_TENANT,
  assertBenchProject,
  dateOnDay,
  invoiceNumber,
  saleId,
} from './phase-i-config.mjs';
import { FS, fieldFilter, headers, int, order, runQuery, str } from './phase-i-rest.mjs';

assertBenchProject();

const tenantId = process.argv[2];
if (!tenantId?.startsWith('scale-')) throw new Error('usage: node scripts/verify/phase-i-measure.mjs scale-sales-<n>|scale-customer-sales|scale-stats-1000');

const REPS = 7;
const parent = `tenants/${tenantId}`;
const errors = [];

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summarize(times) {
  const sorted = [...times].sort((a, b) => a - b);
  return {
    coldMs: times[0],
    warmMs: times[1] ?? null,
    repeatMs: times.at(-1),
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    min: sorted[0],
    max: sorted.at(-1),
    reps: times.length,
  };
}

async function timed(label, fn) {
  const times = [];
  let last = null;
  for (let i = 0; i < REPS; i += 1) {
    const t0 = performance.now();
    try {
      last = await fn();
      times.push(Math.round(performance.now() - t0));
    } catch (error) {
      times.push(Math.round(performance.now() - t0));
      errors.push({ label, i, message: String(error.message || error).slice(0, 300) });
      last = { docs: [], error: true };
      break;
    }
  }
  const docs = last?.docs || [];
  return {
    label,
    ...summarize(times),
    count: docs.length,
    first: docs[0]?.id ?? null,
    last: docs.at(-1)?.id ?? null,
    extra: last?.extra ?? undefined,
  };
}

function docId(row) {
  const name = row.document?.name || '';
  return name.split('/').pop() || null;
}

function fieldsOf(row) {
  return row.document?.fields || {};
}

function val(field) {
  if (!field) return undefined;
  if (field.stringValue != null) return field.stringValue;
  if (field.integerValue != null) return Number(field.integerValue);
  return undefined;
}

async function salesPage({ from, to, kind, customerId, cursor }) {
  const filters = [fieldFilter('localDate', 'GREATER_THAN_OR_EQUAL', str(from)), fieldFilter('localDate', 'LESS_THAN_OR_EQUAL', str(to))];
  if (kind) filters.push(fieldFilter('kind', 'EQUAL', str(kind)));
  if (customerId) filters.push(fieldFilter('customerId', 'EQUAL', str(customerId)));
  const structuredQuery = {
    from: [{ collectionId: 'sales' }],
    where: { compositeFilter: { op: 'AND', filters } },
    orderBy: [order('localDate', true), order('createdAtMs', true), order('__name__', true)],
    limit: 50,
  };
  if (cursor) {
    structuredQuery.startAt = {
      before: false,
      values: [
        str(cursor.localDate),
        int(cursor.createdAtMs),
        { referenceValue: `projects/${PROJECT_ID}/databases/(default)/documents/tenants/${tenantId}/sales/${cursor.id}` },
      ],
    };
  }
  const rows = await runQuery(parent, structuredQuery);
  const docs = rows.map((row) => {
    const f = fieldsOf(row);
    return { id: docId(row), localDate: val(f.localDate), createdAtMs: val(f.createdAtMs), kind: val(f.kind), customerId: val(f.customerId), invoiceNumber: val(f.invoiceNumber) };
  });
  return { docs };
}

async function getDocument(path) {
  const res = await fetch(`${FS}/documents/${path}`, { headers: headers() });
  const json = await res.json();
  return { ok: res.ok, json };
}

const rows = [];

if (tenantId === STATS_TENANT) {
  for (const [label, fromIdx, toIdx, expected] of [
    ['stats-30', 0, 29, 30],
    ['stats-365', 0, 364, 365],
    ['stats-1000', 0, 999, 1000],
  ]) {
    const from = dateOnDay(fromIdx);
    const to = dateOnDay(toIdx);
    const result = await timed(label, async () => {
      const qrows = await runQuery(parent, {
        from: [{ collectionId: 'dailyStats' }],
        where: {
          compositeFilter: {
            op: 'AND',
            filters: [fieldFilter('date', 'GREATER_THAN_OR_EQUAL', str(from)), fieldFilter('date', 'LESS_THAN_OR_EQUAL', str(to))],
          },
        },
        orderBy: [order('date', false)],
        limit: 1000,
      });
      const docs = qrows.map((row) => {
        const f = fieldsOf(row);
        return { id: docId(row), salesCount: val(f.salesCount) || 0, revenueUsdCents: val(f.revenueUsdCents) || 0 };
      });
      const salesCount = docs.reduce((s, d) => s + d.salesCount, 0);
      const revenue = docs.reduce((s, d) => s + d.revenueUsdCents, 0);
      return { docs, extra: { salesCount, revenue, ok: docs.length === expected && salesCount === expected * 2 && revenue === expected * 1000 } };
    });
    rows.push(result);
  }
  console.info(JSON.stringify({ project: PROJECT_ID, tenantId, rows, errors }, null, 2));
  process.exit(errors.length ? 1 : 0);
}

const first = await timed('first-page', () => salesPage({ from: '2025-01-01', to: '2026-12-31' }));
rows.push(first);
const firstLive = await salesPage({ from: '2025-01-01', to: '2026-12-31' });
const cursorDoc = firstLive.docs.at(-1);
const next = await timed('next-page', () => salesPage({ from: '2025-01-01', to: '2026-12-31', cursor: cursorDoc }));
rows.push(next);
const nextLive = await salesPage({ from: '2025-01-01', to: '2026-12-31', cursor: cursorDoc });
const shared = firstLive.docs.filter((a) => nextLive.docs.some((b) => b.id === a.id)).map((d) => d.id);
rows.push({ label: 'page-overlap', count: shared.length, ids: shared });

rows.push(await timed('today', () => salesPage({ from: '2025-01-01', to: '2025-01-01' })));
rows.push(await timed('7-days', () => salesPage({ from: '2025-01-01', to: '2025-01-07' })));
rows.push(await timed('30-days', () => salesPage({ from: '2025-01-01', to: '2025-01-30' })));
rows.push(await timed('custom', () => salesPage({ from: '2025-06-01', to: '2025-06-15' })));

const cash = await timed('kind-cash', () => salesPage({ from: '2025-01-01', to: '2026-12-31', kind: 'cash' }));
rows.push(cash);
const cashLive = await salesPage({ from: '2025-01-01', to: '2026-12-31', kind: 'cash' });
rows.push({ label: 'kind-cash-only', ok: cashLive.docs.every((d) => d.kind === 'cash'), count: cashLive.docs.length });

const credit = await timed('kind-credit', () => salesPage({ from: '2025-01-01', to: '2026-12-31', kind: 'credit' }));
rows.push(credit);
const creditLive = await salesPage({ from: '2025-01-01', to: '2026-12-31', kind: 'credit' });
rows.push({ label: 'kind-credit-only', ok: creditLive.docs.every((d) => d.kind === 'credit'), count: creditLive.docs.length });

rows.push(
  await timed('invoice', async () => {
    const qrows = await runQuery(parent, {
      from: [{ collectionId: 'sales' }],
      where: fieldFilter('invoiceNumber', 'EQUAL', str(invoiceNumber(42))),
      limit: 1,
    });
    const docs = qrows.map((row) => ({ id: docId(row), invoiceNumber: val(fieldsOf(row).invoiceNumber) }));
    return { docs, extra: { ok: docs.length === 1 && docs[0].invoiceNumber === invoiceNumber(42) } };
  }),
);

rows.push(
  await timed('direct-id', async () => {
    const got = await getDocument(`tenants/${tenantId}/sales/${saleId(42)}`);
    return { docs: got.ok ? [{ id: saleId(42) }] : [], extra: { exists: got.ok } };
  }),
);

for (const [label, saleIndex, expected] of [
  ['returns-1', 0, 1],
  ['returns-5', 1, 5],
  ['returns-50', 2, 50],
]) {
  rows.push(
    await timed(label, async () => {
      const qrows = await runQuery(parent, {
        from: [{ collectionId: 'returns' }],
        where: fieldFilter('saleId', 'EQUAL', str(saleId(saleIndex))),
        orderBy: [order('createdAtMs', true), order('__name__', true)],
        limit: 50,
      });
      const docs = qrows.map((row) => ({ id: docId(row) }));
      return { docs, extra: { ok: docs.length === expected } };
    }),
  );
}

async function statsRange(from, to) {
  const qrows = await runQuery(parent, {
    from: [{ collectionId: 'dailyStats' }],
    where: {
      compositeFilter: {
        op: 'AND',
        filters: [fieldFilter('date', 'GREATER_THAN_OR_EQUAL', str(from)), fieldFilter('date', 'LESS_THAN_OR_EQUAL', str(to))],
      },
    },
    orderBy: [order('date', false)],
    limit: 1000,
  });
  return { docs: qrows.map((row) => ({ id: docId(row) })) };
}
rows.push(await timed('daily-stats-7', () => statsRange('2025-01-01', '2025-01-07')));
rows.push(await timed('daily-stats-30', () => statsRange('2025-01-01', '2025-01-30')));
rows.push(await timed('daily-stats-365', () => statsRange('2025-01-01', '2025-12-31')));

const customerIds = tenantId === CUSTOMER_TENANT ? ['c10', 'c1000', 'c10000', 'c100000'] : tenantId.startsWith('scale-sales-') ? ['c0000'] : [];
if (customerIds.length) {
  for (const customerId of customerIds) {
    const page1 = await timed(`customer-${customerId}`, () => salesPage({ from: '2025-01-01', to: '2026-12-31', customerId }));
    rows.push(page1);
    const live1 = await salesPage({ from: '2025-01-01', to: '2026-12-31', customerId });
    const page2 = await timed(`customer-${customerId}-next`, () =>
      salesPage({ from: '2025-01-01', to: '2026-12-31', customerId, cursor: live1.docs.at(-1) }),
    );
    rows.push(page2);
    const live2 = await salesPage({ from: '2025-01-01', to: '2026-12-31', customerId, cursor: live1.docs.at(-1) });
    const ov = live1.docs.filter((a) => live2.docs.some((b) => b.id === a.id)).length;
    rows.push({
      label: `customer-${customerId}-check`,
      count: live1.docs.length,
      nextCount: live2.docs.length,
      overlap: ov,
      max50: live1.docs.length <= 50 && live2.docs.length <= 50,
      stable: live1.docs[0]?.id && page1.first === live1.docs[0].id,
    });
  }
}

console.info(JSON.stringify({ project: PROJECT_ID, tenantId, rows, errors }, null, 2));
if (errors.length) process.exitCode = 1;
