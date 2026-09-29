import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection,
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
const cashier = () => db(env, 'cashier', { role: 'subUser', perms: { canSell: true } });

/** Builds the same batch the POS writes for a cash sale (see salesService.prepareSale). */
function saleBatch(fs: Firestore, uid: string, saleId: string, opts: { qty?: number; paid?: number; txAmount?: number } = {}) {
  const qty = opts.qty ?? 2;
  const paid = opts.paid ?? 1_000;
  const a = audit(uid);
  const batch = writeBatch(fs);
  const movementId = `mv-${saleId}`;
  const txId = `tx-${saleId}`;
  batch.set(doc(fs, tp(T, 'sales', saleId)), {
    invoiceNumber: `OFF-${saleId}`,
    kind: 'cash',
    currency: 'USD',
    exchangeRate: 89_500,
    items: [{ productId: 'p1', name: 'Phone case', quantity: qty, unitUsdCents: 500, costUsdCents: 200, returnedQty: 0 }],
    totalUsdCents: 500 * qty,
    totalLbp: 0,
    discountUsdCents: 0,
    costUsdCents: 200 * qty,
    customerId: null,
    customerName: '',
    payment: { receivedUsdCents: paid, receivedLbp: 0 },
    returnedUsdCents: 0,
    returnedDebtUsdCents: 0,
    refundedUsdCents: 0,
    refundedLbp: 0,
    returnStatus: 'none',
    lastReturnId: null,
    offline: true,
    ...a,
  });
  batch.update(doc(fs, tp(T, 'products', 'p1')), { stock: increment(-qty), lastMovementId: movementId, updatedAt: serverTimestamp() });
  batch.set(doc(fs, tp(T, 'stockMovements', movementId)), {
    productId: 'p1',
    productName: 'Phone case',
    type: 'sale',
    quantity: -qty,
    stockAfter: null,
    refId: saleId,
    refNumber: `OFF-${saleId}`,
    note: '',
    ...a,
  });
  batch.set(doc(fs, tp(T, 'cashTransactions', txId)), {
    type: 'sale',
    usdCents: opts.txAmount ?? paid,
    lbp: 0,
    balanceAfter: null,
    category: 'sale',
    note: '',
    refId: saleId,
    refNumber: `OFF-${saleId}`,
    ...a,
  });
  batch.set(
    doc(fs, tp(T, 'cashbox', 'summary')),
    { usdCents: increment(paid), lbp: increment(0), lastTxId: txId, updatedAt: serverTimestamp() },
    { merge: true },
  );
  batch.set(
    doc(fs, tp(T, 'dailyStats', a.localDate)),
    { date: a.localDate, salesCount: increment(1), revenueUsdCents: increment(500 * qty), updatedAt: serverTimestamp() },
    { merge: true },
  );
  return batch;
}

function cashMove(fs: Firestore, uid: string, txId: string, type: string, usdCents: number, category = type) {
  const batch = writeBatch(fs);
  batch.set(doc(fs, tp(T, 'cashTransactions', txId)), {
    type,
    usdCents,
    lbp: 0,
    balanceAfter: null,
    category,
    note: '',
    refId: null,
    refNumber: null,
    ...audit(uid),
  });
  batch.set(
    doc(fs, tp(T, 'cashbox', 'summary')),
    { usdCents: increment(usdCents), lbp: increment(0), lastTxId: txId, updatedAt: serverTimestamp() },
    { merge: true },
  );
  return batch;
}

