import { describe, expect, it } from 'vitest';
import { joinStockSales, rankProducts, type RankSale } from './productRank';

function sale(id: string, lines: RankSale['lines'], currency: RankSale['currency'] = 'USD', soldOn = '2026-10-26'): RankSale {
  return { id, soldOn, currency, lines };
}

describe('product rank', () => {
  it('nets returned quantities, ignores a repeated sale, and keeps an older line name', () => {
    const ranked = rankProducts([
      sale('s1', [
        { productId: 'p1', name: 'Demo phone', quantity: 5, returnedQty: 2, unitUsdCents: 1000, unitLbp: 90000 },
        { productId: 'p2', name: 'USB cable', quantity: 1, returnedQty: 1, unitUsdCents: 300, unitLbp: 0 },
      ]),
      sale('s1', [{ productId: 'p1', name: 'Demo phone', quantity: 9, returnedQty: 0, unitUsdCents: 1000, unitLbp: 0 }]),
      sale('s2', [{ productId: 'p1', name: 'Old phone', quantity: 1, returnedQty: 0, unitUsdCents: 1000, unitLbp: 0 }], 'USD', '2026-10-01'),
    ]);
    expect(ranked.saleCount).toBe(2);
    expect(ranked.rows).toHaveLength(1);
    expect(ranked.rows[0]).toMatchObject({
      name: 'Demo phone',
      aliases: ['Old phone'],
      netUnits: 4,
      netUsdCents: 4000,
      tied: false,
    });
    expect(ranked.currencies).toEqual(['USD']);
  });

  it('marks equal unit counts as ties and does not add LBP into the USD amount', () => {
    const ranked = rankProducts([
      sale('s1', [{ productId: 'p1', name: 'Demo phone', quantity: 2, returnedQty: 0, unitUsdCents: 100, unitLbp: 0 }]),
      sale('s2', [{ productId: 'p2', name: 'USB cable', quantity: 2, returnedQty: 0, unitUsdCents: 900, unitLbp: 0 }], 'LBP'),
    ]);
    expect(ranked.rows.map((row) => row.netUnits)).toEqual([2, 2]);
    expect(ranked.rows.every((row) => row.tied)).toBe(true);
    expect(ranked.rows.find((row) => row.productId === 'p1')?.netUsdCents).toBe(200);
    expect(ranked.rows.find((row) => row.productId === 'p2')?.netUsdCents).toBe(0);
    expect(ranked.currencies.sort()).toEqual(['LBP', 'USD']);
  });

  it('joins current stock to net units by product id and leaves archived or unknown ids out of that list', () => {
    const joined = joinStockSales(
      [
        { id: 'phone', name: 'Demo phone', stock: 2 },
        { id: 'charger', name: 'Last charger', stock: 1 },
        { id: 'cable-a', name: 'USB cable', stock: 3 },
        { id: 'cable-b', name: 'USB cable', stock: 1 },
      ],
      [
        sale('s1', [
          { productId: 'phone', name: 'Old phone', quantity: 4, returnedQty: 1, unitUsdCents: 100, unitLbp: 0 },
          { productId: 'cable-a', name: 'USB cable', quantity: 5, returnedQty: 0, unitUsdCents: 100, unitLbp: 0 },
          { productId: 'gone', name: 'Retired cable', quantity: 2, returnedQty: 0, unitUsdCents: 100, unitLbp: 0 },
          { productId: 'old', name: 'Archived case', quantity: 2, returnedQty: 0, unitUsdCents: 100, unitLbp: 0 },
          { productId: 'healthy', name: 'Phone case', quantity: 9, returnedQty: 0, unitUsdCents: 100, unitLbp: 0 },
        ]),
        sale('s1', [{ productId: 'phone', name: 'Demo phone', quantity: 9, returnedQty: 0, unitUsdCents: 100, unitLbp: 0 }]),
      ],
      [
        { id: 'old', status: 'archived' },
        { id: 'healthy', status: 'active' },
      ],
    );
    expect(joined.matched.map((row) => [row.id, row.stock, row.netUnits, row.invoiceName])).toEqual([
      ['cable-a', 3, 5, 'USB cable'],
      ['phone', 2, 3, 'Old phone'],
    ]);
    expect(joined.unsold).toBe(2);
    expect(joined.aside).toEqual([
      { id: 'old', name: 'Archived case', kind: 'archived' },
      { id: 'gone', name: 'Retired cable', kind: 'missing' },
    ]);
  });
});
