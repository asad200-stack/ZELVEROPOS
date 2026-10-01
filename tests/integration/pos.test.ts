import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  call,
  callOk,
  clearAuth,
  createEnv,
  createUser,
  DAY,
  OTHER,
  RATE,
  readDoc,
  readWhere,
  seedTenant,
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
  { uid: 'editor', role: 'subUser', permissions: { canViewProducts: true, canAddProducts: true, canEditProducts: true, canImportProducts: true } },
  { uid: 'buyer', role: 'subUser', permissions: { canViewSuppliers: true, canManageCashDrawer: true } },
  { uid: 'ghost', role: 'subUser', permissions: { canSell: true }, isActive: false },
  { uid: 'archivist', role: 'subUser', permissions: { canViewProducts: true, canDeleteProducts: true } },
];

async function seed(opts: { subscriptionEndsAt?: number } = {}) {
  await env.clearFirestore();
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
    const res = await callOk<{ saleReturn: Record<string, unknown> }>(tokens.clerk!, 'posReturn', {
      saleId: sale.saleId,
      lines: [{ index: 0, quantity: 1 }],
      reason: 'broken',
    });
    expect(res.saleReturn).toMatchObject({ amountUsdCents: 500, refundUsdCents: 500, number: 'RF-006' });
    expect(await stock()).toBe(9);
    expect((await drawer()).usdCents).toBe(10_500);
    const saved = await readDoc(env, tp(T, 'sales', sale.saleId));
    expect(saved).toMatchObject({ returnStatus: 'partial', returnedUsdCents: 500 });
    const tooMany = await call(tokens.clerk!, 'posReturn', { saleId: sale.saleId, lines: [{ index: 0, quantity: 2 }] });
    expect(tooMany.error?.key).toBe('error.return.tooMany');
  });

  it('cashiers without canViewSales cannot process returns', async () => {
    const sale = cashSale();
    await callOk(tokens.cashier!, 'posCheckout', sale);
    const { error } = await call(tokens.cashier!, 'posReturn', { saleId: sale.saleId, lines: [{ index: 0, quantity: 1 }] });
    expect(error?.status).toBe('PERMISSION_DENIED');
  });

  it('a credit-sale return reduces the debt before refunding cash', async () => {
    const sale = cashSale({ kind: 'credit', customerId: 'c1', cash: undefined, credit: { paidUsdCents: 0, paidLbp: 0 } });
    await callOk(tokens.cashier!, 'posCheckout', sale);
    const res = await callOk<{ saleReturn: Record<string, unknown> }>(tokens.clerk!, 'posReturn', {
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
    await callOk(tokens.clerk!, 'posReturn', { saleId: sale.saleId, lines: [{ index: 0, quantity: 1 }] });
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