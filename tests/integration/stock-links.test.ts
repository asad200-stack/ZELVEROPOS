import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asAdmin, call, callOk, clearAuth, clearFirestore, createEnv, createUser, OTHER, RATE, readDoc, readWhere, seedTenant, T, tp } from './helpers';

// Cartons and sets (Feature Center: stock_links). Seeded catalog (helpers.seedTenant):
// p1 "Phone case" stock 10, cost 200. Added here: carton = p1 × 5, set = p1 × 1 + part × 2.
let env: RulesTestEnvironment;
const tokens: Record<string, string> = {};

const plain = (name: string, retail: number, stock: number, cost = 200) => ({
  name,
  nameNormalized: name.toLowerCase(),
  status: 'active',
  category: '',
  barcode: '',
  prices: { retail: { usdCents: retail, lbp: null }, wholesale: { usdCents: 0, lbp: null }, vip: { usdCents: 0, lbp: null } },
  costUsdCents: cost,
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
  createdAtMs: Date.now(),
  createdBy: T,
});

async function entitle(status: 'active' | 'revoked') {
  await asAdmin(env, (fs) => setDoc(doc(fs, `platformFeatureEntitlements/${T}__stock_links`), { tenantId: T, featureId: 'stock_links', status }));
}

beforeAll(async () => {
  env = await createEnv();
  await clearAuth();
  tokens.owner = await createUser({ uid: T, tenantId: T, role: 'owner' });
  tokens.cashier = await createUser({ uid: 'cashier', tenantId: T, role: 'subUser', perms: { canSell: true, canViewSales: true, canManageCashDrawer: true } });
});
afterAll(async () => {
  await env?.cleanup();
});
beforeEach(async () => {
  await clearFirestore(env);
  await seedTenant(env, T, [{ uid: T, role: 'owner' }, { uid: 'cashier', role: 'subUser', permissions: { canSell: true, canViewSales: true, canManageCashDrawer: true } }]);
  await seedTenant(env, OTHER, [{ uid: OTHER, role: 'owner' }]);
  await asAdmin(env, async (fs) => {
    await setDoc(doc(fs, tp(T, 'products', 'carton')), plain('Case carton', 2_000, 0, 0));
    await setDoc(doc(fs, tp(T, 'products', 'set')), plain('Case set', 1_500, 0, 0));
    await setDoc(doc(fs, tp(T, 'products', 'part')), plain('Part', 300, 6, 100));
  });
  await entitle('active');
  await callOk(tokens.owner!, 'posSetStockLinks', { productId: 'carton', links: [{ productId: 'p1', quantity: 5 }] });
  await callOk(tokens.owner!, 'posSetStockLinks', { productId: 'set', links: [{ productId: 'p1', quantity: 1 }, { productId: 'part', quantity: 2 }] });
});

let seq = 0;
function sale(lines: { productId: string; quantity: number; unit: number }[]) {
  seq += 1;
  const total = lines.reduce((s, l) => s + l.unit * l.quantity, 0);
  return {
    saleId: `links${Date.now()}${seq}`,
    kind: 'cash',
    currency: 'USD',
    rate: RATE,
    customerId: null,
    debtLineUsdCents: null,
    lines: lines.map((l) => ({ productId: l.productId, tier: 'retail', quantity: l.quantity, customUsdCents: null, imei: null })),
    expectedTotalUsdCents: total,
    cash: { receivedUsdCents: total, receivedLbp: 0 },
  };
}
const stockOf = async (id: string) => Number((await readDoc(env, tp(T, 'products', id)))?.stock);

