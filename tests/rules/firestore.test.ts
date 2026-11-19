import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { audit, createEnv, db, DAY, OTHER, seedTenant, T, tp } from './helpers';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createEnv();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await seedTenant(env);
});

const OWNER = T;
const owner = () => db(env, OWNER);
const cashier = () => db(env, 'cashier', { role: 'subUser', perms: { canSell: true } });
const editor = () => db(env, 'editor', { role: 'subUser', perms: { canViewProducts: true, canEditProducts: true, canAddProducts: true } });
const clerk = () => db(env, 'clerk', { role: 'subUser', perms: { canViewCustomers: true } });
const buyer = () => db(env, 'buyer', { role: 'subUser', perms: { canViewSuppliers: true, canManageCashDrawer: true } });

/** The batch the old client-side POS wrote for a cash sale (with a fake low price). */
function fakeSaleBatch(fs: Firestore, uid: string, saleId: string) {
  const a = audit(uid);
  const batch = writeBatch(fs);
  batch.set(doc(fs, tp(T, 'sales', saleId)), {
    invoiceNumber: `INV-${saleId}`,
    kind: 'cash',
    currency: 'USD',
    exchangeRate: 89_500,
    items: [{ productId: 'p1', name: 'Phone case', quantity: 2, unitUsdCents: 1, costUsdCents: 200, returnedQty: 0 }],
    totalUsdCents: 2,
    totalLbp: 0,
    discountUsdCents: 0,
    costUsdCents: 400,
    customerId: null,
    customerName: '',
    payment: { receivedUsdCents: 2, receivedLbp: 0 },
    returnedUsdCents: 0,
    returnedDebtUsdCents: 0,
    refundedUsdCents: 0,
    refundedLbp: 0,
    returnStatus: 'none',
    lastReturnId: null,
    offline: true,
    ...a,
  });
  batch.update(doc(fs, tp(T, 'products', 'p1')), { stock: increment(-2), lastMovementId: `mv-${saleId}`, updatedAt: serverTimestamp() });
  batch.set(doc(fs, tp(T, 'stockMovements', `mv-${saleId}`)), {
    productId: 'p1',
    productName: 'Phone case',
    type: 'sale',
    quantity: -2,
    stockAfter: null,
    refId: saleId,
    refNumber: `INV-${saleId}`,
    note: '',
    ...a,
  });
  batch.set(doc(fs, tp(T, 'cashTransactions', `tx-${saleId}`)), {
    type: 'sale',
    usdCents: 2,
    lbp: 0,
    balanceAfter: null,
    category: 'sale',
    note: '',
    refId: saleId,
    refNumber: `INV-${saleId}`,
    ...a,
  });
  batch.set(doc(fs, tp(T, 'cashbox', 'summary')), { usdCents: increment(2), lbp: increment(0), lastTxId: `tx-${saleId}` }, { merge: true });
  return batch;
}

const newCustomer = (uid: string, extra: Record<string, unknown> = {}) => {
  const a = audit(uid);
  return {
    name: 'Sara',
    phone: '',
    email: '',
    address: '',
    creditLimitUsdCents: 0,
    debtUsdCents: 0,
    totalPurchasesUsdCents: 0,
    lastLedgerId: null,
    createdAt: a.createdAt,
    createdAtMs: a.createdAtMs,
    createdBy: uid,
    updatedAt: serverTimestamp(),
    ...extra,
  };
};

const newSupplier = (uid: string, extra: Record<string, unknown> = {}) => {
  const a = audit(uid);
  return {
    name: 'Supplier',
    contactPerson: '',
    phone: '',
    email: '',
    address: '',
    balanceUsdCents: 0,
    createdAt: a.createdAt,
    createdAtMs: a.createdAtMs,
    createdBy: uid,
    updatedAt: serverTimestamp(),
    ...extra,
  };
};