describe('tenant isolation', () => {
  it('members read their tenant, outsiders cannot', async () => {
    await assertSucceeds(getDoc(doc(db(env, OWNER), tp(T, 'products', 'p1'))));
    await assertFails(getDoc(doc(db(env, 'intruder', { tenantId: OTHER }), tp(T, 'products', 'p1'))));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore() as unknown as Firestore, tp(T, 'products', 'p1'))));
  });

  it('deactivated or unverified users are denied', async () => {
    await assertFails(getDoc(doc(db(env, OWNER, { active: false }), tp(T, 'products', 'p1'))));
    await assertFails(getDoc(doc(db(env, OWNER, { emailVerified: false }), tp(T, 'products', 'p1'))));
  });

  it('expired subscriptions are read-only', async () => {
    const expired = db(env, OWNER, { subUntil: Date.now() - 5 * DAY });
    await assertSucceeds(getDoc(doc(expired, tp(T, 'products', 'p1'))));
    await assertFails(saleBatch(expired, OWNER, 's-expired').commit());
  });

  it('platform documents cannot be written from the client', async () => {
    const fs = db(env, OWNER);
    await assertFails(setDoc(doc(fs, `subscriptions/${T}`), { activated: true, lifetime: true }));
    await assertFails(updateDoc(doc(fs, `users/${T}`), { role: 'owner', tenantId: OTHER }));
    await assertSucceeds(updateDoc(doc(fs, `users/${T}`), { fullName: 'New name' }));
    await assertFails(getDoc(doc(fs, 'storeSubdomains/abc')));
  });

  it('only the owner lists staff profiles of its own tenant', async () => {
    const q = (fs: Firestore, t: string) => getDocs(query(collection(fs, 'users'), where('tenantId', '==', t), where('role', '==', 'subUser')));
    await assertSucceeds(q(db(env, OWNER), T));
    await assertFails(q(cashier(), T));
    await assertFails(q(db(env, OWNER), OTHER));
  });
});

describe('sales', () => {
  it('a cashier can complete a sale (offline batch shape)', async () => {
    await assertSucceeds(saleBatch(cashier(), 'cashier', 's1').commit());
  });

  it('replaying the same sale is rejected', async () => {
    await assertSucceeds(saleBatch(cashier(), 'cashier', 's2').commit());
    await assertFails(saleBatch(cashier(), 'cashier', 's2').commit());
  });

  it('users without canSell cannot sell', async () => {
    const viewer = db(env, 'viewer', { role: 'subUser', perms: { canViewSales: true } });
    await assertFails(saleBatch(viewer, 'viewer', 's3').commit());
  });

  it('the drawer must move by exactly the cash transaction amount', async () => {
    await assertFails(saleBatch(cashier(), 'cashier', 's4', { paid: 1_000, txAmount: 900 }).commit());
  });

  it('a sale cannot be edited or deleted', async () => {
    await assertSucceeds(saleBatch(cashier(), 'cashier', 's5').commit());
    const owner = db(env, OWNER);
    await assertFails(updateDoc(doc(owner, tp(T, 'sales', 's5')), { totalUsdCents: 1 }));
    await assertFails(writeBatch(owner).delete(doc(owner, tp(T, 'sales', 's5'))).commit());
  });

  it('audit fields must name the real author', async () => {
    const fs = cashier();
    const batch = saleBatch(fs, 'someone-else', 's6');
    await assertFails(batch.commit());
  });
});

describe('returns', () => {
  async function returnBatch(fs: Firestore, uid: string, withReturnDoc: boolean) {
    const a = audit(uid);
    const batch = writeBatch(fs);
    const returnId = 'r1';
    if (withReturnDoc) {
      batch.set(doc(fs, tp(T, 'returns', returnId)), {
        number: 'RF-000005',
        saleId: 'sr',
        saleInvoiceNumber: 'OFF-sr',
        customerId: null,
        customerName: '',
        items: [{ productId: 'p1', name: 'Phone case', quantity: 1, unitUsdCents: 500, costUsdCents: 200, imei: null }],
        amountUsdCents: 500,
        refundUsdCents: 500,
        refundLbp: 0,
        debtReducedUsdCents: 0,
        reason: '',
        ...a,
      });
    }
    batch.update(doc(fs, tp(T, 'sales', 'sr')), {
      items: [{ productId: 'p1', name: 'Phone case', quantity: 2, unitUsdCents: 500, costUsdCents: 200, returnedQty: 1 }],
      returnedUsdCents: increment(500),
      returnedDebtUsdCents: increment(0),
      refundedUsdCents: increment(500),
      refundedLbp: increment(0),
      returnStatus: 'partial',
      lastReturnId: returnId,
    });
    batch.set(doc(fs, tp(T, 'counters', 'sales')), { nextId: 6, updatedAt: serverTimestamp() }, { merge: true });
    batch.set(doc(fs, tp(T, 'cashTransactions', 'rtx')), {
      type: 'refund',
      usdCents: -500,
      lbp: 0,
      balanceAfter: null,
      category: 'refund',
      note: '',
      refId: returnId,
      refNumber: 'RF-000005',
      ...a,
    });
    batch.set(
      doc(fs, tp(T, 'cashbox', 'summary')),
      { usdCents: increment(-500), lbp: increment(0), lastTxId: 'rtx', updatedAt: serverTimestamp() },
      { merge: true },
    );
    return batch.commit();
  }

  it('a return updates the sale together with its return document', async () => {
    await assertSucceeds(saleBatch(cashier(), 'cashier', 'sr').commit());
    const clerk = db(env, 'clerk', { role: 'subUser', perms: { canViewSales: true } });
    await assertSucceeds(returnBatch(clerk, 'clerk', true));
  });

  it('a refund without a return document is rejected', async () => {
    await assertSucceeds(saleBatch(cashier(), 'cashier', 'sr').commit());
    await assertFails(returnBatch(db(env, OWNER), OWNER, false));
  });

  it('cashiers without canViewSales cannot process returns', async () => {
    await assertSucceeds(saleBatch(cashier(), 'cashier', 'sr').commit());
    await assertFails(returnBatch(cashier(), 'cashier', true));
  });
});

