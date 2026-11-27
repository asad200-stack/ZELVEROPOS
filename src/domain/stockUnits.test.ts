import { describe, expect, it } from 'vitest';
import type { Product } from '@/types/models';
import { emptyCartDraft, findStockShortages, priceCart, type Cart } from './cart';
import { product } from './fixtures.test-utils';
import { availableStock, linkedFrom, stockDemand, stockLinkIssues, stockProductIds, unitCost } from './stockUnits';

const coal = product({ id: 'coal', name: 'Coal box', stock: 35, costUsdCents: 300 });
const carton = product({ id: 'carton', name: 'Coal carton', stock: 0, costUsdCents: 0, stockLinks: [{ productId: 'coal', quantity: 10 }] });
const base = product({ id: 'base', name: 'Base', stock: 4, costUsdCents: 1000 });
const hose = product({ id: 'hose', name: 'Hose', stock: 9, costUsdCents: 200 });
const head = product({ id: 'head', name: 'Head', stock: 12, costUsdCents: 150 });
const hookah = product({
  id: 'set',
  name: 'Full hookah',
  stock: 0,
  costUsdCents: 0,
  stockLinks: [
    { productId: 'base', quantity: 1 },
    { productId: 'hose', quantity: 1 },
    { productId: 'head', quantity: 2 },
  ],
});
const all = (...extra: Product[]) => new Map([coal, carton, base, hose, head, hookah, ...extra].map((p) => [p.id, p]));

function cart(lines: { productId: string; quantity: number }[]): Cart {
  return {
    id: 'c',
    label: '',
    note: '',
    tier: 'retail',
    currency: 'USD',
    customerId: null,
    lines: lines.map((l, i) => ({ key: String(i), productId: l.productId, name: '', tier: 'retail', quantity: l.quantity, customUsdCents: null, imei: null })),
    debtLineUsdCents: null,
    checkoutDiscountUsdCents: 0,
    checkoutDiscountKind: null,
    saleId: 's',
    draft: emptyCartDraft(),
  };
}

describe('stock links: demand', () => {
  it('a carton deducts its pieces, a piece deducts itself', () => {
    const d = stockDemand([{ productId: 'carton', quantity: 2 }, { productId: 'coal', quantity: 3 }], all());
    expect(d.get('coal')).toBe(23);
    expect(d.has('carton')).toBe(false);
  });

  it('a set deducts every part and nothing from itself', () => {
    const d = stockDemand([{ productId: 'set', quantity: 2 }, { productId: 'head', quantity: 1 }], all());
    expect(d.get('base')).toBe(2);
    expect(d.get('hose')).toBe(2);
    expect(d.get('head')).toBe(5);
    expect(d.has('set')).toBe(false);
  });

  it('lists the linked products a checkout must read', () => {
    expect(stockProductIds(['set', 'coal'], all()).sort()).toEqual(['base', 'coal', 'head', 'hose', 'set']);
  });
});

describe('stock links: availability and cost', () => {
  it('counts whole cartons and whole sets from the scarcest part', () => {
    expect(availableStock(carton, all())).toBe(3);
    expect(availableStock(hookah, all())).toBe(4);
    expect(availableStock(hookah, all({ ...head, stock: 3 }))).toBe(1);
    expect(availableStock(hookah, all({ ...base, status: 'archived' }))).toBe(0);
    expect(availableStock(coal, all())).toBe(35);
  });

  it('costs a carton or set as its pieces', () => {
    expect(unitCost(carton, all())).toBe(3000);
    expect(unitCost(hookah, all())).toBe(1000 + 200 + 300);
    expect(unitCost(coal, all())).toBe(300);
  });

  it('prices a cart with the linked cost so profit is right', () => {
    const totals = priceCart(cart([{ productId: 'set', quantity: 1 }, { productId: 'carton', quantity: 1 }]), all(), 89_500);
    expect(totals.costUsdCents).toBe(1500 + 3000);
    expect(totals.lines[0]?.costUsdCents).toBe(1500);
  });
});

describe('stock links: shortages', () => {
  it('reports the short part, counting cartons and pieces together', () => {
    expect(findStockShortages(cart([{ productId: 'carton', quantity: 3 }, { productId: 'coal', quantity: 5 }]).lines, all())).toEqual([]);
    const short = findStockShortages(cart([{ productId: 'carton', quantity: 3 }, { productId: 'coal', quantity: 6 }]).lines, all());
    expect(short).toEqual([{ productId: 'coal', name: 'Coal box', requested: 36, available: 35 }]);
  });

  it('stops a set when one part runs out', () => {
    const short = findStockShortages(cart([{ productId: 'set', quantity: 5 }]).lines, all());
    expect(short.map((s) => s.productId)).toEqual(['base']);
  });

  it('leaves ordinary carts unchanged', () => {
    expect(findStockShortages(cart([{ productId: 'coal', quantity: 35 }]).lines, all())).toEqual([]);
    expect(findStockShortages(cart([{ productId: 'coal', quantity: 36 }]).lines, all())[0]?.available).toBe(35);
  });
});

describe('stock links: validation', () => {
  const self = { id: 'new', stock: 0, imeiTracking: false };
  it('accepts a carton, a set, and an empty list', () => {
    expect(stockLinkIssues(self, [{ productId: 'coal', quantity: 10 }], all())).toEqual([]);
    expect(stockLinkIssues(self, hookah.stockLinks ?? [], all())).toEqual([]);
    expect(stockLinkIssues({ ...self, stock: 5 }, [], all())).toEqual([]);
  });

  it('refuses nesting, self, duplicates, unknown, archived, serials, bad quantities and own stock', () => {
    const phone = product({ id: 'phone', imeiTracking: true });
    const old = product({ id: 'old', status: 'archived' });
    const issues = stockLinkIssues(
      { id: 'new', stock: 2, imeiTracking: false },
      [
        { productId: 'carton', quantity: 1 },
        { productId: 'new', quantity: 1 },
        { productId: 'base', quantity: 1 },
        { productId: 'base', quantity: 0 },
        { productId: 'ghost', quantity: 1 },
        { productId: 'old', quantity: 1 },
        { productId: 'phone', quantity: 1 },
      ],
      all(phone, old),
    );
    expect(issues.sort()).toEqual(['archived', 'duplicate', 'hasOwnStock', 'imei', 'nested', 'quantity', 'self', 'unknown']);
  });

  it('finds which products sell from a piece', () => {
    expect(linkedFrom('head', all().values())).toEqual(['set']);
    expect(linkedFrom('coal', all().values())).toEqual(['carton']);
    expect(linkedFrom('hose', [coal])).toEqual([]);
  });
});