describe('tenant isolation', () => {
  it('members read their tenant, outsiders cannot', async () => {
    await assertSucceeds(getDoc(doc(owner(), tp(T, 'products', 'p1'))));
    await assertFails(getDoc(doc(db(env, 'intruder', { tenantId: OTHER }), tp(T, 'products', 'p1'))));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore() as unknown as Firestore, tp(T, 'products', 'p1'))));
  });

  it('another tenant owner cannot read or write this tenant', async () => {
    const intruder = db(env, OTHER, { tenantId: OTHER });
    await assertFails(getDocs(collection(intruder, tp(T, 'sales'))));
    await assertFails(getDocs(collection(intruder, tp(T, 'customers'))));
    await assertFails(setDoc(doc(intruder, tp(T, 'customers', 'x')), newCustomer(OTHER)));
    await assertFails(updateDoc(doc(intruder, tp(T, 'products', 'p1')), { name: 'hacked', updatedAt: serverTimestamp() }));
    await assertFails(getDoc(doc(intruder, tp(T, 'private', 'telegram'))));
  });

  it('a forged tenantId claim without membership flags is denied', async () => {
    await assertFails(getDoc(doc(db(env, 'x', { tenantId: T, active: false }), tp(T, 'products', 'p1'))));
    await assertFails(getDoc(doc(db(env, 'x', { tenantId: T, emailVerified: false }), tp(T, 'products', 'p1'))));
  });

  it('expired subscriptions are read-only', async () => {
    const expired = db(env, OWNER, { subUntil: Date.now() - DAY });
    await assertSucceeds(getDoc(doc(expired, tp(T, 'products', 'p1'))));
    await assertFails(setDoc(doc(expired, tp(T, 'customers', 'c9')), newCustomer(OWNER)));
    await assertFails(updateDoc(doc(expired, tp(T, 'products', 'p1')), { name: 'x', updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(expired, tp(T, 'settings', 'main')), { exchangeRate: 90_000 }, { merge: true }));
    await assertFails(setDoc(doc(expired, tp(T, 'suppliers', 's9')), newSupplier(OWNER)));
  });

  it('platform documents cannot be written from the client', async () => {
    const fs = owner();
    await assertFails(setDoc(doc(fs, `subscriptions/${T}`), { activated: true, lifetime: true }));
    await assertFails(updateDoc(doc(fs, `users/${T}`), { role: 'owner', tenantId: OTHER }));
    await assertSucceeds(updateDoc(doc(fs, `users/${T}`), { fullName: 'New name' }));
    await assertFails(getDoc(doc(fs, 'storeSubdomains/abc')));
  });

  it('only the owner lists staff profiles of its own tenant', async () => {
    const q = (fs: Firestore, t: string) => getDocs(query(collection(fs, 'users'), where('tenantId', '==', t), where('role', '==', 'subUser')));
    await assertSucceeds(q(owner(), T));
    await assertFails(q(cashier(), T));
    await assertFails(q(owner(), OTHER));
  });
});

describe('internal demo tenant (super admin with its own store)', () => {
  const DEMO = 'platformAdmin';
  const demoAdmin = () => db(env, DEMO, { tenantId: DEMO, superAdmin: true });
  const pureAdmin = () => env.authenticatedContext('pureAdmin', { superAdmin: true, email_verified: true }).firestore() as unknown as Firestore;

  beforeEach(async () => {
    await seedTenant(env, DEMO);
  });

  it('works inside its own demo tenant', async () => {
    await assertSucceeds(getDoc(doc(demoAdmin(), tp(DEMO, 'products', 'p1'))));
    await assertSucceeds(setDoc(doc(demoAdmin(), tp(DEMO, 'customers', 'c9')), newCustomer(DEMO)));
  });

  it('cannot read or write customer tenant data', async () => {
    const fs = demoAdmin();
    await assertFails(getDoc(doc(fs, tp(T, 'products', 'p1'))));
    await assertFails(getDocs(collection(fs, tp(T, 'sales'))));
    await assertFails(getDocs(collection(fs, tp(T, 'customers'))));
    await assertFails(getDoc(doc(fs, tp(T, 'cashbox', 'summary'))));
    await assertFails(setDoc(doc(fs, tp(T, 'customers', 'x')), newCustomer(DEMO)));
    await assertFails(updateDoc(doc(fs, tp(T, 'products', 'p1')), { name: 'demo', updatedAt: serverTimestamp() }));
  });

  it('the super admin claim alone grants no tenant data', async () => {
    await assertFails(getDoc(doc(pureAdmin(), tp(T, 'products', 'p1'))));
    await assertFails(getDoc(doc(pureAdmin(), tp(DEMO, 'products', 'p1'))));
  });

  it('cannot mark itself as demo or change its own subscription from the client', async () => {
    await assertFails(updateDoc(doc(demoAdmin(), `users/${DEMO}`), { internalDemo: true }));
    await assertFails(setDoc(doc(demoAdmin(), `subscriptions/${DEMO}`), { internalDemo: true, lifetime: true }, { merge: true }));
  });
});

