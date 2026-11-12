import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, Timestamp, updateDoc, where } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  asAdmin,
  call,
  callOk,
  clearAuth,
  clearFirestore,
  createEnv,
  createUser,
  DAY,
  functionsCallableUrl,
  OTHER,
  RATE,
  readDoc,
  readWhere,
  seedTenant,
  settleUntil,
  T,
  tp,
  type SeedProfile,
} from './helpers';

let env: RulesTestEnvironment;
const tokens: Record<string, string> = {};

const STAFF: (SeedProfile & { perms?: Record<string, boolean> })[] = [
  { uid: 'cashier', role: 'subUser', permissions: { canSell: true } },
  { uid: 'pricer', role: 'subUser', permissions: { canSell: true, canEditPrice: true } },
  { uid: 'clerk', role: 'subUser', permissions: { canViewSales: true, canViewCustomers: true } },
  { uid: 'returner', role: 'subUser', permissions: { canViewSales: true, canSell: true } },
  { uid: 'drawerReturner', role: 'subUser', permissions: { canViewSales: true, canManageCashDrawer: true } },
  { uid: 'editor', role: 'subUser', permissions: { canViewProducts: true, canAddProducts: true, canEditProducts: true, canImportProducts: true } },
  { uid: 'buyer', role: 'subUser', permissions: { canViewSuppliers: true, canManageCashDrawer: true } },
  { uid: 'ghost', role: 'subUser', permissions: { canSell: true }, isActive: false },
  { uid: 'archivist', role: 'subUser', permissions: { canViewProducts: true, canDeleteProducts: true } },
];

async function seed(opts: { subscriptionEndsAt?: number } = {}) {
  await clearFirestore(env);
  await seedTenant(env, T, [{ uid: T, role: 'owner' }, ...STAFF], opts);
  await seedTenant(env, OTHER, [{ uid: OTHER, role: 'owner' }]);
}

beforeAll(async () => {
  env = await createEnv();
  await clearAuth();
  tokens.owner = await createUser({ uid: T, tenantId: T, role: 'owner' });
  tokens.intruder = await createUser({ uid: OTHER, tenantId: OTHER, role: 'owner' });
  for (const s of STAFF) tokens[s.uid] = await createUser({ uid: s.uid, tenantId: T, role: 'subUser', perms: s.permissions });
});
afterAll(async () => {
  await env?.cleanup();
});
beforeEach(async () => {
  await seed();
});

let saleSeq = 0;
function cashSale(overrides: Record<string, unknown> = {}, line: Record<string, unknown> = {}) {
  saleSeq += 1;
  const quantity = (line.quantity as number | undefined) ?? 2;
  const unit = (line.customUsdCents as number | null | undefined) ?? 500;
  return {
    saleId: `sale${Date.now()}${saleSeq}`,
    kind: 'cash',
    currency: 'USD',
    rate: RATE,
    customerId: null,
    debtLineUsdCents: null,
    lines: [{ productId: 'p1', tier: 'retail', quantity: 2, customUsdCents: null, imei: null, ...line }],
    expectedTotalUsdCents: unit * quantity,
    cash: { receivedUsdCents: unit * quantity, receivedLbp: 0 },
    ...overrides,
  };
}

const stock = async (t = T, id = 'p1') => Number((await readDoc(env, tp(t, 'products', id)))?.stock);
const drawer = async () => (await readDoc(env, tp(T, 'cashbox', 'summary'))) as { usdCents: number; lbp: number };

