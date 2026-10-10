import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '@/constants/app';
import { load } from './usePosCarts';

const mem = new Map<string, string>();
beforeEach(() => {
  mem.clear();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => mem.set(k, v),
      removeItem: (k: string) => mem.delete(k),
      clear: () => mem.clear(),
    },
  });
});

describe('multi-cart persistence', () => {
  afterEach(() => {
    mem.clear();
  });

  it('keeps each cart’s label, note, customer, items, tender and change, and does not mix users', () => {
    const key = STORAGE_KEYS.cart('shop1', 'cashierA');
    localStorage.setItem(
      key,
      JSON.stringify({
        carts: [
          {
            id: '1',
            saleId: 's1',
            label: 'Johnny',
            note: 'later',
            tier: 'wholesale',
            currency: 'LBP',
            customerId: 'c1',
            debtLineUsdCents: 100,
            lines: [{ key: '0', productId: 'p1', name: 'Case', tier: 'wholesale', quantity: 2, customUsdCents: null, imei: null }],
            draft: { kind: 'cash', receivedUsd: '', receivedLbp: '1000000', changeUsd: '', changeLbp: '', changeManual: null, creditUsd: '', creditLbp: '' },
          },
          {
            id: '2',
            saleId: 's2',
            label: 'Walk-in',
            note: '',
            tier: 'retail',
            currency: 'USD',
            customerId: null,
            debtLineUsdCents: null,
            lines: [{ key: '0', productId: 'p2', name: 'Cable', tier: 'retail', quantity: 1, customUsdCents: 250, imei: null }],
            draft: { kind: 'cash', receivedUsd: '5', receivedLbp: '', changeUsd: '2.50', changeLbp: '', changeManual: 'usd', creditUsd: '', creditLbp: '' },
          },
        ],
        active: 1,
      }),
    );
    const a = load('shop1', 'cashierA', 'USD');
    expect(a.carts).toHaveLength(2);
    expect(a.active).toBe(1);
    expect(a.carts[0]).toMatchObject({ label: 'Johnny', note: 'later', customerId: 'c1', currency: 'LBP', tier: 'wholesale' });
    expect(a.carts[0]?.draft).toMatchObject({ receivedLbp: '1000000' });
    expect(a.carts[1]?.draft).toMatchObject({ receivedUsd: '5', changeUsd: '2.50' });
    expect(a.carts[1]).toMatchObject({ label: 'Walk-in', saleId: 's2' });
    expect(a.carts[1]?.lines[0]).toMatchObject({ productId: 'p2', quantity: 1, customUsdCents: 250 });

    expect(STORAGE_KEYS.cart('shop1', 'cashierA')).not.toBe(STORAGE_KEYS.cart('shop1', 'cashierB'));
    expect(mem.get(STORAGE_KEYS.cart('shop1', 'cashierB'))).toBeUndefined();
  });
});