describe('server-only ledgers (written exclusively by Cloud Functions)', () => {
  const SERVER_ONLY = [
    'sales',
    'returns',
    'stockMovements',
    'cashTransactions',
    'customerLedger',
    'purchases',
    'supplierPayments',
    'purchaseReturns',
    'dailyStats',
  ];

  for (const name of SERVER_ONLY) {
    it(`even the owner cannot create or change ${name}`, async () => {
      await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore() as unknown as Firestore, tp(T, name, 'existing')), { amountUsdCents: 1, ...audit(OWNER) });
      });
      const fs = owner();
      await assertFails(setDoc(doc(fs, tp(T, name, 'forged')), { amountUsdCents: 1_000_000, ...audit(OWNER) }));
      await assertFails(updateDoc(doc(fs, tp(T, name, 'existing')), { amountUsdCents: 1_000_000 }));
      await assertFails(deleteDoc(doc(fs, tp(T, name, 'existing'))));
    });
  }

  it('a client-built sale with a fake price is rejected (checkout must go through posCheckout)', async () => {
    await assertFails(fakeSaleBatch(cashier(), 'cashier', 's1').commit());
    await assertFails(fakeSaleBatch(owner(), OWNER, 's2').commit());
  });

  it('fake daily statistics are rejected', async () => {
    const today = audit(OWNER).localDate;
    await assertFails(setDoc(doc(owner(), tp(T, 'dailyStats', today)), { date: today, revenueUsdCents: 99_999_999 }, { merge: true }));
    await assertFails(setDoc(doc(owner(), tp(T, 'dailyStats', today)), { date: today, salesCount: increment(1) }, { merge: true }));
  });

  it('the drawer cannot be set or incremented directly', async () => {
    const fs = owner();
    await assertFails(setDoc(doc(fs, tp(T, 'cashbox', 'summary')), { usdCents: 999_999 }, { merge: true }));
    await assertFails(setDoc(doc(fs, tp(T, 'cashbox', 'summary')), { usdCents: increment(500), lastTxId: 'ghost' }, { merge: true }));
    await assertFails(setDoc(doc(buyer(), tp(T, 'cashbox', 'summary')), { usdCents: 0, lbp: 0, lastTxId: 'x' }));
  });

  it('a fake cash entry with its matching drawer update is rejected', async () => {
    const fs = buyer();
    const batch = writeBatch(fs);
    batch.set(doc(fs, tp(T, 'cashTransactions', 'fake')), { type: 'deposit', usdCents: 500, lbp: 0, category: '', note: '', ...audit('buyer') });
    batch.set(doc(fs, tp(T, 'cashbox', 'summary')), { usdCents: increment(500), lbp: increment(0), lastTxId: 'fake' }, { merge: true });
    await assertFails(batch.commit());
  });

  it('document counters cannot be moved by clients', async () => {
    await assertFails(setDoc(doc(cashier(), tp(T, 'counters', 'sales')), { nextId: 6 }, { merge: true }));
    await assertFails(setDoc(doc(owner(), tp(T, 'counters', 'purchases')), { nextId: 1 }, { merge: true }));
  });

  it('clientOps records are server-only', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore() as unknown as Firestore, tp(T, 'clientOps', 'op1')), { kind: 'posPayDebt', result: { ok: true } });
    });
    await assertFails(setDoc(doc(owner(), tp(T, 'clientOps', 'op1')), { kind: 'posPayDebt', result: { ok: true } }));
    await assertFails(getDoc(doc(cashier(), tp(T, 'clientOps', 'op1'))));
    await assertFails(getDocs(collection(owner(), tp(T, 'clientOps'))));
    await assertFails(deleteDoc(doc(owner(), tp(T, 'clientOps', 'op1'))));
    await assertFails(updateDoc(doc(owner(), tp(T, 'clientOps', 'op1')), { kind: 'hacked' }));
  });

  it('a disabled user cannot read tenant data even with a still-active ID token', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fs = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(fs, 'users/disabledCashier'), {
        uid: 'disabledCashier',
        role: 'subUser',
        tenantId: T,
        isActive: false,
        fullName: 'Disabled',
        claimsVersion: 1,
      });
    });
    const stale = db(env, 'disabledCashier', { role: 'subUser', perms: { canSell: true, canViewCustomers: true, canViewSuppliers: true, canViewReports: true, canManageCashDrawer: true, canViewSales: true } });
    await assertFails(getDoc(doc(stale, tp(T, 'products', 'p1'))));
    await assertFails(getDoc(doc(stale, tp(T, 'customers', 'c1'))));
    await assertFails(getDocs(collection(stale, tp(T, 'suppliers'))));
    await assertFails(getDocs(collection(stale, tp(T, 'sales'))));
    await assertFails(getDoc(doc(stale, tp(T, 'settings', 'main'))));
    await assertFails(getDoc(doc(stale, tp(T, 'cashbox', 'summary'))));
    await assertFails(getDocs(collection(stale, tp(T, 'dailyStats'))));
  });

  it('cross-tenant reads are denied for remaining ledgers', async () => {
    const other = db(env, OTHER, { tenantId: OTHER });
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fs = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(fs, `users/${OTHER}`), { uid: OTHER, role: 'owner', tenantId: OTHER, isActive: true, fullName: 'B', claimsVersion: 1 });
      for (const name of ['returns', 'purchases', 'customerLedger', 'supplierPayments', 'cashTransactions', 'dailyStats', 'clientOps']) {
        await setDoc(doc(fs, tp(T, name, 'x')), { n: 1 });
      }
    });
    await assertFails(getDoc(doc(other, tp(T, 'returns', 'x'))));
    await assertFails(getDoc(doc(other, tp(T, 'purchases', 'x'))));
    await assertFails(getDoc(doc(other, tp(T, 'customerLedger', 'x'))));
    await assertFails(getDoc(doc(other, tp(T, 'supplierPayments', 'x'))));
    await assertFails(getDoc(doc(other, tp(T, 'cashTransactions', 'x'))));
    await assertFails(getDoc(doc(other, tp(T, 'dailyStats', 'x'))));
    await assertFails(getDoc(doc(other, tp(T, 'clientOps', 'x'))));
    await assertFails(getDoc(doc(other, tp(T, 'lists', 'categories'))));
  });

  it('read access still follows permissions', async () => {
    await assertFails(getDocs(collection(cashier(), tp(T, 'cashTransactions'))));
    await assertFails(getDocs(collection(cashier(), tp(T, 'purchases'))));
    await assertFails(getDocs(collection(cashier(), tp(T, 'dailyStats'))));
    const reporter = db(env, 'rep', { role: 'subUser', perms: { canViewReports: true } });
    await assertSucceeds(getDocs(collection(reporter, tp(T, 'dailyStats'))));
    await assertSucceeds(getDocs(collection(reporter, tp(T, 'sales'))));
    await assertSucceeds(getDocs(collection(buyer(), tp(T, 'purchases'))));
  });
});

