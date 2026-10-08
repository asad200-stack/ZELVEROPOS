import { describe, expect, it } from 'vitest';
import { computeCashPayment, computeCredit, debtLineSettlement, formatDocNumber, offlineDocNumber, planCashTender, type ChangeManual } from './checkout';

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

describe('dual-currency change', () => {
  const drawer = { drawerUsdCents: 100_000, drawerLbp: 5_000_000 };
  const due = { dueUsdCents: 100, dueLbp: 89_500, rate: RATE, ...drawer };

  it('returns USD change when the customer paid in USD', () => {
    const plan = planCashTender({ ...due, receivedUsdCents: 1_000, receivedLbp: 0, manual: null, manualUsdCents: 0, manualLbp: 0 });
    expect(plan).toMatchObject({ ok: true, changeUsdCents: 900, changeLbp: 0 });
  });

  it('switches the whole change to LBP when the cashier clears the USD return', () => {
    const plan = planCashTender({ ...due, receivedUsdCents: 1_000, receivedLbp: 0, manual: 'usd', manualUsdCents: 0, manualLbp: 0 });
    expect(plan).toMatchObject({ ok: true, changeUsdCents: 0, changeLbp: 805_500 });
  });

  it('fills the LBP remainder when the cashier keeps part of the change in USD', () => {
    const plan = planCashTender({ ...due, receivedUsdCents: 1_000, receivedLbp: 0, manual: 'usd', manualUsdCents: 500, manualLbp: 0 });
    expect(plan).toMatchObject({ ok: true, changeUsdCents: 500, changeLbp: 358_000 });
  });

  it('fills the USD remainder when the cashier types the LBP return', () => {
    const plan = planCashTender({ ...due, receivedUsdCents: 1_000, receivedLbp: 0, manual: 'lbp', manualUsdCents: 0, manualLbp: 179_000 });
    expect(plan).toMatchObject({ ok: true, changeUsdCents: 700, changeLbp: 179_000 });
  });

  it('starts from LBP when the customer paid in LBP, then splits on a USD edit', () => {
    const paid = planCashTender({ ...due, receivedUsdCents: 0, receivedLbp: 900_000, manual: null, manualUsdCents: 0, manualLbp: 0 });
    expect(paid).toMatchObject({ ok: true, changeUsdCents: 0, changeLbp: 810_500 });
    const split = planCashTender({ ...due, receivedUsdCents: 0, receivedLbp: 900_000, manual: 'usd', manualUsdCents: 500, manualLbp: 0 });
    expect(split).toMatchObject({ ok: true, changeUsdCents: 500, changeLbp: 363_000 });
  });

  it('returns USD change from the cash just received when the drawer is short', () => {
    const plan = planCashTender({
      ...due,
      drawerUsdCents: 0,
      drawerLbp: 0,
      receivedUsdCents: 1_000,
      receivedLbp: 0,
      manual: null,
      manualUsdCents: 0,
      manualLbp: 0,
    });
    expect(plan).toMatchObject({ ok: true, changeUsdCents: 900, changeLbp: 0, drawerShort: false, allUsdOk: true, allLbpOk: false });
  });

  it('warns when the typed split needs a currency the drawer and the tender do not have', () => {
    const plan = planCashTender({
      ...due,
      drawerUsdCents: 0,
      drawerLbp: 0,
      receivedUsdCents: 1_000,
      receivedLbp: 0,
      manual: 'lbp',
      manualUsdCents: 0,
      manualLbp: 805_500,
    });
    expect(plan).toMatchObject({ ok: false, error: 'drawer', drawerShort: true, changeLbp: 805_500 });
  });

  it('treats an empty tender as unpaid without calling it too much change', () => {
    const plan = planCashTender({ ...due, receivedUsdCents: 0, receivedLbp: 0, manual: null, manualUsdCents: 0, manualLbp: 0 });
    expect(plan.error).toBe('underpaid');
  });

  it('rejects change that is larger than the amount owed', () => {
    const plan = planCashTender({ ...due, receivedUsdCents: 1_000, receivedLbp: 0, manual: 'usd', manualUsdCents: 1_000, manualLbp: 0 });
    expect(plan).toMatchObject({ ok: false, error: 'exceeds', changeLbp: 0 });
  });
});