describe('posCheckout', () => {
  it('records the sale, stock, movement, drawer, counter and daily stats atomically', async () => {
    const res = await callOk<{ sale: Record<string, unknown>; duplicate: boolean }>(tokens.cashier!, 'posCheckout', cashSale());
    expect(res.duplicate).toBe(false);
    expect(res.sale.invoiceNumber).toBe('INV-005');
    expect(res.sale.totalUsdCents).toBe(1_000);
    expect(res.sale.costUsdCents).toBe(400);
    expect(await stock()).toBe(8);
    expect((await drawer()).usdCents).toBe(11_000);
    expect((await readDoc(env, tp(T, 'counters', 'sales')))?.nextId).toBe(6);
    const movements = await readWhere(env, tp(T, 'stockMovements'), 'productId', 'p1');
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ type: 'sale', quantity: -2, stockAfter: 8, createdBy: 'cashier' });
    const stats = await readDoc(env, tp(T, 'dailyStats', String(res.sale.localDate)));
    expect(stats).toMatchObject({ salesCount: 1, revenueUsdCents: 1_000, costUsdCents: 400, cashSalesUsdCents: 1_000 });
  });

  it('is idempotent on saleId (a retry never sells twice)', async () => {
    const sale = cashSale();
    await callOk(tokens.cashier!, 'posCheckout', sale);
    const again = await callOk<{ duplicate: boolean }>(tokens.cashier!, 'posCheckout', sale);
    expect(again.duplicate).toBe(true);
    expect(await stock()).toBe(8);
    expect((await drawer()).usdCents).toBe(11_000);
  });

  it('rejects a price override without canEditPrice (fake sale price)', async () => {
    const { error } = await call(tokens.cashier!, 'posCheckout', cashSale({}, { customUsdCents: 1 }));
    expect(error?.status).toBe('PERMISSION_DENIED');
    expect(await stock()).toBe(10);
    expect((await drawer()).usdCents).toBe(10_000);
  });

  it('allows a price override with canEditPrice and records the discount', async () => {
    const res = await callOk<{ sale: Record<string, unknown> }>(tokens.pricer!, 'posCheckout', cashSale({}, { customUsdCents: 400 }));
    expect(res.sale).toMatchObject({ totalUsdCents: 800, discountUsdCents: 200 });
  });

  it('recomputes totals server-side: a client total that does not match is refused', async () => {
    const { error } = await call(tokens.cashier!, 'posCheckout', cashSale({ expectedTotalUsdCents: 2, cash: { receivedUsdCents: 2, receivedLbp: 0 } }));
    expect(error?.key).toBe('error.pricesChanged');
    expect(await stock()).toBe(10);
  });

  it('refuses a payment that does not cover the total', async () => {
    const { error } = await call(tokens.cashier!, 'posCheckout', cashSale({ cash: { receivedUsdCents: 100, receivedLbp: 0 } }));
    expect(error?.key).toBe('error.paymentMismatch');
  });

  it('keeps the physical tender and change, and moves the drawer by the net', async () => {
    await callOk(tokens.owner!, 'posCashMove', { type: 'deposit', usdCents: 0, lbp: 1_000_000, category: '', note: '' });
    const sale = cashSale({ cash: { receivedUsdCents: 2_000, receivedLbp: 0, changeUsdCents: 0, changeLbp: 895_000 } });
    const res = await callOk<{ sale: { payment: Record<string, number> } }>(tokens.cashier!, 'posCheckout', sale);
    expect(res.sale.payment).toMatchObject({ receivedUsdCents: 2_000, receivedLbp: 0, changeUsdCents: 0, changeLbp: 895_000 });
    expect(await drawer()).toMatchObject({ usdCents: 12_000, lbp: 105_000 });
    const refund = await callOk<{ saleReturn: { refundUsdCents: number; refundLbp: number } }>(tokens.returner!, 'posReturn', {
      saleId: sale.saleId,
      lines: [{ index: 0, quantity: 2 }],
    });
    expect(refund.saleReturn).toMatchObject({ refundUsdCents: 1_000, refundLbp: 0 });
    expect(await drawer()).toMatchObject({ usdCents: 11_000, lbp: 105_000 });
  });

  it('stores the cart name and note without replacing the customer', async () => {
    const sale = cashSale({ customerId: null, orderLabel: 'Johnny', note: 'Deliver at 5 PM' });
    const res = await callOk<{ sale: { orderLabel: string; note: string; customerName: string } }>(tokens.cashier!, 'posCheckout', sale);
    expect(res.sale).toMatchObject({ orderLabel: 'Johnny', note: 'Deliver at 5 PM', customerName: '' });
  });

  it('returns USD change from the cash just received', async () => {
    await callOk(tokens.cashier!, 'posCheckout', cashSale({ cash: { receivedUsdCents: 21_000, receivedLbp: 0, changeUsdCents: 20_000, changeLbp: 0 } }));
    expect((await drawer()).usdCents).toBe(11_000);
    expect(await stock()).toBe(8);
  });

  it('refuses LBP change the drawer and the tender do not have', async () => {
    const { error } = await call(
      tokens.cashier!,
      'posCheckout',
      cashSale({ cash: { receivedUsdCents: 21_000, receivedLbp: 0, changeUsdCents: 0, changeLbp: 17_900_000 } }),
    );
    expect(error?.key).toBe('error.drawerInsufficient');
    expect((await drawer()).usdCents).toBe(10_000);
    expect(await stock()).toBe(10);
  });

  it('refuses a stale exchange rate', async () => {
    const { error } = await call(tokens.cashier!, 'posCheckout', cashSale({ rate: 1 }));
    expect(error?.key).toBe('error.rateChanged');
  });

  it('blocks negative stock', async () => {
    const { error } = await call(tokens.cashier!, 'posCheckout', cashSale({}, { quantity: 11 }));
    expect(error?.key).toBe('error.insufficientStock');
    expect(await stock()).toBe(10);
  });

  it('marks sold IMEIs and refuses an IMEI that is not available', async () => {
    const phone = (imei: string) =>
      cashSale({ expectedTotalUsdCents: 20_000, cash: { receivedUsdCents: 20_000, receivedLbp: 0 } }, { productId: 'ph', quantity: 1, imei });
    await callOk(tokens.cashier!, 'posCheckout', phone('111'));
    const product = await readDoc(env, tp(T, 'products', 'ph'));
    expect(product?.stock).toBe(1);
    expect(product?.imeis).toEqual([
      { imei: '111', status: 'sold' },
      { imei: '222', status: 'available' },
    ]);
    const { error } = await call(tokens.cashier!, 'posCheckout', phone('111'));
    expect(error?.key).toBe('error.imeiUnavailable');
    const noImei = await call(tokens.cashier!, 'posCheckout', phone('999'));
    expect(noImei.error?.key).toBe('error.imeiUnavailable');
  });

  it('credit sale adds the unpaid part to the debt with a ledger entry', async () => {
    const res = await callOk<{ sale: Record<string, unknown> }>(
      tokens.cashier!,
      'posCheckout',
      cashSale({ kind: 'credit', customerId: 'c1', cash: undefined, credit: { paidUsdCents: 200, paidLbp: 0 } }),
    );
    expect(res.sale.invoiceNumber).toBe('CR-005');
    const customer = await readDoc(env, tp(T, 'customers', 'c1'));
    expect(customer).toMatchObject({ debtUsdCents: 3_800, totalPurchasesUsdCents: 1_000 });
    const ledger = await readWhere(env, tp(T, 'customerLedger'), 'customerId', 'c1');
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ type: 'creditSale', amountUsdCents: 800, balanceAfterUsdCents: 3_800 });
    expect((await drawer()).usdCents).toBe(10_200);
  });

  it('enforces the credit limit', async () => {
    const { error } = await call(
      tokens.cashier!,
      'posCheckout',
      cashSale(
        { kind: 'credit', customerId: 'c1', cash: undefined, credit: { paidUsdCents: 0, paidLbp: 0 }, expectedTotalUsdCents: 20_000 },
        { productId: 'ph', quantity: 1, imei: '111' },
      ),
    );
    expect(error?.key).toBe('error.credit.creditLimit');
    expect(await stock(T, 'ph')).toBe(2);
    expect((await readDoc(env, tp(T, 'customers', 'c1')))?.debtUsdCents).toBe(3_000);
  });

  it('users without canSell, deactivated users and expired stores cannot sell', async () => {
    expect((await call(tokens.clerk!, 'posCheckout', cashSale())).error?.status).toBe('PERMISSION_DENIED');
    expect((await call(tokens.ghost!, 'posCheckout', cashSale())).error?.status).toBe('PERMISSION_DENIED');
    await seed({ subscriptionEndsAt: Date.now() - DAY });
    expect((await call(tokens.cashier!, 'posCheckout', cashSale())).error?.key).toBe('error.fn.subscriptionInactive');
    expect(await stock()).toBe(10);
  });

  it('same-id retry recovers a committed sale after disable or subscription end, without a second write', async () => {
    const sale = cashSale();
    await callOk(tokens.cashier!, 'posCheckout', sale);
    await asAdmin(env, (fs) => updateDoc(doc(fs, 'users/cashier'), { isActive: false }));
    const afterDisable = await callOk<{ duplicate: boolean; sale: { invoiceNumber: string } }>(tokens.cashier!, 'posCheckout', sale);
    expect(afterDisable.duplicate).toBe(true);
    expect(afterDisable.sale.invoiceNumber).toBe('INV-005');
    expect(await stock()).toBe(8);
    expect((await call(tokens.cashier!, 'posCheckout', cashSale())).error?.key).toBe('error.userInactive');

    await asAdmin(env, async (fs) => {
      await updateDoc(doc(fs, 'users/cashier'), { isActive: true });
      await updateDoc(doc(fs, `subscriptions/${T}`), { endsAt: Timestamp.fromMillis(Date.now() - DAY) });
    });
    const afterSub = await callOk<{ duplicate: boolean }>(tokens.cashier!, 'posCheckout', sale);
    expect(afterSub.duplicate).toBe(true);
    expect(await stock()).toBe(8);
    expect((await call(tokens.cashier!, 'posCheckout', cashSale())).error?.key).toBe('error.fn.subscriptionInactive');
  });

  it('another tenant cannot sell this tenant’s stock (tenant comes from the token, not the request)', async () => {
    const { error } = await call(tokens.intruder!, 'posCheckout', cashSale());
    expect(error).toBeUndefined();
    expect(await stock(T)).toBe(10);
    expect(await stock(OTHER)).toBe(8);
  });
});

