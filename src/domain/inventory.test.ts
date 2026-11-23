import { describe, expect, it } from 'vitest';
import { product } from './fixtures.test-utils';
import { isLowNotOut, isLowStock, lowStockAfterSale, lowStockScanBound, perItemLowStock, stockValue, weightedAverageCost } from './inventory';

describe('inventory', () => {
  it('computes the weighted average cost of added stock', () => {
    expect(weightedAverageCost(10, 200, 10, 300)).toBe(250);
    expect(weightedAverageCost(0, 200, 5, 300)).toBe(300);
    expect(weightedAverageCost(-2, 200, 5, 300)).toBe(300);
    expect(weightedAverageCost(10, 200, 0, 300)).toBe(200);
  });

  it('uses the product threshold before the store default', () => {
    expect(isLowStock(product({ stock: 5, minStock: null }), 10)).toBe(true);
    expect(isLowStock(product({ stock: 5, minStock: 2 }), 10)).toBe(false);
  });

  it('scans up to the larger of the store default and the largest per-product minimum', () => {
    expect(lowStockScanBound(10, null)).toBe(10);
    expect(lowStockScanBound(10, 25)).toBe(25);
    expect(lowStockScanBound(10, 3)).toBe(10);
    expect(lowStockScanBound(-1, null)).toBe(0);
  });

  it('keeps out-of-stock products out of the low list', () => {
    expect(isLowNotOut(product({ stock: 0, minStock: null }), 10)).toBe(false);
    expect(isLowNotOut(product({ stock: -1, minStock: 5 }), 10)).toBe(false);
    expect(isLowNotOut(product({ stock: 4, minStock: null }), 10)).toBe(true);
  });

  it('filters a scan by each product minimum', () => {
    const items = [
      product({ id: 'a', stock: 8, minStock: null }),
      product({ id: 'b', stock: 8, minStock: 5 }),
      product({ id: 'c', stock: 20, minStock: 25 }),
      product({ id: 'd', stock: 0, minStock: 25 }),
    ];
    expect(perItemLowStock(items, 10).map((p) => p.id)).toEqual(['a', 'c']);
  });

  it('values positive stock at cost', () => {
    expect(stockValue([product({ stock: 3, costUsdCents: 100 }), product({ stock: -2, costUsdCents: 100 })])).toBe(300);
  });
});

describe('low stock after a sale', () => {
  const p = (id: string, stock: number, minStock: number | null = null) => ({ id, stock, minStock });
  it('warns when the sale crossed the level or sold the last one', () => {
    const sold = new Map([
      ['a', 2],
      ['b', 1],
      ['c', 1],
      ['d', 1],
    ]);
    const after = [p('a', 9), p('b', 0, 2), p('c', 1, 2), p('d', 12)];
    // a: 11 -> 9 crosses 10. b: 1 -> 0 sold out. c: 2 -> 1 was already low. d: still above.
    expect(lowStockAfterSale(after, sold, 10).map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('ignores products that were not in the sale', () => {
    expect(lowStockAfterSale([p('x', 0)], new Map(), 10)).toEqual([]);
  });
});
