import { describe, expect, it } from 'vitest';
import { emptyCartDraft, type Cart } from './cart';
import { addProductToCart, findStockShortages, findUnavailableImeis, priceCart } from './cart';
import { product } from './fixtures.test-utils';

const RATE = 100_000;

function emptyCart(over: Partial<Cart> = {}): Cart {
  return { id: 'c', label: '', note: '', tier: 'retail', currency: 'USD', customerId: null, lines: [], debtLineUsdCents: null, saleId: 'sale-1', draft: emptyCartDraft(), ...over };
}

describe('cart', () => {
  it('merges identical lines and keeps IMEI lines separate', () => {
    const p = product();
    let cart = addProductToCart(emptyCart(), p);
    cart = addProductToCart(cart, p, 2);
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0].quantity).toBe(3);

    const phone = product({ id: 'ph', imeiTracking: true, imeis: [{ imei: 'A', status: 'available' }] });
    cart = addProductToCart(cart, phone, 1, 'A');
    cart = addProductToCart(cart, phone, 1, 'A');
    expect(cart.lines).toHaveLength(2);
  });

  it('prices lines, discounts, cost and the previous-balance line', () => {
    const p = product();
    const products = new Map([[p.id, p]]);
    const cart = emptyCart({
      customerId: 'cust',
      debtLineUsdCents: 250,
      lines: [{ key: 'k', productId: 'p1', name: 'x', tier: 'retail', quantity: 2, customUsdCents: 450, imei: null }],
    });
    const totals = priceCart(cart, products, RATE);
    expect(totals.productsUsdCents).toBe(900);
    expect(totals.discountUsdCents).toBe(100);
    expect(totals.costUsdCents).toBe(400);
    expect(totals.dueUsdCents).toBe(1_150);
    expect(totals.dueLbp).toBe(900_000 + 250_000);
  });

  it('flags missing products instead of pricing them', () => {
    const totals = priceCart(
      emptyCart({ lines: [{ key: 'k', productId: 'gone', name: 'Old', tier: 'retail', quantity: 1, customUsdCents: null, imei: null }] }),
      new Map(),
      RATE,
    );
    expect(totals.lines[0].missing).toBe(true);
    expect(totals.productsUsdCents).toBe(0);
  });

  it('checks stock against the total demand per product', () => {
    const p = product({ stock: 3 });
    const products = new Map([[p.id, p]]);
    const shortages = findStockShortages(
      [
        { productId: 'p1', name: 'x', quantity: 2 },
        { productId: 'p1', name: 'x', quantity: 2 },
      ],
      products,
    );
    expect(shortages).toEqual([{ productId: 'p1', name: 'Phone case', requested: 4, available: 3 }]);
  });

  it('rejects sold or duplicated IMEIs', () => {
    const phone = product({ id: 'ph', imeis: [{ imei: 'A', status: 'available' }, { imei: 'B', status: 'sold' }] });
    const products = new Map([[phone.id, phone]]);
    const line = (imei: string) => ({ key: imei, productId: 'ph', name: 'p', tier: 'retail' as const, quantity: 1, customUsdCents: null, imei });
    expect(findUnavailableImeis([line('A'), line('B'), line('A')], products)).toEqual(['B', 'A']);
  });
});