describe('posReturn', () => {
  it('restocks and refunds from the drawer', async () => {
    const sale = cashSale();
    await callOk(tokens.cashier!, 'posCheckout', sale);
    const res = await callOk<{ saleReturn: Record<string, unknown> }>(tokens.returner!, 'posReturn', {
      saleId: sale.saleId,
      lines: [{ index: 0, quantity: 1 }],
      reason: 'broken',
    });
    expect(res.saleReturn).toMatchObject({ amountUsdCents: 500, refundUsdCents: 500, number: 'RF-006' });
    expect(await stock()).toBe(9);
    expect((await drawer()).usdCents).toBe(10_500);
    const saved = await readDoc(env, tp(T, 'sales', sale.saleId));
    expect(saved).toMatchObject({ returnStatus: 'partial', returnedUsdCents: 500 });
    const tooMany = await call(tokens.returner!, 'posReturn', { saleId: sale.saleId, lines: [{ index: 0, quantity: 2 }] });
    expect(tooMany.error?.key).toBe('error.return.tooMany');
  });

  it('cashiers without canViewSales cannot process returns', async () => {
    const sale = cashSale();
    await callOk(tokens.cashier!, 'posCheckout', sale);
    const { error } = await call(tokens.cashier!, 'posReturn', { saleId: sale.saleId, lines: [{ index: 0, quantity: 1 }] });
    expect(error?.status).toBe('PERMISSION_DENIED');
  });

  it('sales-view-only reporters cannot process returns', async () => {
    const sale = cashSale();
    await callOk(tokens.cashier!, 'posCheckout', sale);
    const { error } = await call(tokens.clerk!, 'posReturn', { saleId: sale.saleId, lines: [{ index: 0, quantity: 1 }] });
    expect(error?.status).toBe('PERMISSION_DENIED');
  });

  it('drawer managers with canViewSales can process returns', async () => {
    const sale = cashSale();
    await callOk(tokens.cashier!, 'posCheckout', sale);
    const res = await callOk<{ saleReturn: Record<string, unknown> }>(tokens.drawerReturner!, 'posReturn', {
      saleId: sale.saleId,
      lines: [{ index: 0, quantity: 1 }],
    });
    expect(res.saleReturn).toMatchObject({ amountUsdCents: 500, refundUsdCents: 500 });
  });

  it('drawer managers without canViewSales cannot process returns', async () => {
    const sale = cashSale();
    await callOk(tokens.cashier!, 'posCheckout', sale);
    const { error } = await call(tokens.buyer!, 'posReturn', { saleId: sale.saleId, lines: [{ index: 0, quantity: 1 }] });
    expect(error?.status).toBe('PERMISSION_DENIED');
  });

  it('a credit-sale return reduces the debt before refunding cash', async () => {
    const sale = cashSale({ kind: 'credit', customerId: 'c1', cash: undefined, credit: { paidUsdCents: 0, paidLbp: 0 } });
    await callOk(tokens.cashier!, 'posCheckout', sale);
    const res = await callOk<{ saleReturn: Record<string, unknown> }>(tokens.returner!, 'posReturn', {
      saleId: sale.saleId,
      lines: [{ index: 0, quantity: 2 }],
    });
    expect(res.saleReturn).toMatchObject({ debtReducedUsdCents: 1_000, refundUsdCents: 0 });
    expect((await readDoc(env, tp(T, 'customers', 'c1')))?.debtUsdCents).toBe(3_000);
    expect((await drawer()).usdCents).toBe(10_000);
  });
});

