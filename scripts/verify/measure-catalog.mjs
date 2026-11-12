/**
 * Times bounded catalog queries against the LOCAL emulator. Does not deploy and does not
 * touch any project other than demo-zelvero. Untimed sizes are omitted, never reported as pass.
 *
 * Usage: node scripts/verify/measure-catalog.mjs scale-products-1000
 */
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, documentId, getDocs, limit, orderBy, query, startAfter, where } from 'firebase/firestore';

const PROJECT_ID = 'demo-zelvero';
const tenantId = process.argv[2];
if (!PROJECT_ID.startsWith('demo-') || !tenantId?.startsWith('scale-')) {
  throw new Error('usage: node scripts/verify/measure-catalog.mjs scale-<products|customers|suppliers>-<count>');
}

const [, kind] = tenantId.split('-');
const PAGE = 50;

function nameNormalized(value) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function timed(db, label, build) {
  const started = performance.now();
  const snap = await getDocs(build(collection(db, `tenants/${tenantId}/${kind}`)));
  return {
    label,
    ms: Math.round(performance.now() - started),
    count: snap.size,
    ids: snap.docs.map((item) => item.id),
    last: snap.docs.at(-1) ?? null,
  };
}

const env = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: { host: '127.0.0.1', port: 8080 },
});

const rows = [];
await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();
  if (kind === 'products') {
    const first = await timed(db, 'initial-50', (col) => query(col, where('status', '==', 'active'), orderBy('nameNormalized'), orderBy(documentId()), limit(PAGE)));
    rows.push({ label: first.label, ms: first.ms, count: first.count });
    const next = await timed(db, 'next-50', (col) =>
      query(col, where('status', '==', 'active'), orderBy('nameNormalized'), orderBy(documentId()), limit(PAGE), startAfter(first.last)),
    );
    rows.push({ label: next.label, ms: next.ms, count: next.count });
    const overlap = first.ids.filter((id) => next.ids.includes(id)).length;
    rows.push({ label: 'page-overlap', ms: overlap, count: overlap });
    rows.push(await timed(db, 'category', (col) => query(col, where('status', '==', 'active'), where('category', '==', 'phones'), orderBy('nameNormalized'), orderBy(documentId()), limit(PAGE))));
    rows.push(await timed(db, 'barcode', (col) => query(col, where('barcode', '==', 'BC00000042'), where('status', '==', 'active'), limit(1))));
    const prefix = nameNormalized('product 00001');
    rows.push(
      await timed(db, 'name-prefix', (col) =>
        query(col, where('status', '==', 'active'), where('nameNormalized', '>=', prefix), where('nameNormalized', '<=', `${prefix}\uf8ff`), orderBy('nameNormalized'), orderBy(documentId()), limit(PAGE)),
      ),
    );
  } else {
    rows.push(await timed(db, 'first-page', (col) => query(col, orderBy('nameNormalized'), orderBy(documentId()), limit(PAGE))));
    const prefix = nameNormalized(kind === 'customers' ? 'customer 00001' : 'supplier 00001');
    rows.push(
      await timed(db, 'name-prefix', (col) =>
        query(col, where('nameNormalized', '>=', prefix), where('nameNormalized', '<=', `${prefix}\uf8ff`), orderBy('nameNormalized'), orderBy(documentId()), limit(PAGE)),
      ),
    );
  }
});
await env.cleanup();
console.info(JSON.stringify({ tenantId, kind, rows: rows.map(({ label, ms, count }) => ({ label, ms, count })) }, null, 2));
