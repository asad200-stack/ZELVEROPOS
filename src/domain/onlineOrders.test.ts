import { describe, expect, it } from 'vitest';
import {
  ORDER_MAX_LINES,
  ORDER_MAX_QTY,
  ORDER_STATUSES,
  canReviewOrder,
  canTransition,
  formatOrderRef,
  isFinalStatus,
  isValidRating,
  mergeOrderLines,
  nextStatuses,
  normalizeOrderRef,
  orderProblem,
  publicReviewerName,
  restoresStock,
  summarizeRatings,
  toOnlineOrder,
  toProductReview,
  toReceipt,
} from './onlineOrders';

const okCustomer = { name: 'Rami', phone: '+961 70 123 456', address: 'Hamra street, Beirut' };

describe('order status machine', () => {
  it('follows the forward flow', () => {
    expect(canTransition('pending', 'accepted')).toBe(true);
    expect(canTransition('accepted', 'preparing')).toBe(true);
    expect(canTransition('preparing', 'ready')).toBe(true);
    expect(canTransition('ready', 'delivered')).toBe(true);
  });

  it('blocks skipping back or leaving a final state', () => {
    expect(canTransition('accepted', 'pending')).toBe(false);
    expect(canTransition('pending', 'delivered')).toBe(false);
    expect(canTransition('accepted', 'rejected')).toBe(false);
    for (const s of ['delivered', 'cancelled', 'rejected'] as const) {
      expect(isFinalStatus(s)).toBe(true);
      expect(nextStatuses(s)).toEqual([]);
      for (const to of ORDER_STATUSES) expect(canTransition(s, to)).toBe(false);
    }
  });

  it('gives stock back only on cancel or reject', () => {
    expect(restoresStock('pending', 'rejected')).toBe(true);
    expect(restoresStock('ready', 'cancelled')).toBe(true);
    expect(restoresStock('ready', 'delivered')).toBe(false);
    expect(restoresStock('cancelled', 'cancelled')).toBe(false);
    expect(restoresStock('delivered', 'cancelled')).toBe(false);
  });
});

describe('formatOrderRef', () => {
  it('pads to six digits', () => {
    expect(formatOrderRef(1)).toBe('ZV-000001');
    expect(formatOrderRef(123)).toBe('ZV-000123');
    expect(formatOrderRef(0)).toBe('ZV-000001');
  });
});

describe('mergeOrderLines', () => {
  it('sums duplicates and keeps first-seen order', () => {
    expect(
      mergeOrderLines([
        { productId: 'b', qty: 1 },
        { productId: 'a', qty: 2 },
        { productId: 'b', qty: 3 },
      ]),
    ).toEqual([
      { productId: 'b', qty: 4 },
      { productId: 'a', qty: 2 },
    ]);
  });
});

describe('orderProblem', () => {
  const line = [{ productId: 'p1', qty: 1 }];
  it('accepts a valid delivery and pickup order', () => {
    expect(orderProblem(line, okCustomer, 'delivery')).toBeNull();
    expect(orderProblem(line, { ...okCustomer, address: '' }, 'pickup')).toBeNull();
  });
  it('flags each problem', () => {
    expect(orderProblem([], okCustomer, 'pickup')).toBe('empty');
    const many = Array.from({ length: ORDER_MAX_LINES + 1 }, (_, i) => ({ productId: `p${i}`, qty: 1 }));
    expect(orderProblem(many, okCustomer, 'pickup')).toBe('tooManyLines');
    expect(orderProblem([{ productId: 'p1', qty: 0 }], okCustomer, 'pickup')).toBe('qty');
    expect(orderProblem([{ productId: 'p1', qty: 1.5 }], okCustomer, 'pickup')).toBe('qty');
    expect(orderProblem([{ productId: 'p1', qty: ORDER_MAX_QTY + 1 }], okCustomer, 'pickup')).toBe('qty');
    expect(orderProblem(line, { ...okCustomer, name: ' x ' }, 'pickup')).toBe('name');
    expect(orderProblem(line, { ...okCustomer, phone: 'call me' }, 'pickup')).toBe('phone');
    expect(orderProblem(line, { ...okCustomer, address: 'abc' }, 'delivery')).toBe('address');
    expect(orderProblem(line, { ...okCustomer, address: 'x'.repeat(301) }, 'pickup')).toBe('address');
  });
});

describe('toOnlineOrder / toReceipt', () => {
  it('reads a stored doc defensively and hides internals in the receipt', () => {
    const o = toOnlineOrder('o1', {
      ref: 'ZV-000007',
      status: 'weird',
      fulfillment: 'delivery',
      customerPhone: '+96170123456',
      lines: [{ productId: 'p1', name: 'Case', qty: 2, unitUsdCents: 500, unitLbp: 0, lineUsdCents: 1000, lineLbp: 0 }, null],
      totalUsdCents: 1000,
    });
    expect(o.status).toBe('pending');
    expect(o.lines).toHaveLength(2);
    expect(o.lines[1]!.qty).toBe(0);
    const r = toReceipt(o);
    expect(r).toEqual({
      ref: 'ZV-000007',
      status: 'pending',
      fulfillment: 'delivery',
      lines: [
        { name: 'Case', qty: 2, lineUsdCents: 1000, lineLbp: 0 },
        { name: '', qty: 0, lineUsdCents: 0, lineLbp: 0 },
      ],
      deliveryZone: '',
      deliveryFeeUsdCents: 0,
      totalUsdCents: 1000,
      totalLbp: 0,
    });
    expect(JSON.stringify(r)).not.toContain('+96170123456');
  });
});

describe('order references', () => {
  it('accepts loose customer input', () => {
    const ref = formatOrderRef(123);
    expect(normalizeOrderRef(ref)).toBe(ref);
    expect(normalizeOrderRef('zv 123')).toBe(ref);
    expect(normalizeOrderRef(' 123 ')).toBe(ref);
  });

  it('rejects junk', () => {
    expect(normalizeOrderRef('')).toBeNull();
    expect(normalizeOrderRef('0')).toBeNull();
    expect(normalizeOrderRef('abc')).toBeNull();
    expect(normalizeOrderRef('1234567890')).toBeNull();
  });
});

describe('reviews', () => {
  it('only delivered orders can be reviewed', () => {
    expect(canReviewOrder('delivered')).toBe(true);
    expect(canReviewOrder('pending')).toBe(false);
    expect(canReviewOrder('cancelled')).toBe(false);
  });

  it('validates ratings and summarizes them', () => {
    expect(isValidRating(0)).toBe(false);
    expect(isValidRating(6)).toBe(false);
    expect(isValidRating(4.5)).toBe(false);
    expect(summarizeRatings([])).toEqual({ count: 0, average: 0 });
    expect(summarizeRatings([5, 4, 4, 9])).toEqual({ count: 3, average: 4.3 });
  });

  it('publishes only a first name and initial', () => {
    expect(publicReviewerName('  Rami   Khoury ')).toBe('Rami K.');
    expect(publicReviewerName('Rami')).toBe('Rami');
    expect(publicReviewerName('   ')).toBe('');
  });

  it('reads stored reviews defensively', () => {
    const r = toProductReview('r1', { rating: 7, status: 'weird', text: 3 });
    expect(r).toMatchObject({ id: 'r1', rating: 0, status: 'pending', text: '' });
  });
});
