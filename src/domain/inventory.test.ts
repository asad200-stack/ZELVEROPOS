import { describe, expect, it } from 'vitest';
import { product } from './fixtures.test-utils';
import { isLowStock, stockValue, weightedAverageCost } from './inventory';

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

  it('values positive stock at cost', () => {
    expect(stockValue([product({ stock: 3, costUsdCents: 100 }), product({ stock: -2, costUsdCents: 100 })])).toBe(300);
  });
});