describe('cash drawer', () => {
  const drawer = () => db(env, 'drawer', { role: 'subUser', perms: { canManageCashDrawer: true } });

  it('drawer managers record deposits and expenses', async () => {
    await assertSucceeds(cashMove(drawer(), 'drawer', 'd1', 'deposit', 500).commit());
    await assertSucceeds(cashMove(drawer(), 'drawer', 'e1', 'expense', -300, 'rent').commit());
  });

  it('the drawer cannot change without a new cash transaction', async () => {
    const fs = db(env, OWNER);
    await assertFails(setDoc(doc(fs, tp(T, 'cashbox', 'summary')), { usdCents: 999_999, lastTxId: 'seed' }, { merge: true }));
    await assertFails(setDoc(doc(fs, tp(T, 'cashbox', 'summary')), { usdCents: 999_999, lastTxId: 'ghost' }, { merge: true }));
  });

  it('cashiers cannot take money out and only owners adjust', async () => {
    await assertFails(cashMove(cashier(), 'cashier', 'w1', 'withdrawal', -100).commit());
    await assertFails(cashMove(drawer(), 'drawer', 'a1', 'adjustment', 100).commit());
    await assertSucceeds(cashMove(db(env, OWNER), OWNER, 'a2', 'adjustment', 100).commit());
  });

  it('cash transactions are immutable', async () => {
    await assertSucceeds(cashMove(drawer(), 'drawer', 'd2', 'deposit', 500).commit());
    await assertFails(updateDoc(doc(db(env, OWNER), tp(T, 'cashTransactions', 'd2')), { usdCents: 1 }));
  });

  it('cashiers cannot read the drawer history', async () => {
    await assertFails(getDocs(collection(cashier(), tp(T, 'cashTransactions'))));
  });
});

