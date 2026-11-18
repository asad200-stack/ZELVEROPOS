import { describe, expect, it } from 'vitest';
import { sale } from './fixtures.test-utils';
import { planReturn, returnStatusAfter, splitRefund } from './returns';

describe('returns', () => {
  it('refunds a cash sale in the currencies it was paid with', () => {
    expect(splitRefund(500, 1_000, 0, 100_000)).toEqual({ refundUsdCents: 500, refundLbp: 0 });
    expect(splitRefund(500, 0, 1_000_000, 100_000)).toEqual({ refundUsdCents: 0, refundLbp: 500_000 });
    expect(splitRefund(500, 500, 500_000, 100_000)).toEqual({ refundUsdCents: 250, refundLbp: 250_000 });
  });

  it('plans a partial cash return', () => {
    const plan = planReturn(sale(), [{ index: 0, quantity: 1 }], 0);
    expect(plan).toMatchObject({ ok: true, amountUsdCents: 500, costUsdCents: 200, debtReducedUsdCents: 0, refundUsdCents: 500 });
    expect(returnStatusAfter(sale(), plan.quantities)).toBe('partial');
  });

  it('a full return on a discounted sale refunds only what was actually paid, not the pre-discount total', () => {
    // $10.00 line total, $1.00 checkout discount, so $9.00 was actually paid and received.
    const discounted = sale({
      totalUsdCents: 1_000,
      checkoutDiscountUsdCents: 100,
      checkoutDiscountLbp: 100_000,
      checkoutDiscountKind: 'fixed',
      payableUsdCents: 900,
      payableLbp: 900_000,
      payment: { ...sale().payment, receivedUsdCents: 900 },
    });
    const plan = planReturn(discounted, [{ index: 0, quantity: 2 }], 0);
    expect(plan).toMatchObject({ ok: true, amountUsdCents: 1_000, checkoutDiscountReversedUsdCents: 100, refundUsdCents: 900 });
  });

  it('a partial return reverses only its proportional share of the checkout discount', () => {
    const discounted = sale({
      totalUsdCents: 1_000,
      checkoutDiscountUsdCents: 100,
      checkoutDiscountKind: 'fixed',
      payableUsdCents: 900,
      payment: { ...sale().payment, receivedUsdCents: 900 },
    });
    // returning 1 of the 2 units: half the line value, half the discount share
    const plan = planReturn(discounted, [{ index: 0, quantity: 1 }], 0);
    expect(plan).toMatchObject({ ok: true, amountUsdCents: 500, checkoutDiscountReversedUsdCents: 50, refundUsdCents: 450 });
  });

  it('no checkout discount means no reversal, same as before this feature existed', () => {
    const plan = planReturn(sale(), [{ index: 0, quantity: 1 }], 0);
    expect(plan.checkoutDiscountReversedUsdCents).toBe(0);
  });

  it('reduces debt first on credit sales (no double refund)', () => {
    const credit = sale({
      kind: 'credit',
      customerId: 'c1',
      payment: { ...sale().payment, receivedUsdCents: 400, unpaidUsdCents: 600 },
    });
    const first = planReturn(credit, [{ index: 0, quantity: 1 }], 600);
    expect(first).toMatchObject({ ok: true, debtReducedUsdCents: 500, refundUsdCents: 0 });

    const afterFirst = sale({
      ...credit,
      returnedDebtUsdCents: 500,
      items: [{ ...credit.items[0], returnedQty: 1 }],
    });
    const second = planReturn(afterFirst, [{ index: 0, quantity: 1 }], 100);
    expect(second).toMatchObject({ ok: true, debtReducedUsdCents: 100, refundUsdCents: 400 });
    expect(returnStatusAfter(afterFirst, second.quantities)).toBe('full');
  });

  it('rejects returning more than was sold or nothing at all', () => {
    expect(planReturn(sale(), [{ index: 0, quantity: 3 }], 0)).toMatchObject({ ok: false, error: 'tooMany' });
    expect(planReturn(sale(), [{ index: 0, quantity: 0 }], 0)).toMatchObject({ ok: false, error: 'empty' });
    expect(planReturn(sale(), [{ index: 5, quantity: 1 }], 0)).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('aggregates duplicate indexes within the remaining quantity', () => {
    const plan = planReturn(sale(), [{ index: 0, quantity: 1 }, { index: 0, quantity: 1 }], 0);
    expect(plan).toMatchObject({ ok: true, amountUsdCents: 1_000, costUsdCents: 400, refundUsdCents: 1_000 });
    expect(plan.quantities.get(0)).toBe(2);
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]?.quantity).toBe(2);
    expect(returnStatusAfter(sale(), plan.quantities)).toBe('full');
  });

  it('rejects duplicate indexes that exceed the remaining quantity', () => {
    expect(
      planReturn(sale(), [{ index: 0, quantity: 2 }, { index: 0, quantity: 2 }], 0),
    ).toMatchObject({ ok: false, error: 'tooMany' });
    const partiallyReturned = sale({ items: [{ ...sale().items[0], returnedQty: 1 }] });
    expect(
      planReturn(partiallyReturned, [{ index: 0, quantity: 1 }, { index: 0, quantity: 1 }], 0),
    ).toMatchObject({ ok: false, error: 'tooMany' });
  });
});
