/**
 * Seeds the LOCAL demo-zelvero emulators with one synthetic internal-demo store.
 * Refuses any project id that does not start with "demo-". Does not touch production.
 *
 * Requires the Auth emulator on 127.0.0.1:9099 and Firestore on 127.0.0.1:8080.
 */
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp } from 'firebase/firestore';

const PROJECT_ID = 'demo-zelvero';
const AUTH = 'http://127.0.0.1:9099';
const TENANT = 'previewDemo';
const EMAIL = 'owner@preview.zelvero.test';
const PASSWORD = 'demo-pass-1';

if (!PROJECT_ID.startsWith('demo-')) throw new Error('preview seed only runs against demo- projects');

async function authPost(path, body, admin = false) {
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/${path}${admin ? '' : '?key=demo'}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(admin ? { Authorization: 'Bearer owner' } : {}) },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`auth emulator ${path}: ${JSON.stringify(json)}`);
  return json;
}

const products = [
  ['oil', 'زيت زيتون بكر ممتاز عبوة كبيرة ٥ لتر', 125, 40, null],
  ['phone', 'Samsung Galaxy A55 5G 256GB', 129999, 3, 5],
  ['charger', 'شاحن سريع USB-C Fast Charger 65W', 2450, 0, null],
  ['water', 'Mineral Water 500ml × 24 pack', 575, 15, null],
  ['rice', 'أرز بسمتي هندي فاخر ١٠ كغ', 1899, 25, null],
  ['bread', 'Bread', 100, 30, null],
  ['soap', 'صابون زيت غار طبيعي', 350, 12, null],
  ['tea', 'شاي أسود فاخر علبة معدنية', 450, 8, null],
  ['juice', 'Orange Juice 1L', 225, 18, null],
  ['sugar', 'سكر أبيض ناعم ٥ كغ', 399, 22, null],
  ['mix', 'Samsung شاحن سريع Mixed Name USB-C 65W للهاتف الذكي', 1999, 9, null],
  ['longen', 'Professional cordless barcode scanner with extra long English product title for layout', 4599, 6, null],
];
for (let n = 1; n <= 45; n += 1) {
  products.push([`item${n}`, `Item ${String(n).padStart(2, '0')}`, 100 + n, 20, null]);
}

await authPost(`projects/${PROJECT_ID}/accounts`, { localId: TENANT, email: EMAIL, password: PASSWORD, emailVerified: true }, true).catch(() => {});
await authPost(
  `projects/${PROJECT_ID}/accounts:update`,
  {
    localId: TENANT,
    emailVerified: true,
    customAttributes: JSON.stringify({
      tenantId: TENANT,
      role: 'owner',
      active: true,
      subUntil: Date.now() + 30 * 86_400_000,
      cv: 1,
    }),
  },
  true,
);

const env = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { host: '127.0.0.1', port: 8080 } });
await env.withSecurityRulesDisabled(async (ctx) => {
  const fs = ctx.firestore();
  const now = Timestamp.now();
  await setDoc(doc(fs, `users/${TENANT}`), {
    uid: TENANT,
    email: EMAIL,
    fullName: 'Preview Owner',
    role: 'owner',
    tenantId: TENANT,
    isActive: true,
    permissions: {},
    claimsVersion: 1,
    createdAt: now,
  });
  await setDoc(doc(fs, `subscriptions/${TENANT}`), {
    activated: true,
    lifetime: false,
    internalDemo: true,
    endsAt: Timestamp.fromMillis(Date.now() + 30 * 86_400_000),
  });
  await setDoc(doc(fs, `tenants/${TENANT}`), { ownerUid: TENANT, createdAt: now });
  await setDoc(doc(fs, `tenants/${TENANT}/settings/main`), {
    storeName: 'ZELVERO INTERNAL DEMO',
    exchangeRate: 89500,
    defaultCurrency: 'USD',
    lowStockThreshold: 5,
    updatedAt: now,
  });
  await setDoc(doc(fs, `tenants/${TENANT}/counters/sales`), { nextId: 1, updatedAt: now });
  await setDoc(doc(fs, `tenants/${TENANT}/cashbox/summary`), { usdCents: 45000, lbp: 0, lastTxId: null, updatedAt: now });
  await setDoc(doc(fs, `tenants/${TENANT}/lists/categories`), { names: ['Grocery', 'Phones'] });
  for (const [id, name, retail, stock, minStock] of products) {
    await setDoc(doc(fs, `tenants/${TENANT}/products/${id}`), {
      name,
      nameNormalized: name.trim().toLowerCase().replace(/\s+/g, ' '),
      category: 'Grocery',
      barcode: String(id).toUpperCase(),
      prices: { retail: { usdCents: retail, lbp: null }, wholesale: { usdCents: 0, lbp: null }, vip: { usdCents: 0, lbp: null } },
      costUsdCents: Math.round(retail / 2),
      stock,
      minStock,
      supplierId: null,
      supplierName: '',
      expiryDate: null,
      imeiTracking: false,
      imeis: [],
      imageUrl: null,
      imagePath: null,
      lastMovementId: null,
      status: 'active',
      archivedAt: null,
      createdAt: now,
      createdAtMs: Date.now(),
      createdBy: TENANT,
      updatedAt: now,
    });
  }
});
await env.cleanup();
console.log(`Seeded synthetic internal demo "${TENANT}" as ${EMAIL} on ${PROJECT_ID}.`);