describe('customer debt', () => {
  it('a payment reduces the debt with a ledger entry and matching drawer money', async () => {
    await callOk(tokens.clerk!, 'posPayDebt', { customerId: 'c1', usdCents: 1_000, lbp: 0, rate: RATE, note: '' });
    expect((await readDoc(env, tp(T, 'customers', 'c1')))?.debtUsdCents).toBe(2_000);
    const ledger = await readWhere(env, tp(T, 'customerLedger'), 'customerId', 'c1');
    expect(ledger[0]).toMatchObject({ type: 'payment', amountUsdCents: -1_000, balanceAfterUsdCents: 2_000 });
    const cash = await readWhere(env, tp(T, 'cashTransactions'), 'type', 'debtPayment');
    expect(cash[0]).toMatchObject({ usdCents: 1_000, refId: 'c1' });
    expect((await drawer()).usdCents).toBe(11_000);
  });

  it('refuses paying more than the debt and users without customer access', async () => {
    expect((await call(tokens.clerk!, 'posPayDebt', { customerId: 'c1', usdCents: 5_000, lbp: 0, rate: RATE })).error?.key).toBe(
      'error.paymentExceedsDebt',
    );
    expect((await call(tokens.cashier!, 'posPayDebt', { customerId: 'c1', usdCents: 100, lbp: 0, rate: RATE })).error?.status).toBe(
      'PERMISSION_DENIED',
    );
  });

  it('only the owner adjusts debt', async () => {
    expect((await call(tokens.clerk!, 'posAdjustDebt', { customerId: 'c1', newDebtUsdCents: 0, note: 'x' })).error?.status).toBe(
      'PERMISSION_DENIED',
    );
    await callOk(tokens.owner!, 'posAdjustDebt', { customerId: 'c1', newDebtUsdCents: 0, note: 'forgiven' });
    expect((await readDoc(env, tp(T, 'customers', 'c1')))?.debtUsdCents).toBe(0);
  });

  it('a customer with an opening debt gets its opening ledger entry', async () => {
    const { id } = await callOk<{ id: string }>(tokens.clerk!, 'posCreateCustomer', {
      customer: { name: 'Sara', phone: '', email: '', address: '', creditLimitUsdCents: 0 },
      openingDebtUsdCents: 700,
    });
    expect((await readDoc(env, tp(T, 'customers', id)))?.debtUsdCents).toBe(700);
    expect((await readWhere(env, tp(T, 'customerLedger'), 'customerId', id))[0]).toMatchObject({ type: 'opening', amountUsdCents: 700 });
  });
});

