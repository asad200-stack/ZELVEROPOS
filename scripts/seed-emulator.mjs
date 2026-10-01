/**
 * Seeds the LOCAL Firebase Emulator Suite (project demo-zelvero) for manual testing — password demo-pass-1:
 *   Store A "demoStore":  owner@zelvero.test / cashier@zelvero.test / cashier2@zelvero.test
 *   Store B "demoStore2": owner2@zelvero.test / cashier-b@zelvero.test (independent products, customer,
 *                         drawer and settings; used only to verify cross-tenant isolation)
 * Refuses to run against anything but the emulators of a "demo-" project.
 *
 * Usage (emulators running): node scripts/seed-emulator.mjs
 */
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp } from 'firebase/firestore';

const PROJECT_ID = 'demo-zelvero';
const AUTH = 'http://127.0.0.1:9099';
const PASSWORD = 'demo-pass-1';
const DAY = 86_400_000;

if (!PROJECT_ID.startsWith('demo-')) throw new Error('seed-emulator only runs against demo- projects');

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

async function user(tenantId, uid, email, role, perms) {
  try {
    await authPost(`projects/${PROJECT_ID}/accounts`, { localId: uid, email, password: PASSWORD, emailVerified: true }, true);
  } catch {
    /* already exists */
  }
  const claims = {
    tenantId,
    role,
    active: true,
    subUntil: Date.now() + 30 * DAY,
    cv: 1,
    ...(role === 'subUser' ? { perms } : {}),
  };
  await authPost(`projects/${PROJECT_ID}/accounts:update`, { localId: uid, customAttributes: JSON.stringify(claims), emailVerified: true }, true);
}

/**
 * One independent store: users, settings, counters, drawer, categories, products and one customer.
 * `ids` maps the logical product names to document ids so each store has its own ids.
 */
async function seedStore(fs, { T, storeName, drawerUsdCents, users, ids, customerId, customerName }) {
  const now = Timestamp.now();
  for (const u of users) {
    await setDoc(doc(fs, `users/${u.uid}`), {
      uid: u.uid,
      email: u.email,
      fullName: u.fullName,
      role: u.role,
      tenantId: T,
      isActive: true,
      permissions: u.perms ?? {},
      claimsVersion: 1,
      createdAt: now,
    });
  }
  await setDoc(doc(fs, `subscriptions/${T}`), { activated: true, lifetime: false, endsAt: Timestamp.fromMillis(Date.now() + 30 * DAY) });
  await setDoc(doc(fs, `tenants/${T}`), { ownerUid: T, createdAt: now });
  await setDoc(doc(fs, `tenants/${T}/settings/main`), { storeName, exchangeRate: 89_500, defaultCurrency: 'USD', updatedAt: now });
  await setDoc(doc(fs, `tenants/${T}/counters/sales`), { nextId: 1, updatedAt: now });
  await setDoc(doc(fs, `tenants/${T}/counters/purchases`), { nextId: 1, updatedAt: now });
  await setDoc(doc(fs, `tenants/${T}/cashbox/summary`), { usdCents: drawerUsdCents, lbp: 0, lastTxId: null, updatedAt: now });
  await setDoc(doc(fs, `tenants/${T}/lists/categories`), { names: ['Accessories', 'Phones'] });
  const product = (id, name, retail, stock, extra = {}) =>
    setDoc(doc(fs, `tenants/${T}/products/${id}`), {
      name,
      category: 'Accessories',
      barcode: id.toUpperCase(),
      prices: { retail: { usdCents: retail, lbp: null }, wholesale: { usdCents: 0, lbp: null }, vip: { usdCents: 0, lbp: null } },
      costUsdCents: Math.round(retail / 2),
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
      status: 'active',
      archivedAt: null,
      createdAt: now,
      createdAtMs: Date.now(),
      createdBy: T,
      updatedAt: now,
      ...extra,
    });
  const n = (name) => `${ids.namePrefix}${name}`;
  await product(ids.case, n('Phone case'), 500, 20);
  await product(ids.last, n('Last-unit charger'), 900, 1);
  await product(ids.cable, n('USB cable'), 300, 20);
  await product(ids.phone, n('Demo phone'), 20_000, 2, {
    category: 'Phones',
    imeiTracking: true,
    imeis: ids.imeis.map((imei) => ({ imei, status: 'available' })),
  });
  await setDoc(doc(fs, `tenants/${T}/customers/${customerId}`), {
    name: customerName,
    phone: '',
    email: '',
    address: '',
    creditLimitUsdCents: 10_000,
    debtUsdCents: 0,
    totalPurchasesUsdCents: 0,
    lastLedgerId: null,
    createdAt: now,
    createdAtMs: Date.now(),
    createdBy: T,
  });
}

const STORES = [
  {
    T: 'demoStore',
    storeName: 'Demo Store',
    drawerUsdCents: 10_000,
    users: [
      { uid: 'demoStore', email: 'owner@zelvero.test', fullName: 'Demo Owner', role: 'owner' },
      { uid: 'cashier1', email: 'cashier@zelvero.test', fullName: 'Cashier One', role: 'subUser', perms: { canSell: true } },
      { uid: 'cashier2', email: 'cashier2@zelvero.test', fullName: 'Cashier Two', role: 'subUser', perms: { canSell: true } },
    ],
    ids: { namePrefix: '', case: 'case', last: 'last', cable: 'cable', phone: 'phone', imeis: ['111111111111111', '222222222222222'] },
    customerId: 'ali',
    customerName: 'Ali',
  },
  {
    T: 'demoStore2',
    storeName: 'Second Store',
    drawerUsdCents: 50_000,
    users: [
      { uid: 'demoStore2', email: 'owner2@zelvero.test', fullName: 'Second Owner', role: 'owner' },
      { uid: 'b-cashier', email: 'cashier-b@zelvero.test', fullName: 'Store B Cashier', role: 'subUser', perms: { canSell: true } },
    ],
    ids: { namePrefix: 'StoreB ', case: 'b-case', last: 'b-last', cable: 'b-cable', phone: 'b-phone', imeis: ['911111111111111', '922222222222222'] },
    customerId: 'b-sara',
    customerName: 'Sara (store B)',
  },
];

for (const store of STORES) {
  for (const u of store.users) await user(store.T, u.uid, u.email, u.role, u.perms);
}

const env = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { host: '127.0.0.1', port: 8080 } });
await env.withSecurityRulesDisabled(async (ctx) => {
  for (const store of STORES) await seedStore(ctx.firestore(), store);
});
await env.cleanup();
console.log(
  'Seeded "demoStore" (owner@ / cashier@ / cashier2@zelvero.test) and "demoStore2" (owner2@ / cashier-b@zelvero.test); password demo-pass-1',
);
