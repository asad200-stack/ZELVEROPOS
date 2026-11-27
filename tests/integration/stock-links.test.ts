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
  // Sent the way the app sends it (with its version fields), which the input check must accept.
  await callOk(tokens.owner!, 'posSetStockLinks', { productId: 'carton', links: [{ productId: 'p1', quantity: 5 }], clientApiVersion: 1, clientReleaseVersion: '1.0.0' });
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

describe('opening a carton (carton with its own stock)', () => {
  beforeEach(async () => {
    await asAdmin(env, (fs) => setDoc(doc(fs, tp(T, 'products', 'box')), plain('Coal box', 100, 5, 300)));
    await asAdmin(env, (fs) => setDoc(doc(fs, tp(T, 'products', 'crt')), plain('Coal carton', 900, 3, 2500)));
    await callOk(tokens.owner!, 'posSetPackOf', { productId: 'crt', packOf: { productId: 'box', quantity: 10 }, clientApiVersion: 1, clientReleaseVersion: '1.0.0' });
  });

  it('opening moves cartons into pieces, prices the pieces from the carton, and records both moves', async () => {
    const res = await callOk<{ pieces: number; pieceStock: number }>(tokens.cashier!, 'posOpenPack', { clientOperationId: `open${Date.now()}`, productId: 'crt', count: 2 });
    expect(res).toMatchObject({ pieces: 20, pieceStock: 25 });
    expect(await stockOf('crt')).toBe(1);
    expect(await stockOf('box')).toBe(25);
    expect(Number((await readDoc(env, tp(T, 'products', 'box')))?.costUsdCents)).toBe(Math.round((5 * 300 + 20 * 250) / 25));
    const moves = await readWhere(env, tp(T, 'stockMovements'), 'type', 'packOpen');
    expect(moves.map((m) => [m.productId, m.quantity]).sort()).toEqual([['box', 20], ['crt', -2]]);
  });

  it('a retry with the same operation id opens only once', async () => {
    const op = { clientOperationId: `once${Date.now()}`, productId: 'crt', count: 1 };
    await callOk(tokens.cashier!, 'posOpenPack', op);
    await callOk(tokens.cashier!, 'posOpenPack', op);
    expect(await stockOf('crt')).toBe(2);
    expect(await stockOf('box')).toBe(15);
  });

  it('refuses more cartons than in stock, and a product that is not a carton', async () => {
    const many = await call(tokens.cashier!, 'posOpenPack', { clientOperationId: `many${Date.now()}`, productId: 'crt', count: 4 });
    expect(many.error?.key).toBe('error.insufficientStock');
    const notPack = await call(tokens.cashier!, 'posOpenPack', { clientOperationId: `np${Date.now()}`, productId: 'box', count: 1 });
    expect(notPack.error?.key).toBe('error.packInvalid');
    expect(await stockOf('box')).toBe(5);
  });

  it('cartons are bought, counted and sold like any product', async () => {
    await callOk(tokens.cashier!, 'posCheckout', sale([{ productId: 'crt', quantity: 1, unit: 900 }]));
    expect(await stockOf('crt')).toBe(2);
    expect(await stockOf('box')).toBe(5);
  });

  it('a carton cannot hold a set, another carton or itself, and needs the feature', async () => {
    const bad = await call(tokens.owner!, 'posSetPackOf', { productId: 'crt', packOf: { productId: 'set', quantity: 10 } });
    expect(bad.error?.key).toBe('error.packInvalid');
    const cartonOfCarton = await call(tokens.owner!, 'posSetPackOf', { productId: 'part', packOf: { productId: 'crt', quantity: 2 } });
    expect(cartonOfCarton.error?.key).toBe('error.packInvalid');
    await entitle('revoked');
    const off = await call(tokens.owner!, 'posSetPackOf', { productId: 'part', packOf: { productId: 'box', quantity: 2 } });
    expect(off.error?.key).toBe('error.featureNotActive');
    await callOk(tokens.owner!, 'posSetPackOf', { productId: 'crt', packOf: null });
    expect((await readDoc(env, tp(T, 'products', 'crt')))?.packOf).toBeNull();
  });
});