describe('inventory', () => {
  it('stock adjustments need canEditProducts, write a movement and never go negative', async () => {
    const adjust = { productId: 'p1', mode: 'add', quantity: 5, unitCostUsdCents: 300, payFromCashbox: false, imeisToAdd: [], imeisToRemove: [], note: '' };
    expect((await call(tokens.cashier!, 'posAdjustStock', adjust)).error?.status).toBe('PERMISSION_DENIED');
    await callOk(tokens.editor!, 'posAdjustStock', adjust);
    const product = await readDoc(env, tp(T, 'products', 'p1'));
    expect(product).toMatchObject({ stock: 15, costUsdCents: 233 });
    expect(await readWhere(env, tp(T, 'stockMovements'), 'type', 'adjustment')).toHaveLength(1);
    const { error } = await call(tokens.editor!, 'posAdjustStock', { ...adjust, mode: 'remove', quantity: 16 });
    expect(error?.key).toBe('error.insufficientStock');
  });

  it('paying stock from the drawer requires drawer access', async () => {
    const adjust = { productId: 'p1', mode: 'add', quantity: 5, unitCostUsdCents: 300, payFromCashbox: true, imeisToAdd: [], imeisToRemove: [], note: '' };
    expect((await call(tokens.editor!, 'posAdjustStock', adjust)).error?.status).toBe('PERMISSION_DENIED');
    await callOk(tokens.owner!, 'posAdjustStock', adjust);
    expect((await drawer()).usdCents).toBe(8_500);
  });

  it('a new product with initial stock gets an initial movement', async () => {
    const { id } = await callOk<{ id: string }>(tokens.editor!, 'posCreateProduct', {
      product: {
        name: 'Charger',
        category: 'Power',
        barcode: 'CH-1',
        prices: { retail: { usdCents: 900, lbp: null }, wholesale: { usdCents: 0, lbp: null }, vip: { usdCents: 0, lbp: null } },
        costUsdCents: 400,
        minStock: null,
        supplierId: null,
        supplierName: '',
        expiryDate: null,
        imeiTracking: false,
      },
      initialStock: 4,
      initialImeis: [],
    });
    expect(await stock(T, id)).toBe(4);
    expect((await readWhere(env, tp(T, 'stockMovements'), 'productId', id))[0]).toMatchObject({ type: 'initial', quantity: 4 });
  });

  it('repeats of one create, including a delayed one, return the original product', async () => {
    const product = {
      name: 'Once Soap',
      category: '',
      barcode: 'ONCE-1',
      prices: { retail: { usdCents: 300, lbp: null }, wholesale: { usdCents: 0, lbp: null }, vip: { usdCents: 0, lbp: null } },
      costUsdCents: 0,
      costKnown: false,
      minStock: null,
      supplierId: null,
      supplierName: '',
      expiryDate: null,
      imeiTracking: false,
    };
    const denied = await call(tokens.cashier!, 'posCreateProduct', {
      clientOperationId: 'cashierCreateNo01',
      product,
      initialStock: 0,
      initialImeis: [],
    });
    expect(denied.error?.status).toBe('PERMISSION_DENIED');
    expect(await readWhere(env, tp(T, 'products'), 'barcode', 'ONCE-1')).toHaveLength(0);

    const payload = { clientOperationId: 'createOnceSoap01', product, initialStock: 0, initialImeis: [] };
    const first = await callOk<{ id: string; duplicate: boolean }>(tokens.editor!, 'posCreateProduct', payload);
    const second = await callOk<{ id: string; duplicate: boolean }>(tokens.editor!, 'posCreateProduct', payload);
    expect(first.duplicate).toBe(false);
    expect(second).toEqual({ id: first.id, duplicate: true });
    expect(await readDoc(env, tp(T, 'products', first.id))).toMatchObject({ costUsdCents: 0, costKnown: false, stock: 0 });
    expect(await readWhere(env, tp(T, 'products'), 'barcode', 'ONCE-1')).toHaveLength(1);

    const delayed = {
      clientOperationId: 'createDelaySoap01',
      emulatorDelayMs: 2500,
      product: { ...product, name: 'Delay Soap', barcode: 'DELAY-1' },
      initialStock: 0,
      initialImeis: [],
    };
    const [slow, retry] = await Promise.all([
      callOk<{ id: string; duplicate: boolean }>(tokens.editor!, 'posCreateProduct', delayed),
      callOk<{ id: string; duplicate: boolean }>(tokens.editor!, 'posCreateProduct', { ...delayed, emulatorDelayMs: 0 }),
    ]);
    expect(slow.id).toBe(retry.id);
    expect([slow.duplicate, retry.duplicate].sort()).toEqual([false, true]);
    expect(await readWhere(env, tp(T, 'products'), 'barcode', 'DELAY-1')).toHaveLength(1);
  });

  it('serialized opening stock must match the IMEI list and is not created when it does not', async () => {
    const product = {
      name: 'Serialized phone',
      category: 'Phones',
      barcode: 'SER-1',
      prices: { retail: { usdCents: 100, lbp: null }, wholesale: { usdCents: 0, lbp: null }, vip: { usdCents: 0, lbp: null } },
      costUsdCents: 40,
      minStock: null,
      supplierId: null,
      supplierName: '',
      expiryDate: null,
      imeiTracking: true,
    };
    const mismatch = await call(tokens.editor!, 'posCreateProduct', { product, initialStock: 5, initialImeis: ['352099001234567', '352099001234575', '352099001234583'] });
    expect(mismatch.error?.key).toBe('error.initialImeiCount');
    expect(await readWhere(env, tp(T, 'products'), 'barcode', 'SER-1')).toHaveLength(0);
    const duplicate = await call(tokens.editor!, 'posCreateProduct', { product, initialStock: 2, initialImeis: ['352099001234567', '352099001234567'] });
    expect(duplicate.error?.key).toBe('error.imeiExists');
    const { id } = await callOk<{ id: string }>(tokens.editor!, 'posCreateProduct', {
      product,
      initialStock: 2,
      initialImeis: ['352099001234567', '352099001234575'],
    });
    expect(await readDoc(env, tp(T, 'products', id))).toMatchObject({
      stock: 2,
      imeis: [
        { imei: '352099001234567', status: 'available' },
        { imei: '352099001234575', status: 'available' },
      ],
    });
  });
});

