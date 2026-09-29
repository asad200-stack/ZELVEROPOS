import { describe, expect, it } from 'vitest';
import { computeCashPayment, computeCredit, debtLineSettlement, formatDocNumber, offlineDocNumber } from './checkout';

const RATE = 89_500;

describe('cash payment (CATCH POS rule: shortfall completed in LBP, no overpay)', () => {
  const totals = { dueUsdCents: 1_000, dueLbp: 895_000 };

  it('pays fully in USD', () => {
    expect(computeCashPayment(totals, 'USD', RATE, { payCurrency: 'USD', amount: 1_000 })).toEqual({
      ok: true,
      receivedUsdCents: 1_000,
      receivedLbp: 0,
      remainderLbp: 0,
    });
  });

  it('completes a USD shortfall in LBP', () => {
    const r = computeCashPayment(totals, 'USD', RATE, { payCurrency: 'USD', amount: 600 });
    expect(r).toMatchObject({ ok: true, receivedUsdCents: 600, receivedLbp: 358_000 });
  });

  it('rejects overpayment and invalid amounts', () => {
    expect(computeCashPayment(totals, 'USD', RATE, { payCurrency: 'USD', amount: 1_001 })).toMatchObject({ ok: false, error: 'overpay' });
    expect(computeCashPayment(totals, 'USD', RATE, { payCurrency: 'LBP', amount: 900_000 })).toMatchObject({ ok: false, error: 'overpay' });
    expect(computeCashPayment(totals, 'USD', RATE, { payCurrency: 'USD', amount: -1 })).toMatchObject({ ok: false, error: 'invalidAmount' });
    expect(computeCashPayment({ dueUsdCents: 0, dueLbp: 0 }, 'USD', RATE, { payCurrency: 'USD', amount: 0 })).toMatchObject({
      ok: false,
      error: 'nothingDue',
    });
  });

  it('LBP payments always receive the full LBP due', () => {
    const r = computeCashPayment(totals, 'LBP', RATE, { payCurrency: 'LBP', amount: 500_000 });
    expect(r).toMatchObject({ ok: true, receivedUsdCents: 0, receivedLbp: 895_000, remainderLbp: 395_000 });
  });
});

describe('credit sale (CATCH POS formulas)', () => {
  const base = { productsUsdCents: 5_000, paidLbp: 0, rate: RATE, customerDebtUsdCents: 3_000, creditLimitUsdCents: 10_000 };

  it('adds the unpaid part to the debt', () => {
    const r = computeCredit({ ...base, paidUsdCents: 2_000, includePreviousDebt: false });
    expect(r).toMatchObject({ ok: true, remainingCurrentUsdCents: 3_000, newTotalDebtUsdCents: 6_000, debtToAddUsdCents: 3_000 });
  });

  it('enforces the credit limit only when debt grows', () => {
    expect(computeCredit({ ...base, creditLimitUsdCents: 5_000, paidUsdCents: 2_000, includePreviousDebt: false })).toMatchObject({
      ok: false,
      error: 'creditLimit',
    });
    const settling = computeCredit({ ...base, creditLimitUsdCents: 0, paidUsdCents: 6_000, includePreviousDebt: true });
    expect(settling).toMatchObject({ ok: true, settledFromPreviousUsdCents: 1_000, newTotalDebtUsdCents: 2_000, debtToAddUsdCents: 0 });
  });

  it('rejects paying more than the total due', () => {
    expect(computeCredit({ ...base, paidUsdCents: 9_000, includePreviousDebt: true })).toMatchObject({ ok: false, error: 'overpay' });
  });

  it('caps a previous-balance line at the current debt', () => {
    expect(debtLineSettlement(5_000, 3_000)).toBe(3_000);
    expect(debtLineSettlement(-5, 3_000)).toBe(0);
  });
});

describe('document numbers', () => {
  it('formats sequential and offline numbers', () => {
    expect(formatDocNumber('INV', 7)).toBe('INV-007');
    expect(formatDocNumber('PU', 1234)).toBe('PU-1234');
    expect(offlineDocNumber('INV', 'abcdef123')).toBe('INV-OFF-ABCDEF');
  });
});