describe('product and customer reads follow the permission that loads them', () => {
  it('lets POS, catalog, and purchasing roles read products', async () => {
    await assertSucceeds(getDoc(doc(cashier(), tp(T, 'products', 'p1'))));
    await assertSucceeds(getDoc(doc(editor(), tp(T, 'products', 'p1'))));
    await assertSucceeds(getDoc(doc(buyer(), tp(T, 'products', 'p1'))));
    await assertSucceeds(getDocs(collection(cashier(), tp(T, 'products'))));
  });

  it('hides products from roles that never load the catalog', async () => {
    const staff = db(env, 'staff', { role: 'subUser', perms: {} });
    const reports = db(env, 'rep', { role: 'subUser', perms: { canViewReports: true } });
    await assertFails(getDoc(doc(clerk(), tp(T, 'products', 'p1'))));
    await assertFails(getDocs(collection(clerk(), tp(T, 'products'))));
    await assertFails(getDoc(doc(staff, tp(T, 'products', 'p1'))));
    await assertFails(getDoc(doc(reports, tp(T, 'products', 'p1'))));
  });

  it('lets POS, customers, sales, and reports read customers', async () => {
    await assertSucceeds(getDoc(doc(cashier(), tp(T, 'customers', 'c1'))));
    await assertSucceeds(getDoc(doc(clerk(), tp(T, 'customers', 'c1'))));
    await assertSucceeds(getDocs(collection(clerk(), tp(T, 'customers'))));
    const sales = db(env, 'rep', { role: 'subUser', perms: { canViewSales: true } });
    const reports = db(env, 'staff', { role: 'subUser', perms: { canViewReports: true } });
    await assertSucceeds(getDoc(doc(sales, tp(T, 'customers', 'c1'))));
    await assertSucceeds(getDoc(doc(reports, tp(T, 'customers', 'c1'))));
  });

  it('hides customers from roles that never load them', async () => {
    const staff = db(env, 'staff', { role: 'subUser', perms: {} });
    await assertFails(getDoc(doc(editor(), tp(T, 'customers', 'c1'))));
    await assertFails(getDocs(collection(editor(), tp(T, 'customers'))));
    await assertFails(getDoc(doc(buyer(), tp(T, 'customers', 'c1'))));
    await assertFails(getDoc(doc(staff, tp(T, 'customers', 'c1'))));
  });

  it('still denies another tenant, signed-out callers, and inactive members', async () => {
    const intruder = db(env, OTHER, { tenantId: OTHER });
    await assertFails(getDoc(doc(intruder, tp(T, 'products', 'p1'))));
    await assertFails(getDoc(doc(intruder, tp(T, 'customers', 'c1'))));
    const anon = env.unauthenticatedContext().firestore() as unknown as Firestore;
    await assertFails(getDoc(doc(anon, tp(T, 'products', 'p1'))));
    await assertFails(getDoc(doc(anon, tp(T, 'customers', 'c1'))));
    const inactive = db(env, 'cashier', { role: 'subUser', perms: { canSell: true }, active: false });
    await assertFails(getDoc(doc(inactive, tp(T, 'products', 'p1'))));
    await assertFails(getDoc(doc(inactive, tp(T, 'customers', 'c1'))));
  });
});

