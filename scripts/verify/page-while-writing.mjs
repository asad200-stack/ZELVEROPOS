/**
 * Pages a sales collection, inserts one newer sale, then moves next and back.
 * Local emulator, project demo-zelvero only.
 *
 * Usage: node scripts/verify/page-while-writing.mjs scale-sales-10000
 */
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, documentId, getDocs, limit, orderBy, query, setDoc, startAfter, where } from 'firebase/firestore';

const tenantId = process.argv[2];
if (!tenantId?.startsWith('scale-sales-')) throw new Error('usage: node scripts/verify/page-while-writing.mjs scale-sales-<count>');

function pageQuery(sales, cursor) {
  const constraints = [
    where('localDate', '>=', '2025-01-01'),
    where('localDate', '<=', '2026-12-31'),
    orderBy('localDate', 'desc'),
    orderBy('createdAtMs', 'desc'),
    orderBy(documentId(), 'desc'),
    limit(50),
  ];
  if (cursor) constraints.push(startAfter(cursor.get('localDate'), cursor.get('createdAtMs'), cursor.id));
  return query(sales, ...constraints);
}

const env = await initializeTestEnvironment({
  projectId: 'demo-zelvero',
  firestore: { host: '127.0.0.1', port: 8080 },
});

await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();
  const sales = collection(db, `tenants/${tenantId}/sales`);
  const first = await getDocs(pageQuery(sales, null));
  const firstIds = first.docs.map((item) => item.id);
  await setDoc(doc(db, `tenants/${tenantId}/sales/s-new`), {
    invoiceNumber: 'INV-NEW-PAGE',
    kind: 'cash',
    currency: 'USD',
    exchangeRate: 89_500,
    items: [],
    totalUsdCents: 100,
    totalLbp: 0,
    discountUsdCents: 0,
    costUsdCents: 0,
    customerId: null,
    customerName: '',
    orderLabel: '',
    note: '',
    payment: { receivedUsdCents: 100, receivedLbp: 0, changeUsdCents: 0, changeLbp: 0 },
    returnedUsdCents: 0,
    returnedDebtUsdCents: 0,
    refundedUsdCents: 0,
    refundedLbp: 0,
    returnStatus: 'none',
    lastReturnId: null,
    offline: false,
    localDate: '2026-12-31',
    createdAtMs: 1_900_000_000_000,
    createdBy: 'scale',
    createdByName: 'Scale',
  });
  const second = await getDocs(pageQuery(sales, first.docs.at(-1)));
  const secondIds = second.docs.map((item) => item.id);
  const overlap = firstIds.filter((id) => secondIds.includes(id));
  const back = await getDocs(pageQuery(sales, null));
  const backIds = back.docs.map((item) => item.id);
  console.info(
    JSON.stringify({
      tenantId,
      pagination: 'cursor, not a live listener',
      firstCount: firstIds.length,
      nextCount: secondIds.length,
      overlap: overlap.length,
      newSaleOnNext: secondIds.includes('s-new'),
      newSaleOnReturnToFirst: backIds.includes('s-new'),
      backStillFifty: backIds.length === 50,
      duplicateWithinNext: new Set(secondIds).size === secondIds.length,
    }),
  );
});

await env.cleanup();