describe('customers', () => {
  const clerk = () => db(env, 'clerk', { role: 'subUser', perms: { canViewCustomers: true } });

  it('debt only changes together with a new ledger entry', async () => {
    const fs = clerk();
    await assertFails(updateDoc(doc(fs, tp(T, 'customers', 'c1')), { debtUsdCents: 0 }));
    await assertFails(updateDoc(doc(fs, tp(T, 'customers', 'c1')), { debtUsdCents: 0, lastLedgerId: 'seedLedger' }));
  });

  it('a debt payment (ledger + customer + cash + drawer) succeeds', async () => {
    const fs = clerk();
    const a = audit('clerk');
    const batch = writeBatch(fs);
    batch.set(doc(fs, tp(T, 'customerLedger', 'l1')), {
      customerId: 'c1',
      customerName: 'Ali',
      type: 'payment',
      amountUsdCents: -1_000,
      balanceAfterUsdCents: 2_000,
      paidUsdCents: 1_000,
      paidLbp: 0,
      refId: 'ptx',
      refNumber: null,
      note: '',
      ...a,
    });
    batch.update(doc(fs, tp(T, 'customers', 'c1')), { debtUsdCents: increment(-1_000), lastLedgerId: 'l1', updatedAt: serverTimestamp() });
    batch.set(doc(fs, tp(T, 'cashTransactions', 'ptx')), {
      type: 'debtPayment',
      usdCents: 1_000,
      lbp: 0,
      balanceAfter: null,
      category: 'debtPayment',
      note: 'Ali',
      refId: 'c1',
      refNumber: null,
      ...a,
    });
    batch.set(
      doc(fs, tp(T, 'cashbox', 'summary')),
      { usdCents: increment(1_000), lbp: increment(0), lastTxId: 'ptx', updatedAt: serverTimestamp() },
      { merge: true },
    );
    await assertSucceeds(batch.commit());
  });

  it('only the owner can post debt adjustments', async () => {
    const run = (fs: Firestore, uid: string) => {
      const batch = writeBatch(fs);
      batch.set(doc(fs, tp(T, 'customerLedger', `adj-${uid}`)), {
        customerId: 'c1',
        customerName: 'Ali',
        type: 'adjustment',
        amountUsdCents: -3_000,
        balanceAfterUsdCents: 0,
        paidUsdCents: 0,
        paidLbp: 0,
        refId: null,
        refNumber: null,
        note: '',
        ...audit(uid),
      });
      batch.update(doc(fs, tp(T, 'customers', 'c1')), { debtUsdCents: 0, lastLedgerId: `adj-${uid}`, updatedAt: serverTimestamp() });
      return batch.commit();
    };
    await assertFails(run(clerk(), 'clerk'));
    await assertSucceeds(run(db(env, OWNER), OWNER));
  });

  it('customers with debt cannot be deleted', async () => {
    const fs = clerk();
    await assertFails(writeBatch(fs).delete(doc(fs, tp(T, 'customers', 'c1'))).commit());
  });

  it('a new customer with an opening balance needs its opening ledger entry', async () => {
    const fs = clerk();
    const a = audit('clerk');
    const base = {
      name: 'Sara',
      phone: '',
      email: '',
      address: '',
      creditLimitUsdCents: 0,
      totalPurchasesUsdCents: 0,
      updatedAt: serverTimestamp(),
      createdAt: a.createdAt,
      createdAtMs: a.createdAtMs,
      createdBy: 'clerk',
    };
    await assertFails(setDoc(doc(fs, tp(T, 'customers', 'c2')), { ...base, debtUsdCents: 500, lastLedgerId: 'nope' }));
    const batch = writeBatch(fs);
    batch.set(doc(fs, tp(T, 'customerLedger', 'open1')), {
      customerId: 'c3',
      customerName: 'Sara',
      type: 'opening',
      amountUsdCents: 500,
      balanceAfterUsdCents: 500,
      paidUsdCents: 0,
      paidLbp: 0,
      refId: null,
      refNumber: null,
      note: '',
      ...a,
    });
    batch.set(doc(fs, tp(T, 'customers', 'c3')), { ...base, debtUsdCents: 500, lastLedgerId: 'open1' });
    await assertSucceeds(batch.commit());
  });

  it('a credit sale may post a settlement and a credit entry together', async () => {
    const fs = cashier();
    const a = audit('cashier');
    const batch = writeBatch(fs);
    batch.set(doc(fs, tp(T, 'sales', 'cs1')), {
      invoiceNumber: 'CR-000005',
      kind: 'credit',
      currency: 'USD',
      exchangeRate: 89_500,
      items: [{ productId: 'p1', name: 'Phone case', quantity: 1, unitUsdCents: 500, costUsdCents: 200, returnedQty: 0 }],
      totalUsdCents: 500,
      totalLbp: 0,
      discountUsdCents: 0,
      costUsdCents: 200,
      customerId: 'c1',
      customerName: 'Ali',
      payment: { receivedUsdCents: 0, receivedLbp: 0 },
      returnedUsdCents: 0,
      returnedDebtUsdCents: 0,
      refundedUsdCents: 0,
      refundedLbp: 0,
      returnStatus: 'none',
      lastReturnId: null,
      offline: false,
      ...a,
    });
    batch.set(doc(fs, tp(T, 'counters', 'sales')), { nextId: 6, updatedAt: serverTimestamp() }, { merge: true });
    batch.update(doc(fs, tp(T, 'products', 'p1')), { stock: increment(-1), lastMovementId: 'mv-cs1', updatedAt: serverTimestamp() });
    batch.set(doc(fs, tp(T, 'stockMovements', 'mv-cs1')), {
      productId: 'p1',
      productName: 'Phone case',
      type: 'sale',
      quantity: -1,
      stockAfter: 9,
      refId: 'cs1',
      refNumber: 'CR-000005',
      note: '',
      ...a,
    });
    const ledger = (id: string, type: string, amount: number) =>
      batch.set(doc(fs, tp(T, 'customerLedger', id)), {
        customerId: 'c1',
        customerName: 'Ali',
        type,
        amountUsdCents: amount,
        balanceAfterUsdCents: null,
        paidUsdCents: 0,
        paidLbp: 0,
        refId: 'cs1',
        refNumber: 'CR-000005',
        note: '',
        ...a,
      });
    ledger('lg-settle', 'settlement', -100);
    ledger('lg-credit', 'creditSale', 500);
    batch.update(doc(fs, tp(T, 'customers', 'c1')), {
      totalPurchasesUsdCents: increment(500),
      debtUsdCents: increment(400),
      lastLedgerId: 'lg-credit',
      updatedAt: serverTimestamp(),
    });
    await assertSucceeds(batch.commit());
  });
});