describe('product archiving and deletion', () => {
  const newProduct = (name: string, initialStock = 0) =>
    callOk<{ id: string }>(tokens.editor!, 'posCreateProduct', {
      product: {
        name,
        category: '',
        barcode: '',
        prices: { retail: { usdCents: 900, lbp: null }, wholesale: { usdCents: 0, lbp: null }, vip: { usdCents: 0, lbp: null } },
        costUsdCents: 400,
        minStock: null,
        supplierId: null,
        supplierName: '',
        expiryDate: null,
        imeiTracking: false,
      },
      initialStock,
      initialImeis: [],
    });
  const archive = (id: string, token = tokens.archivist!) => call(token, 'posSetProductStatus', { productId: id, status: 'archived' });

  it('a product with stock cannot be deleted', async () => {
    const { error } = await call(tokens.archivist!, 'posDeleteProduct', { productId: 'p1' });
    expect(error?.key).toBe('error.productInUse');
    expect(await stock()).toBe(10);
  });

  it('a product referenced by a sale cannot be deleted even at zero stock, and can be archived instead', async () => {
    await callOk(tokens.cashier!, 'posCheckout', cashSale({}, { quantity: 10 }));
    expect(await stock()).toBe(0);
    expect((await call(tokens.archivist!, 'posDeleteProduct', { productId: 'p1' })).error?.key).toBe('error.productInUse');
    expect((await archive('p1')).error).toBeUndefined();
    expect(await readDoc(env, tp(T, 'products', 'p1'))).toMatchObject({ status: 'archived', archivedBy: 'archivist' });
  });

  it('a product referenced only by a purchase (no movement) is still protected', async () => {
    const { id } = await newProduct('Cable');
    await callOk(tokens.buyer!, 'posCreatePurchase', {
      supplierId: 'sup1', date: '2026-09-30', dueDate: null,
      items: [{ productId: id, quantity: 1, unitCostUsdCents: 100 }],
      updateCost: false, paidNowUsdCents: 0, payFromCashbox: false, note: '',
    });
    const purchases = await readWhere(env, tp(T, 'purchases'), 'supplierId', 'sup1');
    expect(purchases[0]?.productIds).toEqual([id]);
    expect((await call(tokens.archivist!, 'posDeleteProduct', { productId: id })).error?.key).toBe('error.productInUse');
  });

  it('an archived product cannot be sold or purchased, and keeps its stock', async () => {
    await callOk(tokens.cashier!, 'posCheckout', cashSale());
    expect((await archive('p1')).error).toBeUndefined();
    const sale = await call(tokens.cashier!, 'posCheckout', cashSale());
    expect(sale.error?.key).toBe('error.productArchived');
    const purchase = await call(tokens.buyer!, 'posCreatePurchase', {
      supplierId: 'sup1', date: '2026-09-30', dueDate: null,
      items: [{ productId: 'p1', quantity: 1, unitCostUsdCents: 100 }],
      updateCost: false, paidNowUsdCents: 0, payFromCashbox: false, note: '',
    });
    expect(purchase.error?.key).toBe('error.productArchived');
    expect(await stock()).toBe(8);
  });

  it('an archived product’s history stays readable and returns still work', async () => {
    const sale = cashSale();
    await callOk(tokens.cashier!, 'posCheckout', sale);
    await archive('p1');
    const saved = await readDoc(env, tp(T, 'sales', sale.saleId));
    expect(saved).toMatchObject({ productIds: ['p1'] });
    expect((saved?.items as { name: string }[])[0]?.name).toBeTruthy();
    expect(await readWhere(env, tp(T, 'stockMovements'), 'productId', 'p1')).toHaveLength(1);
    await callOk(tokens.returner!, 'posReturn', { saleId: sale.saleId, lines: [{ index: 0, quantity: 1 }] });
    expect(await stock()).toBe(9);
  });

  it('restoring an archived product makes it sellable again', async () => {
    await archive('p1');
    await callOk(tokens.archivist!, 'posSetProductStatus', { productId: 'p1', status: 'active' });
    expect(await readDoc(env, tp(T, 'products', 'p1'))).toMatchObject({ status: 'active', archivedAt: null });
    await callOk(tokens.cashier!, 'posCheckout', cashSale());
    expect(await stock()).toBe(8);
  });

  it('archiving needs canDeleteProducts', async () => {
    expect((await archive('p1', tokens.editor!)).error?.status).toBe('PERMISSION_DENIED');
    await archive('p1', tokens.intruder!);
    expect((await readDoc(env, tp(T, 'products', 'p1')))?.status).not.toBe('archived');
    expect((await readDoc(env, tp(OTHER, 'products', 'p1')))?.status).toBe('archived');
  });

  it('a never-used product with zero stock can be permanently deleted', async () => {
    const { id } = await newProduct('Sticker');
    await callOk(tokens.archivist!, 'posDeleteProduct', { productId: id });
    expect(await readDoc(env, tp(T, 'products', id))).toBeUndefined();
  });
});

