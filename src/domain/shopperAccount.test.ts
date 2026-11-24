import { describe, expect, it } from 'vitest';
import { cleanShopperProfile, cleanWishlist, mergeWishlists, orderAgainLines, prefillCheckout, SHOPPER_WISHLIST_MAX } from './shopperAccount';

describe('shopperAccount', () => {
  it('cleans a saved profile', () => {
    expect(cleanShopperProfile({ name: '  Rana ', phone: ' 70 123 456 ', address: 'Beirut', admin: true })).toEqual({
      name: 'Rana',
      phone: '70 123 456',
      address: 'Beirut',
    });
    expect(cleanShopperProfile(null)).toEqual({ name: '', phone: '', address: '' });
    expect(cleanShopperProfile({ name: 5 }).name).toBe('');
  });

  it('keeps wishlists unique, valid and capped', () => {
    expect(cleanWishlist(['a', 'b', 'a', 'bad id', 3])).toEqual(['a', 'b']);
    expect(cleanWishlist(Array.from({ length: 300 }, (_, i) => `p${i}`))).toHaveLength(SHOPPER_WISHLIST_MAX);
    expect(mergeWishlists(['x', 'y'], ['y', 'z'])).toEqual(['x', 'y', 'z']);
  });

  it('orders again only what is still available, merging repeated products', () => {
    const order = {
      lines: [
        { productId: 'a', name: 'A', qty: 1 },
        { productId: 'b', name: 'B', qty: 2 },
        { productId: 'a', name: 'A', qty: 2 },
      ],
    };
    expect(orderAgainLines(order, (id) => id === 'a')).toEqual([{ productId: 'a', qty: 3 }]);
    expect(orderAgainLines(order, () => false)).toEqual([]);
  });

  it('prefills only empty checkout fields', () => {
    const saved = { name: 'Rana', phone: '70123456', address: 'Beirut' };
    expect(prefillCheckout({ name: '', phone: '03 1', address: ' ' }, saved)).toEqual({ name: 'Rana', phone: '03 1', address: 'Beirut' });
  });
});
