/**
 * Writes a deterministic catalog into the LOCAL Firestore emulator only.
 * Nothing is written to disk and nothing is committed. The documents live in the
 * emulator process (project demo-zelvero) until it stops.
 *
 * Usage:
 *   node scripts/verify/seed-catalog.mjs products 1000
 *   node scripts/verify/seed-catalog.mjs customers 10000
 *   node scripts/verify/seed-catalog.mjs suppliers 1000
 *
 * Tenant ids: scale-products-1000, scale-customers-10000, scale-suppliers-1000.
 */
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, writeBatch } from 'firebase/firestore';

const PROJECT_ID = 'demo-zelvero';
const [kind, rawCount] = process.argv.slice(2);
const count = Number(rawCount);
const allowed = { products: [1000, 10_000, 50_000, 100_000], customers: [1000, 10_000, 50_000], suppliers: [1000, 10_000] };

if (!PROJECT_ID.startsWith('demo-')) throw new Error('refusing to seed a non-demo project');
if (!allowed[kind]?.includes(count)) {
  throw new Error(`usage: node scripts/verify/seed-catalog.mjs <products|customers|suppliers> <${Object.entries(allowed).map(([k, v]) => `${k}:${v.join('|')}`).join(' ')}>`);
}

const CATEGORIES = ['phones', 'cables', 'cases', 'audio', 'power'];
const tenantId = `scale-${kind}-${count}`;

function nameNormalized(value) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function productDoc(index) {
  const name = `Product ${String(index).padStart(6, '0')}`;
  const id = `p${String(index).padStart(6, '0')}`;
  return [
    id,
    {
      name,
      nameNormalized: nameNormalized(name),
      category: CATEGORIES[index % CATEGORIES.length],
      barcode: `BC${String(index).padStart(8, '0')}`,
      prices: {
        retail: { usdCents: 500 + (index % 20) * 100, lbp: null },
        wholesale: { usdCents: 400, lbp: null },
        vip: { usdCents: 350, lbp: null },
      },
      costUsdCents: 200,
      stock: index % 17,
      minStock: 2,
      supplierId: null,
      supplierName: '',
      expiryDate: null,
      imeiTracking: false,
      imeis: [],
      imageUrl: null,
      imagePath: null,
      lastMovementId: null,
      status: index % 50 === 0 ? 'archived' : 'active',
      archivedAt: null,
      createdAtMs: 1_700_000_000_000 + index,
      createdBy: 'scale',
    },
  ];
}

function partyDoc(index, collectionName) {
  const name = `${collectionName === 'customers' ? 'Customer' : 'Supplier'} ${String(index).padStart(6, '0')}`;
  const id = `${collectionName === 'customers' ? 'c' : 's'}${String(index).padStart(6, '0')}`;
  const phone = `9617${String(index).padStart(7, '0')}`;
  const email = `${id}@scale.test`;
  const base = {
    name,
    nameNormalized: nameNormalized(name),
    phone,
    phoneKey: phone,
    email,
    emailKey: email,
    address: '',
    createdAtMs: 1_700_000_000_000 + index,
    createdBy: 'scale',
  };
  if (collectionName === 'customers') {
    return [id, { ...base, creditLimitUsdCents: 10_000, debtUsdCents: index % 10 === 0 ? 1500 : 0, totalPurchasesUsdCents: index * 10, lastLedgerId: null }];
  }
  return [id, { ...base, contactPerson: '', balanceUsdCents: index % 10 === 0 ? 2500 : 0 }];
}

const env = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: { host: '127.0.0.1', port: 8080 },
});

const started = Date.now();
let written = 0;
await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();
  const batchSize = 400;
  for (let start = 0; start < count; start += batchSize) {
    const batch = writeBatch(db);
    const end = Math.min(count, start + batchSize);
    for (let index = start; index < end; index += 1) {
      const [id, data] = kind === 'products' ? productDoc(index) : partyDoc(index, kind);
      batch.set(doc(db, `tenants/${tenantId}/${kind}/${id}`), data);
    }
    await batch.commit();
    written = end;
    if (written % 5000 === 0 || written === count) console.info(JSON.stringify({ tenantId, written, ms: Date.now() - started }));
  }
});
await env.cleanup();
console.info(JSON.stringify({ tenantId, count, kind, ms: Date.now() - started, note: 'emulator memory only; not written to git' }));