describe('remaining due and change at $6 / rate 89,500', () => {
  const due = { dueUsdCents: 600, dueLbp: 537_000, rate: RATE, drawerUsdCents: 100_000, drawerLbp: 5_000_000 };
  const base = { ...due, manual: null as ChangeManual, manualUsdCents: 0, manualLbp: 0 };

  it('shows the remaining balance when USD does not cover the total', () => {
    const plan = planCashTender({ ...base, receivedUsdCents: 500, receivedLbp: 0 });
    expect(plan).toMatchObject({ ok: false, error: 'underpaid', remainingUsdCents: 100, remainingLbp: 89_500, changeUsdCents: 0, changeLbp: 0 });
  });

  it('is paid exactly when the shortfall is covered in LBP', () => {
    const plan = planCashTender({ ...base, receivedUsdCents: 500, receivedLbp: 89_500 });
    expect(plan).toMatchObject({ ok: true, error: null, changeUsdCents: 0, changeLbp: 0 });
  });

  it('treats extra USD as change and can return it in either currency', () => {
    const plan = planCashTender({ ...base, receivedUsdCents: 1_000, receivedLbp: 0 });
    expect(plan).toMatchObject({ ok: true, changeUsdCents: 400, changeLbp: 0, allUsdCents: 400, allLbp: 358_000, allUsdOk: true, allLbpOk: true });
    const allLbp = planCashTender({ ...base, receivedUsdCents: 1_000, receivedLbp: 0, manual: 'lbp', manualLbp: plan.allLbp });
    expect(allLbp).toMatchObject({ ok: true, changeUsdCents: 0, changeLbp: 358_000 });
    const mixed = planCashTender({ ...base, receivedUsdCents: 1_000, receivedLbp: 0, manual: 'usd', manualUsdCents: 200 });
    expect(mixed).toMatchObject({ ok: true, changeUsdCents: 200, changeLbp: 179_000 });
  });

  it('refuses an all-LBP return the drawer cannot cover', () => {
    const plan = planCashTender({ ...base, drawerLbp: 100_000, receivedUsdCents: 1_000, receivedLbp: 0 });
    expect(plan.allLbpOk).toBe(false);
    const forced = planCashTender({ ...base, drawerLbp: 100_000, receivedUsdCents: 1_000, receivedLbp: 0, manual: 'lbp', manualLbp: 358_000 });
    expect(forced).toMatchObject({ ok: false, error: 'drawer' });
  });

  it('returns the $54 change in USD when a $555 payment arrives and the drawer is empty', () => {
    const plan = planCashTender({
      dueUsdCents: 50_100,
      dueLbp: 44_839_500,
      rate: RATE,
      drawerUsdCents: 0,
      drawerLbp: 0,
      receivedUsdCents: 55_500,
      receivedLbp: 0,
      manual: null,
      manualUsdCents: 0,
      manualLbp: 0,
    });
    expect(plan).toMatchObject({ ok: true, changeUsdCents: 5_400, changeLbp: 0, allUsdOk: true, allLbpOk: false });
    const lbpChange = planCashTender({
      dueUsdCents: 50_100,
      dueLbp: 44_839_500,
      rate: RATE,
      drawerUsdCents: 0,
      drawerLbp: 0,
      receivedUsdCents: 55_500,
      receivedLbp: 0,
      manual: 'lbp',
      manualUsdCents: 0,
      manualLbp: 3_040_000,
    });
    expect(lbpChange).toMatchObject({ ok: false, error: 'drawer', drawerShort: true });
  });

  it('suggests USD change when the payment itself covers it', () => {
    const plan = planCashTender({ ...base, drawerUsdCents: 0, drawerLbp: 0, receivedUsdCents: 1_000, receivedLbp: 0 });
    expect(plan).toMatchObject({ ok: true, changeUsdCents: 400, changeLbp: 0, allUsdOk: true, allLbpOk: false });
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