describe('suppliers and purchases', () => {
  it('a purchase paid from the drawer (counter, stock, bill, payment, cash) succeeds', async () => {
    const buyer = db(env, 'buyer', { role: 'subUser', perms: { canViewSuppliers: true, canManageCashDrawer: true } });
    const a = audit('buyer');
    await env.withSecurityRulesDisabled(async (ctx) => {
      const admin = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(admin, tp(T, 'suppliers', 'sup1')), { name: 'Supplier', balanceUsdCents: 0 });
    });
    const batch = writeBatch(buyer);
    batch.set(doc(buyer, tp(T, 'counters', 'purchases')), { nextId: 2, updatedAt: serverTimestamp() }, { merge: true });
    batch.update(doc(buyer, tp(T, 'products', 'p1')), {
      stock: increment(5),
      costUsdCents: 210,
      lastMovementId: 'mv-pu',
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(buyer, tp(T, 'stockMovements', 'mv-pu')), {
      productId: 'p1',
      productName: 'Phone case',
      type: 'purchase',
      quantity: 5,
      stockAfter: 15,
      refId: 'pu1',
      refNumber: 'PU-000001',
      note: 'Supplier',
      ...a,
    });
    batch.set(doc(buyer, tp(T, 'purchases', 'pu1')), {
      number: 'PU-000001',
      supplierId: 'sup1',
      supplierName: 'Supplier',
      date: a.localDate,
      dueDate: null,
      items: [{ productId: 'p1', name: 'Phone case', quantity: 5, unitCostUsdCents: 220, returnedQty: 0 }],
      totalUsdCents: 1_100,
      returnedUsdCents: 0,
      paidUsdCents: 600,
      remainingUsdCents: 500,
      status: 'partial',
      updateCost: true,
      note: '',
      ...a,
    });
    batch.update(doc(buyer, tp(T, 'suppliers', 'sup1')), { balanceUsdCents: increment(500), updatedAt: serverTimestamp() });
    batch.set(doc(buyer, tp(T, 'supplierPayments', 'sp1')), {
      supplierId: 'sup1',
      supplierName: 'Supplier',
      currency: 'USD',
      amount: 600,
      amountUsdCents: 600,
      exchangeRate: 0,
      method: 'cash',
      appliedTo: [],
      note: '',
      ...a,
    });
    batch.set(doc(buyer, tp(T, 'cashTransactions', 'sptx')), {
      type: 'supplierPayment',
      usdCents: -600,
      lbp: 0,
      balanceAfter: { usdCents: 9_400, lbp: 0 },
      category: 'supplierPayment',
      note: 'Supplier · PU-000001',
      refId: 'sp1',
      refNumber: 'PU-000001',
      ...a,
    });
    batch.set(
      doc(buyer, tp(T, 'cashbox', 'summary')),
      { usdCents: increment(-600), lastTxId: 'sptx', updatedAt: serverTimestamp() },
      { merge: true },
    );
    await assertSucceeds(batch.commit());
  });

  it('staff without canViewSuppliers cannot read purchases', async () => {
    await assertFails(getDocs(collection(cashier(), tp(T, 'purchases'))));
  });
});