describe('suppliers', () => {
  it('purchase, partial cash payment and settlement keep bill, balance, stock and drawer consistent', async () => {
    const { id } = await callOk<{ id: string }>(tokens.buyer!, 'posCreatePurchase', {
      supplierId: 'sup1',
      date: '2026-09-30',
      dueDate: null,
      items: [{ productId: 'p1', quantity: 5, unitCostUsdCents: 220 }],
      updateCost: true,
      paidNowUsdCents: 600,
      payFromCashbox: true,
      note: '',
    });
    expect(await readDoc(env, tp(T, 'purchases', id))).toMatchObject({ totalUsdCents: 1_100, paidUsdCents: 600, remainingUsdCents: 500, status: 'partial' });
    expect((await readDoc(env, tp(T, 'suppliers', 'sup1')))?.balanceUsdCents).toBe(500);
    expect(await stock()).toBe(15);
    expect((await drawer()).usdCents).toBe(9_400);

    const over = await call(tokens.buyer!, 'posPaySupplier', { supplierId: 'sup1', currency: 'USD', amount: 600, rate: RATE, method: 'cash' });
    expect(over.error?.key).toBe('error.paymentExceedsBalance');

    await callOk(tokens.buyer!, 'posPaySupplier', { supplierId: 'sup1', currency: 'USD', amount: 500, rate: RATE, method: 'cash', note: '' });
    expect(await readDoc(env, tp(T, 'purchases', id))).toMatchObject({ remainingUsdCents: 0, status: 'paid' });
    expect((await readDoc(env, tp(T, 'suppliers', 'sup1')))?.balanceUsdCents).toBe(0);
    expect((await drawer()).usdCents).toBe(8_900);
  });

  it('staff without supplier access cannot buy or pay', async () => {
    const res = await call(tokens.cashier!, 'posPaySupplier', { supplierId: 'sup1', currency: 'USD', amount: 100, rate: RATE, method: 'other' });
    expect(res.error?.status).toBe('PERMISSION_DENIED');
  });
});

describe('cash drawer', () => {
  it('withdrawals cannot exceed the drawer and need drawer access', async () => {
    expect((await call(tokens.buyer!, 'posCashMove', { type: 'withdrawal', usdCents: 20_000, lbp: 0 })).error?.key).toBe(
      'error.drawerInsufficient',
    );
    expect((await call(tokens.cashier!, 'posCashMove', { type: 'deposit', usdCents: 100, lbp: 0 })).error?.status).toBe('PERMISSION_DENIED');
    await callOk(tokens.buyer!, 'posCashMove', { type: 'expense', usdCents: 1_000, lbp: 0, category: 'rent', note: '' });
    expect((await drawer()).usdCents).toBe(9_000);
    const expenses = await readWhere(env, tp(T, 'cashTransactions'), 'type', 'expense');
    expect(expenses[0]).toMatchObject({ usdCents: -1_000, balanceAfter: { usdCents: 9_000, lbp: 0 } });
  });

  it('only the owner adjusts the drawer', async () => {
    expect((await call(tokens.buyer!, 'posAdjustDrawer', { usdCents: 0, lbp: 0 })).error?.status).toBe('PERMISSION_DENIED');
    await callOk(tokens.owner!, 'posAdjustDrawer', { usdCents: 9_500, lbp: 0, note: 'count' });
    expect((await drawer()).usdCents).toBe(9_500);
  });
});

describe('input validation', () => {
  it('rejects malformed or oversized input', async () => {
    const bad = [
      cashSale({ lines: [] }),
      cashSale({}, { quantity: -1 }),
      cashSale({}, { quantity: 1.5 }),
      cashSale({ saleId: '../../x' }),
    ];
    for (const payload of bad) expect((await call(tokens.cashier!, 'posCheckout', payload)).error?.status).toBe('INVALID_ARGUMENT');
  });

  it('back-dated offline timestamps are clamped to the server time', async () => {
    const res = await callOk<{ sale: Record<string, unknown> }>(tokens.cashier!, 'posCheckout', cashSale({ clientCreatedAtMs: Date.now() - 60 * DAY }));
    expect(Math.abs(Number(res.sale.createdAtMs) - Date.now())).toBeLessThan(60_000);
  });
});

interface BurstRow {
  index: number;
  saleId: string;
  http: number;
  ms: number;
  thrown: string | null;
  invoice: string | null;
  duplicate: boolean | null;
  error: string | null;
  committed: boolean;
}