describe('products: stock only changes server-side', () => {
  it('cashiers cannot edit products or change stock', async () => {
    const fs = cashier();
    await assertFails(updateDoc(doc(fs, tp(T, 'products', 'p1')), { name: 'x', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(fs, tp(T, 'products', 'p1')), { stock: 99, lastMovementId: 'm-x', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(fs, tp(T, 'products', 'p1')), { stock: increment(-1) }));
  });

  it('editors and owners edit master fields but never stock, IMEIs or the movement pointer', async () => {
    const p1 = (fs: Firestore) => doc(fs, tp(T, 'products', 'p1'));
    await assertSucceeds(updateDoc(p1(editor()), { name: 'Case v2', costUsdCents: 250, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(p1(editor()), { stock: 50 }));
    await assertFails(updateDoc(p1(owner()), { stock: 50, lastMovementId: 'mv-fake', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(p1(owner()), { stock: -5 }));
    await assertFails(updateDoc(p1(owner()), { imeis: [{ imei: '123', status: 'available' }] }));
    await assertFails(updateDoc(p1(owner()), { lastMovementId: 'mv-fake' }));
  });

  it('IMEI tracking cannot be toggled while the product has stock', async () => {
    await assertFails(updateDoc(doc(owner(), tp(T, 'products', 'p1')), { imeiTracking: true, updatedAt: serverTimestamp() }));
  });

  it('products (with their initial stock) are created only by posCreateProduct', async () => {
    const a = audit('editor');
    await assertFails(
      setDoc(doc(editor(), tp(T, 'products', 'p2')), {
        name: 'Charger',
        category: '',
        barcode: '',
        prices: { retail: { usdCents: 900, lbp: null } },
        costUsdCents: 400,
        minStock: null,
        supplierId: null,
        supplierName: '',
        expiryDate: null,
        imeiTracking: false,
        stock: 0,
        imeis: [],
        imageUrl: null,
        imagePath: null,
        lastMovementId: null,
        createdAt: a.createdAt,
        createdAtMs: a.createdAtMs,
        createdBy: 'editor',
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('products are never deleted from the client, even by the owner (posDeleteProduct checks history)', async () => {
    await assertFails(deleteDoc(doc(editor(), tp(T, 'products', 'p1'))));
    const deleter = db(env, 'deleter', { role: 'subUser', perms: { canViewProducts: true, canDeleteProducts: true } });
    await assertFails(deleteDoc(doc(deleter, tp(T, 'products', 'p1'))));
    await assertFails(deleteDoc(doc(owner(), tp(T, 'products', 'p1'))));
  });

  it('archive status is server-only', async () => {
    const p1 = (fs: Firestore) => doc(fs, tp(T, 'products', 'p1'));
    await assertFails(updateDoc(p1(owner()), { status: 'archived', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(p1(owner()), { archivedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  });
});

describe('customers: debt only changes server-side', () => {
  it('debt and purchase totals cannot be edited, even by the owner', async () => {
    const c1 = (fs: Firestore) => doc(fs, tp(T, 'customers', 'c1'));
    await assertFails(updateDoc(c1(clerk()), { debtUsdCents: 0 }));
    await assertFails(updateDoc(c1(owner()), { debtUsdCents: 0, lastLedgerId: 'fake', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(c1(cashier()), { totalPurchasesUsdCents: increment(500) }));
    await assertSucceeds(updateDoc(c1(clerk()), { phone: '+961 1 234', creditLimitUsdCents: 1_000, updatedAt: serverTimestamp() }));
  });

  it('a fake debt payment (ledger + debt + cash + drawer) is rejected', async () => {
    const fs = clerk();
    const a = audit('clerk');
    const batch = writeBatch(fs);
    batch.set(doc(fs, tp(T, 'customerLedger', 'l1')), { customerId: 'c1', type: 'payment', amountUsdCents: -3_000, note: '', ...a });
    batch.update(doc(fs, tp(T, 'customers', 'c1')), { debtUsdCents: increment(-3_000), lastLedgerId: 'l1', updatedAt: serverTimestamp() });
    batch.set(doc(fs, tp(T, 'cashTransactions', 'ptx')), { type: 'debtPayment', usdCents: 0, lbp: 0, category: '', note: '', ...a });
    batch.set(doc(fs, tp(T, 'cashbox', 'summary')), { usdCents: increment(0), lastTxId: 'ptx' }, { merge: true });
    await assertFails(batch.commit());
  });

  it('new customers start debt-free (opening debt goes through posCreateCustomer)', async () => {
    const fs = clerk();
    await assertSucceeds(setDoc(doc(fs, tp(T, 'customers', 'c2')), newCustomer('clerk')));
    await assertFails(setDoc(doc(fs, tp(T, 'customers', 'c3')), newCustomer('clerk', { debtUsdCents: 500 })));
    await assertFails(setDoc(doc(fs, tp(T, 'customers', 'c4')), newCustomer('clerk', { totalPurchasesUsdCents: 500 })));
    await assertFails(setDoc(doc(fs, tp(T, 'customers', 'c5')), newCustomer('clerk', { lastLedgerId: 'x' })));
    await assertFails(setDoc(doc(fs, tp(T, 'customers', 'c6')), newCustomer('clerk', { vip: true })));
    await assertFails(setDoc(doc(fs, tp(T, 'customers', 'c7')), newCustomer('someone-else')));
    await assertFails(setDoc(doc(cashier(), tp(T, 'customers', 'c8')), newCustomer('cashier')));
  });

  it('customers with debt cannot be deleted', async () => {
    await assertFails(deleteDoc(doc(clerk(), tp(T, 'customers', 'c1'))));
  });
});

describe('suppliers: balance only changes server-side', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore() as unknown as Firestore, tp(T, 'suppliers', 'sup1')), newSupplier(OWNER, { balanceUsdCents: 1_100 }));
    });
  });

  it('the supplier balance cannot be edited, even by the owner', async () => {
    const s = (fs: Firestore) => doc(fs, tp(T, 'suppliers', 'sup1'));
    await assertFails(updateDoc(s(buyer()), { balanceUsdCents: 0, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(s(owner()), { balanceUsdCents: increment(-1_100) }));
    await assertSucceeds(updateDoc(s(buyer()), { phone: '123', updatedAt: serverTimestamp() }));
  });

  it('new suppliers start with a zero balance', async () => {
    await assertSucceeds(setDoc(doc(buyer(), tp(T, 'suppliers', 'sup2')), newSupplier('buyer')));
    await assertFails(setDoc(doc(buyer(), tp(T, 'suppliers', 'sup3')), newSupplier('buyer', { balanceUsdCents: -500 })));
    await assertFails(setDoc(doc(cashier(), tp(T, 'suppliers', 'sup4')), newSupplier('cashier')));
  });

  it('inline creation from Add Product: only users with supplier access may create a supplier', async () => {
    await assertFails(setDoc(doc(editor(), tp(T, 'suppliers', 'sup5')), newSupplier('editor')));
    await assertSucceeds(setDoc(doc(owner(), tp(T, 'suppliers', 'sup6')), newSupplier(OWNER, { phone: '71123456' })));
  });

  it('a supplier with an open balance cannot be deleted', async () => {
    await assertFails(deleteDoc(doc(owner(), tp(T, 'suppliers', 'sup1'))));
  });

  it('a purchase bill cannot be marked paid from the client', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore() as unknown as Firestore, tp(T, 'purchases', 'pu1')), {
        supplierId: 'sup1',
        totalUsdCents: 1_100,
        paidUsdCents: 0,
        remainingUsdCents: 1_100,
        returnedUsdCents: 0,
        status: 'unpaid',
      });
    });
    await assertFails(updateDoc(doc(buyer(), tp(T, 'purchases', 'pu1')), { paidUsdCents: 1_100, remainingUsdCents: 0, status: 'paid' }));
  });
});

describe('category list (inline creation from Add Product)', () => {
  const list = (fs: Firestore) => doc(fs, tp(T, 'lists', 'categories'));

  it('product editors may add a category name; others may not', async () => {
    await assertSucceeds(setDoc(list(editor()), { names: arrayUnion('Chargers') }, { merge: true }));
    await assertSucceeds(setDoc(list(owner()), { names: arrayUnion('Cables') }, { merge: true }));
    await assertFails(setDoc(list(cashier()), { names: arrayUnion('Nope') }, { merge: true }));
    await assertFails(setDoc(list(clerk()), { names: arrayUnion('Nope') }, { merge: true }));
    await assertFails(setDoc(list(buyer()), { names: arrayUnion('Nope') }, { merge: true }));
  });

  it('only the names field may be written, and only on the categories list', async () => {
    await assertFails(setDoc(list(editor()), { names: arrayUnion('A'), extra: true }, { merge: true }));
    await assertFails(setDoc(doc(editor(), tp(T, 'lists', 'other')), { names: arrayUnion('A') }, { merge: true }));
  });

  it('another tenant cannot add categories', async () => {
    const intruder = db(env, 'intruder', { tenantId: OTHER, role: 'owner' });
    await assertFails(setDoc(list(intruder), { names: arrayUnion('X') }, { merge: true }));
  });
});

describe('platform release documents', () => {
  const admin = () => db(env, 'admin', { superAdmin: true, tenantId: T });

  it('nobody can write release records from the client', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fs = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(fs, 'platformReleaseManifest/current'), { productionVersion: null, paused: false });
      await setDoc(doc(fs, 'platformReleases/0.9.0-dev'), { status: 'testing' });
      await setDoc(doc(fs, `platformReleaseAssignments/${T}`), { assignedVersion: '0.9.0-dev' });
    });
    await assertFails(setDoc(doc(owner(), 'platformReleases/1.0.1'), { status: 'released' }));
    await assertFails(setDoc(doc(admin(), 'platformReleases/1.0.1'), { status: 'released' }));
    await assertFails(updateDoc(doc(owner(), `platformReleaseAssignments/${T}`), { assignedVersion: '9.9.9' }));
    await assertSucceeds(getDoc(doc(owner(), `platformReleaseAssignments/${T}`)));
    await assertFails(getDoc(doc(db(env, 'intruder', { tenantId: OTHER, role: 'owner' }), `platformReleaseAssignments/${T}`)));
    await assertSucceeds(getDoc(doc(owner(), 'platformReleaseManifest/current')));
    await assertSucceeds(getDoc(doc(admin(), 'platformReleases/0.9.0-dev')));
  });
});

describe('platform sales CRM', () => {
  const admin = () => db(env, 'admin', { superAdmin: true, tenantId: T });

  it('blocks cashiers and anonymous clients from platform leads', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fs = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(fs, 'platformLeads/lead1'), { email: 'a@b.co', status: 'NEW' });
    });
    await assertFails(getDoc(doc(cashier(), 'platformLeads/lead1')));
    await assertFails(setDoc(doc(cashier(), 'platformLeads/lead2'), { email: 'x@y.z' }));
    await assertFails(setDoc(doc(owner(), 'platformLeads/lead3'), { email: 'x@y.z' }));
    await assertSucceeds(getDoc(doc(admin(), 'platformLeads/lead1')));
    await assertFails(updateDoc(doc(admin(), 'platformLeads/lead1'), { status: 'WON' }));
  });
});