describe('posSetStockLinks', () => {
  it('stores the links and refuses nesting, own stock and a store without the feature', async () => {
    expect((await readDoc(env, tp(T, 'products', 'carton')))?.stockLinks).toEqual([{ productId: 'p1', quantity: 5 }]);
    const nested = await call(tokens.owner!, 'posSetStockLinks', { productId: 'part', links: [{ productId: 'carton', quantity: 1 }] });
    expect(nested.error?.key).toBe('error.linkedInvalid');
    const target = await call(tokens.owner!, 'posSetStockLinks', { productId: 'p1', links: [{ productId: 'part', quantity: 1 }] });
    expect(target.error?.key).toBe('error.linkedInvalid');
    await entitle('revoked');
    const off = await call(tokens.owner!, 'posSetStockLinks', { productId: 'part', links: [{ productId: 'p1', quantity: 1 }] });
    expect(off.error?.key).toBe('error.featureNotActive');
    // Turning links off stays allowed without the feature.
    await callOk(tokens.owner!, 'posSetStockLinks', { productId: 'carton', links: [] });
    expect((await readDoc(env, tp(T, 'products', 'carton')))?.stockLinks).toBeNull();
  });

  it('cannot be called by a cashier or written directly by a client', async () => {
    const res = await call(tokens.cashier!, 'posSetStockLinks', { productId: 'carton', links: [{ productId: 'p1', quantity: 2 }] });
    expect(res.error?.status).toBe('PERMISSION_DENIED');
  });
});

describe('selling cartons and sets', () => {
  it('a carton deducts its pieces and costs what they cost', async () => {
    const res = await callOk<{ sale: { costUsdCents: number; items: { stockLinks?: unknown }[] } }>(
      tokens.cashier!,
      'posCheckout',
      sale([{ productId: 'carton', quantity: 1, unit: 2_000 }, { productId: 'p1', quantity: 2, unit: 500 }]),
    );
    expect(await stockOf('p1')).toBe(3);
    expect(await stockOf('carton')).toBe(0);
    expect(res.sale.costUsdCents).toBe(5 * 200 + 2 * 200);
    expect(res.sale.items[0]?.stockLinks).toEqual([{ productId: 'p1', quantity: 5 }]);
    expect(await readWhere(env, tp(T, 'stockMovements'), 'productId', 'p1')).toHaveLength(1);
  });

  it('counts cartons and pieces together and refuses a shortage', async () => {
    const { error } = await call(tokens.cashier!, 'posCheckout', sale([{ productId: 'carton', quantity: 2 }, { productId: 'p1', quantity: 1 }].map((l) => ({ ...l, unit: l.productId === 'carton' ? 2_000 : 500 }))));
    expect(error?.key).toBe('error.insufficientStock');
    expect(await stockOf('p1')).toBe(10);
  });

  it('a set deducts every part; a return puts the same parts back', async () => {
    const s = sale([{ productId: 'set', quantity: 3, unit: 1_500 }]);
    await callOk(tokens.cashier!, 'posCheckout', s);
    expect(await stockOf('p1')).toBe(7);
    expect(await stockOf('part')).toBe(0);
    // Links edited after the sale must not change what the return restocks.
    await callOk(tokens.owner!, 'posSetStockLinks', { productId: 'set', links: [{ productId: 'part', quantity: 1 }] });
    await callOk(tokens.cashier!, 'posReturn', { saleId: s.saleId, lines: [{ index: 0, quantity: 1 }] });
    expect(await stockOf('p1')).toBe(8);
    expect(await stockOf('part')).toBe(2);
    expect(await stockOf('set')).toBe(0);
  });

  it('refuses a set whose part was archived', async () => {
    await asAdmin(env, (fs) => setDoc(doc(fs, tp(T, 'products', 'part')), { ...plain('Part', 300, 6, 100), status: 'archived' }));
    const { error } = await call(tokens.cashier!, 'posCheckout', sale([{ productId: 'set', quantity: 1, unit: 1_500 }]));
    expect(error?.key).toBe('error.productArchived');
  });

  it('refuses stock counts and purchases on a carton', async () => {
    const adjust = { productId: 'carton', mode: 'add', quantity: 5, unitCostUsdCents: null, payFromCashbox: false, imeisToAdd: [], imeisToRemove: [], note: '' };
    const { error } = await call(tokens.owner!, 'posAdjustStock', adjust);
    expect(error?.key).toBe('error.linkedNoStock');
    expect(await stockOf('carton')).toBe(0);
  });
});