/** Calls posCheckout and records the HTTP outcome, including a dropped connection. */
async function checkoutBurst(token: string, data: unknown, index: number, saleId: string): Promise<Omit<BurstRow, 'committed'>> {
  const started = Date.now();
  try {
    const res = await fetch(functionsCallableUrl('posCheckout'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ data }),
      signal: AbortSignal.timeout(45_000),
    });
    const text = await res.text();
    type CheckoutBody = { result?: { sale?: { invoiceNumber?: string }; duplicate?: boolean }; error?: { status?: string; message?: string; details?: { key?: string } } };
    let parsed: CheckoutBody | null = null;
    try {
      parsed = JSON.parse(text) as CheckoutBody;
    } catch {
      parsed = null;
    }
    return {
      index,
      saleId,
      http: res.status,
      ms: Date.now() - started,
      thrown: parsed ? null : `invalid-json:${text.slice(0, 120)}`,
      invoice: parsed?.result?.sale?.invoiceNumber ?? null,
      duplicate: parsed?.result?.duplicate ?? null,
      error: parsed?.error ? (parsed.error.details?.key ?? parsed.error.status ?? parsed.error.message ?? 'error') : null,
    };
  } catch (e) {
    return {
      index,
      saleId,
      http: 0,
      ms: Date.now() - started,
      thrown: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      invoice: null,
      duplicate: null,
      error: null,
    };
  }
}

describe('concurrent checkout', () => {
  it('concurrentCheckoutBurst never commits a sale the caller was told failed', async () => {
    await asAdmin(env, (fs) => updateDoc(doc(fs, tp(T, 'products', 'p1')), { stock: 50 }));
    const payloads = Array.from({ length: 50 }, () => cashSale({ cash: { receivedUsdCents: 500, receivedLbp: 0 } }, { quantity: 1 }));
    const toldFailed = (row: Omit<BurstRow, 'committed'>) => Boolean(row.thrown || row.error || !row.invoice);
    const first = await Promise.all(payloads.map((body, index) => checkoutBurst(tokens.cashier!, body, index, String(body.saleId))));
    const again = await Promise.all(
      first.filter(toldFailed).map((row) => checkoutBurst(tokens.cashier!, payloads[row.index]!, row.index, row.saleId)),
    );
    const bySale = new Map<string, { first: Omit<BurstRow, 'committed'>; retry?: Omit<BurstRow, 'committed'> }>();
    for (const row of first) bySale.set(row.saleId, { first: row });
    for (const row of again) bySale.get(row.saleId)!.retry = row;
    const snap = await settleUntil(async () => {
      return asAdmin(env, async (fs) => {
        const [salesSnap, productSnap, boxSnap, moves, cash] = await Promise.all([
          getDocs(collection(fs, tp(T, 'sales'))),
          getDoc(doc(fs, tp(T, 'products', 'p1'))),
          getDoc(doc(fs, tp(T, 'cashbox', 'summary'))),
          getDocs(query(collection(fs, tp(T, 'stockMovements')), where('type', '==', 'sale'))),
          getDocs(query(collection(fs, tp(T, 'cashTransactions')), where('type', '==', 'sale'))),
        ]);
        return {
          sales: salesSnap.docs.map((d) => [d.id, String(d.data().invoiceNumber ?? '')] as const),
          stock: Number(productSnap.data()?.stock),
          usd: Number(boxSnap.data()?.usdCents),
          moves: moves.size,
          moveRefs: moves.docs.map((d) => String(d.data().refId ?? '')),
          cash: cash.size,
        };
      });
    }, (value) => JSON.stringify(value));
    const committed = new Map(snap.sales);
    for (const [saleId, invoice] of committed) {
      const attempts = bySale.get(saleId);
      const acked = [attempts?.first, attempts?.retry].some((row) => row && !toldFailed(row) && row.invoice === invoice);
      if (!acked) {
        const recovered = await checkoutBurst(tokens.cashier!, payloads[first.find((row) => row.saleId === saleId)!.index]!, 0, saleId);
        if (attempts) attempts.retry = recovered;
      }
    }
    const resolved = [...bySale.entries()].map(([saleId, attempts]) => {
      const ok = [attempts.first, attempts.retry].filter((row) => row && !toldFailed(row));
      return { saleId, committed: committed.has(saleId), invoice: committed.get(saleId) ?? null, clientInvoice: ok[0]?.invoice ?? null, ok: ok.length > 0 };
    });
    const committedButFailed = resolved.filter((row) => row.committed && !row.ok);
    const succeededButMissing = resolved.filter((row) => row.ok && !row.committed);
    const mismatched = resolved.filter((row) => row.ok && row.committed && row.clientInvoice !== row.invoice);
    console.info(JSON.stringify({
      checkoutBurst: {
        requests: first.length,
        firstOk: first.filter((row) => !toldFailed(row)).length,
        retried: again.length,
        committed: committed.size,
        committedButFailed: committedButFailed.length,
        succeededButMissing: succeededButMissing.length,
        stock: snap.stock,
        usd: snap.usd,
      },
    }));
    expect(committedButFailed).toEqual([]);
    expect(succeededButMissing).toEqual([]);
    expect(mismatched).toEqual([]);
    expect(committed.size).toBeGreaterThan(0);
    expect(snap.stock).toBe(50 - committed.size);
    expect(snap.usd).toBe(10_000 + 500 * committed.size);
    expect(snap.moves).toBe(committed.size);
    expect(snap.cash).toBe(committed.size);
    expect(new Set(snap.moveRefs).size).toBe(committed.size);
  }, 180_000);
});