describe('Marketing Partner & Client Assignment platform collections', () => {
  const admin = () => db(env, 'admin', { superAdmin: true, tenantId: T });
  const partner = () => db(env, 'partnerUid', { marketingPartner: true, tenantId: null, emailVerified: true });
  const other = () => db(env, 'anotherTenant', { tenantId: OTHER, role: 'owner' });

  it('is fully client-inaccessible — not even to its own marketing partner or Super Admin', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fs = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(fs, 'marketingPartners/partnerUid'), { uid: 'partnerUid', active: true, referralCode: 'rc1' });
      await setDoc(doc(fs, `platformClientAssignments/${T}`), { tenantId: T, assignedTo: 'partner', assignedPartnerId: 'partnerUid' });
      await setDoc(doc(fs, 'platformPartnerAuditLog/entry1'), { action: 'assigned', tenantId: T });
    });

    // The assigned partner cannot read its own assignment doc directly — only through the
    // partnerListMyClients callable, which resolves and shapes the result server-side.
    await assertFails(getDoc(doc(partner(), `platformClientAssignments/${T}`)));
    await assertFails(getDoc(doc(partner(), 'marketingPartners/partnerUid')));
    // Super Admin reads this through adminListClientAssignments, never directly either.
    await assertFails(getDoc(doc(admin(), `platformClientAssignments/${T}`)));
    await assertFails(getDoc(doc(admin(), 'marketingPartners/partnerUid')));
    await assertFails(getDoc(doc(admin(), 'platformPartnerAuditLog/entry1')));
    // An unrelated tenant owner has no access whatsoever.
    await assertFails(getDoc(doc(other(), `platformClientAssignments/${T}`)));
    // Nobody can write any of it from the client, including a super admin.
    await assertFails(setDoc(doc(partner(), `platformClientAssignments/${T}`), { assignedTo: 'partner', assignedPartnerId: 'partnerUid' }));
    await assertFails(updateDoc(doc(admin(), `platformClientAssignments/${T}`), { assignedTo: 'superAdmin' }));
    await assertFails(setDoc(doc(admin(), 'marketingPartners/intruder'), { active: true }));
  });
});