describe('products', () => {
  it('cashiers cannot edit products or add stock', async () => {
    const fs = cashier();
    await assertFails(updateDoc(doc(fs, tp(T, 'products', 'p1')), { name: 'x', updatedAt: serverTimestamp() }));
    await assertFails(
      updateDoc(doc(fs, tp(T, 'products', 'p1')), { stock: 99, lastMovementId: 'm-x', updatedAt: serverTimestamp() }),
    );
  });

  it('editors can edit product fields', async () => {
    const editor = db(env, 'editor', { role: 'subUser', perms: { canViewProducts: true, canEditProducts: true } });
    await assertSucceeds(updateDoc(doc(editor, tp(T, 'products', 'p1')), { name: 'Case v2', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(editor, tp(T, 'products', 'p1')), { stock: 50 }));
  });

  it('adding a product with initial stock writes its movement', async () => {
    const adder = db(env, 'adder', { role: 'subUser', perms: { canViewProducts: true, canAddProducts: true } });
    const a = audit('adder');
    const batch = writeBatch(adder);
    batch.set(doc(adder, tp(T, 'stockMovements', 'mv-new')), {
      productId: 'p2',
      productName: 'Charger',
      type: 'initial',
      quantity: 4,
      stockAfter: 4,
      refId: null,
      refNumber: null,
      note: '',
      ...a,
    });
    batch.set(doc(adder, tp(T, 'products', 'p2')), {
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
      updatedAt: serverTimestamp(),
      stock: 4,
      imeis: [],
      imageUrl: null,
      imagePath: null,
      lastMovementId: 'mv-new',
      createdAt: a.createdAt,
      createdAtMs: a.createdAtMs,
      createdBy: 'adder',
    });
    await assertSucceeds(batch.commit());
  });

  it('deleting needs canDeleteProducts', async () => {
    const editor = db(env, 'editor', { role: 'subUser', perms: { canViewProducts: true, canEditProducts: true } });
    await assertFails(writeBatch(editor).delete(doc(editor, tp(T, 'products', 'p1'))).commit());
    const deleter = db(env, 'deleter', { role: 'subUser', perms: { canViewProducts: true, canDeleteProducts: true } });
    await assertSucceeds(writeBatch(deleter).delete(doc(deleter, tp(T, 'products', 'p1'))).commit());
  });
});

describe('settings and counters', () => {
  it('telegram secrets are hidden from staff', async () => {
    const staff = db(env, 'staff', { role: 'subUser', perms: { canViewSettings: true, canEditSettings: true } });
    await assertFails(getDoc(doc(staff, tp(T, 'private', 'telegram'))));
    await assertSucceeds(getDoc(doc(db(env, OWNER), tp(T, 'private', 'telegram'))));
  });

  it('settings need canEditSettings and a valid rate', async () => {
    await assertFails(setDoc(doc(cashier(), tp(T, 'settings', 'main')), { exchangeRate: 90_000 }, { merge: true }));
    await assertFails(setDoc(doc(db(env, OWNER), tp(T, 'settings', 'main')), { exchangeRate: -1 }, { merge: true }));
    await assertSucceeds(setDoc(doc(db(env, OWNER), tp(T, 'settings', 'main')), { exchangeRate: 90_000 }, { merge: true }));
  });

  it('counters only advance by one', async () => {
    const fs = cashier();
    await assertFails(setDoc(doc(fs, tp(T, 'counters', 'sales')), { nextId: 1 }, { merge: true }));
    await assertSucceeds(setDoc(doc(fs, tp(T, 'counters', 'sales')), { nextId: 6 }, { merge: true }));
  });

  it('daily stats are readable only with canViewReports', async () => {
    await assertFails(getDocs(collection(cashier(), tp(T, 'dailyStats'))));
    const reporter = db(env, 'rep', { role: 'subUser', perms: { canViewReports: true } });
    await assertSucceeds(getDocs(collection(reporter, tp(T, 'dailyStats'))));
  });
});
