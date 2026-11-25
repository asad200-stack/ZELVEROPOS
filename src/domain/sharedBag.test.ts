import { describe, expect, it } from 'vitest';
import { cleanSenderName, decodeBag, encodeBag, mergeSharedBag } from './sharedBag';

describe('sharedBag', () => {
  it('round-trips a bag with sizes', () => {
    const lines = [
      { productId: 'a1', qty: 2, size: 'M' },
      { productId: 'b_2', qty: 1, size: '' },
      { productId: 'c-3', qty: 1, size: '42 ½' },
    ];
    expect(decodeBag(encodeBag(lines))).toEqual(lines);
  });

  it('skips malformed parts and merges repeats', () => {
    expect(decodeBag('a:1,bad id:2,b:0,c:x,a:2:L,d:3')).toEqual([
      { productId: 'a', qty: 3, size: '' },
      { productId: 'd', qty: 3, size: '' },
    ]);
    expect(decodeBag(null)).toEqual([]);
    expect(decodeBag('a:1:%E0%A4%A')).toEqual([{ productId: 'a', qty: 1, size: '' }]);
  });

  it('keeps only a clean first name', () => {
    expect(cleanSenderName('  Rana  Haddad ')).toBe('Rana');
    expect(cleanSenderName('<b>x</b>')).toBe('bx/b');
    expect(cleanSenderName(null)).toBe('');
  });

  it('adds only products still for sale and keeps the friend’s sizes', () => {
    const r = mergeSharedBag(
      { a: 1 },
      { a: 'S' },
      [
        { productId: 'a', qty: 2, size: 'M' },
        { productId: 'b', qty: 1, size: 'L' },
        { productId: 'gone', qty: 1, size: '' },
      ],
      (id) => id !== 'gone',
    );
    expect(r).toEqual({ cart: { a: 3, b: 1 }, sizes: { a: 'S', b: 'L' }, added: 2 });
  });
});