describe('settings', () => {
  it('telegram secrets are hidden from staff', async () => {
    const staff = db(env, 'staff', { role: 'subUser', perms: { canViewSettings: true, canEditSettings: true } });
    await assertFails(getDoc(doc(staff, tp(T, 'private', 'telegram'))));
    await assertSucceeds(getDoc(doc(owner(), tp(T, 'private', 'telegram'))));
  });

  it('settings need canEditSettings and a valid rate', async () => {
    await assertFails(setDoc(doc(cashier(), tp(T, 'settings', 'main')), { exchangeRate: 90_000 }, { merge: true }));
    await assertFails(setDoc(doc(owner(), tp(T, 'settings', 'main')), { exchangeRate: -1 }, { merge: true }));
    await assertSucceeds(setDoc(doc(owner(), tp(T, 'settings', 'main')), { exchangeRate: 90_000 }, { merge: true }));
  });
});

describe('online store (server-only, read through publicStoreCatalog only)', () => {
  const PATHS = [`onlineStores/${T}`, 'onlineStoreSlugs/demo-shop'];

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fs = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(fs, `onlineStores/${T}`), { tenantId: T, enabled: true, slug: 'demo-shop', publication: 'published' });
      await setDoc(doc(fs, 'onlineStoreSlugs/demo-shop'), { tenantId: T });
    });
  });

  for (const path of PATHS) {
    it(`owner, other tenant, and anonymous clients cannot read or write ${path.split('/')[0]}`, async () => {
      const anon = env.unauthenticatedContext().firestore() as unknown as Firestore;
      for (const fs of [owner(), db(env, OTHER), anon]) {
        await assertFails(getDoc(doc(fs, path)));
        await assertFails(setDoc(doc(fs, path), { tenantId: OTHER, enabled: true }));
        await assertFails(updateDoc(doc(fs, path), { enabled: false }));
        await assertFails(deleteDoc(doc(fs, path)));
      }
      await assertFails(setDoc(doc(owner(), 'onlineStoreSlugs/stolen-slug'), { tenantId: T }));
    });
  }
});
