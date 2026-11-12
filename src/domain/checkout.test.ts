import { describe, expect, it } from 'vitest';
import { autoFillCashTender, computeCashPayment, computeCredit, debtLineSettlement, formatDocNumber, offlineDocNumber, planCashTender, type ChangeManual } from './checkout';

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

  it('caps typed change so it never exceeds the overpay', () => {
    const plan = planCashTender({ ...due, receivedUsdCents: 1_000, receivedLbp: 0, manual: 'usd', manualUsdCents: 1_000, manualLbp: 0 });
    expect(plan.changeUsdCents + plan.changeLbp).toBeLessThanOrEqual(900 + 89_500);
    expect(plan.changeUsdCents).toBe(900);
    expect(plan.changeLbp).toBe(0);
    expect(plan.error).not.toBe('exceeds');
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

describe('credit sale (previous debt first, then current invoice)', () => {
  const base = { productsUsdCents: 5_000, paidLbp: 0, rate: RATE, customerDebtUsdCents: 3_000, creditLimitUsdCents: 10_000 };

  it('adds the unpaid part to the debt when previous is not collected', () => {
    const r = computeCredit({ ...base, paidUsdCents: 2_000, previousUsdCents: 0 });
    expect(r).toMatchObject({ ok: true, remainingCurrentUsdCents: 3_000, settledFromPreviousUsdCents: 0, newTotalDebtUsdCents: 6_000, debtToAddUsdCents: 3_000 });
  });

  it('A: add previous and pay sale + old debt in full', () => {
    const r = computeCredit({
      productsUsdCents: 10_000,
      paidUsdCents: 14_000,
      paidLbp: 0,
      rate: RATE,
      customerDebtUsdCents: 4_000,
      creditLimitUsdCents: 50_000,
      previousUsdCents: 4_000,
    });
    expect(r).toMatchObject({
      ok: true,
      settledFromPreviousUsdCents: 4_000,
      paidTowardCurrentUsdCents: 10_000,
      remainingCurrentUsdCents: 0,
      newTotalDebtUsdCents: 0,
    });
  });

  it('B: skip previous — sale paid, old debt remains', () => {
    const r = computeCredit({
      productsUsdCents: 10_000,
      paidUsdCents: 10_000,
      paidLbp: 0,
      rate: RATE,
      customerDebtUsdCents: 4_000,
      creditLimitUsdCents: 50_000,
      previousUsdCents: 0,
    });
    expect(r).toMatchObject({
      ok: true,
      settledFromPreviousUsdCents: 0,
      paidTowardCurrentUsdCents: 10_000,
      remainingCurrentUsdCents: 0,
      newTotalDebtUsdCents: 4_000,
    });
  });

  it('C: add previous, pay $60 — previous $40 first, then $20 on the sale', () => {
    const r = computeCredit({
      productsUsdCents: 10_000,
      paidUsdCents: 6_000,
      paidLbp: 0,
      rate: RATE,
      customerDebtUsdCents: 4_000,
      creditLimitUsdCents: 50_000,
      previousUsdCents: 4_000,
    });
    expect(r).toMatchObject({
      ok: true,
      settledFromPreviousUsdCents: 4_000,
      paidTowardCurrentUsdCents: 2_000,
      remainingCurrentUsdCents: 8_000,
      newTotalDebtUsdCents: 8_000,
    });
  });

  it('D: credit sale with previous — unpaid sale becomes new debt', () => {
    const r = computeCredit({
      productsUsdCents: 10_000,
      paidUsdCents: 0,
      paidLbp: 0,
      rate: RATE,
      customerDebtUsdCents: 4_000,
      creditLimitUsdCents: 50_000,
      previousUsdCents: 4_000,
    });
    expect(r).toMatchObject({
      ok: true,
      settledFromPreviousUsdCents: 0,
      remainingCurrentUsdCents: 10_000,
      newTotalDebtUsdCents: 14_000,
      debtToAddUsdCents: 10_000,
    });
  });

  it('E: credit limit cannot be bypassed when new sale debt is added', () => {
    expect(computeCredit({ ...base, creditLimitUsdCents: 5_000, paidUsdCents: 2_000, previousUsdCents: 0 })).toMatchObject({
      ok: false,
      error: 'creditLimit',
    });
    const settling = computeCredit({ ...base, creditLimitUsdCents: 0, paidUsdCents: 6_000, previousUsdCents: 3_000 });
    expect(settling).toMatchObject({ ok: true, settledFromPreviousUsdCents: 3_000, newTotalDebtUsdCents: 2_000, debtToAddUsdCents: 0 });
  });

  it('rejects paying more than the total due', () => {
    expect(computeCredit({ ...base, paidUsdCents: 9_000, previousUsdCents: 3_000 })).toMatchObject({ ok: false, error: 'overpay' });
  });

  it('A: previous-only collection is due without sale revenue', () => {
    const r = computeCredit({
      productsUsdCents: 0,
      paidUsdCents: 10_000,
      paidLbp: 0,
      rate: RATE,
      customerDebtUsdCents: 10_000,
      creditLimitUsdCents: 50_000,
      previousUsdCents: 10_000,
    });
    expect(r).toMatchObject({
      ok: true,
      totalDueUsdCents: 10_000,
      settledFromPreviousUsdCents: 10_000,
      paidTowardCurrentUsdCents: 0,
      remainingCurrentUsdCents: 0,
    });
  });

  it('caps a previous-balance line at the current debt', () => {
    expect(debtLineSettlement(5_000, 3_000)).toBe(3_000);
    expect(debtLineSettlement(-5, 3_000)).toBe(0);
    expect(computeCredit({ ...base, paidUsdCents: 8_000, previousUsdCents: 9_000 })).toMatchObject({
      ok: true,
      totalDueUsdCents: 8_000,
      settledFromPreviousUsdCents: 3_000,
    });
  });
});

describe('full-payment USD/LBP auto-fill', () => {
  const due = { dueUsdCents: 250_000, rate: RATE, usdManual: false, lbpManual: false, receivedUsd: '', receivedLbp: '' };

  it('A: USD 2000 fills remaining LBP at 89,500', () => {
    const r = autoFillCashTender({ ...due, receivedUsd: '2000', edited: 'usd' });
    expect(r.receivedUsd).toBe('2000');
    expect(r.receivedLbp).toBe('44,750,000');
    expect(r.usdManual).toBe(true);
    expect(r.lbpManual).toBe(false);
  });

  it('B: LBP 44,750,000 fills remaining USD 2,000.00', () => {
    const r = autoFillCashTender({ ...due, receivedLbp: '44,750,000', edited: 'lbp' });
    expect(r.receivedLbp).toBe('44,750,000');
    expect(r.receivedUsd).toBe('2,000.00');
  });

  it('C: USD over total does not auto-fill negative LBP', () => {
    const r = autoFillCashTender({ ...due, dueUsdCents: 50_000, receivedUsd: '600', edited: 'usd' });
    expect(r.receivedLbp).toBe('');
  });

  it('D: manual LBP override is kept when USD changes', () => {
    const r = autoFillCashTender({
      ...due,
      receivedUsd: '2,000.00',
      receivedLbp: '20,000,000',
      edited: 'usd',
      usdManual: true,
      lbpManual: true,
    });
    expect(r.receivedUsd).toBe('2,000.00');
    expect(r.receivedLbp).toBe('20,000,000');
  });

  it('F: previous debt is included in amount to collect', () => {
    const r = autoFillCashTender({ ...due, dueUsdCents: 60_000, receivedUsd: '500', edited: 'usd' });
    expect(r.receivedLbp).toBe('8,950,000');
  });

  it('H: clearing both fields drops stale auto-fill', () => {
    const r = autoFillCashTender({ ...due, receivedUsd: '', receivedLbp: '', edited: 'usd', usdManual: true, lbpManual: true });
    expect(r).toMatchObject({ receivedUsd: '', receivedLbp: '', usdManual: false, lbpManual: false });
  });

  it('I: the actively edited field is not rewritten', () => {
    const r = autoFillCashTender({ ...due, receivedUsd: '2,000', edited: 'usd' });
    expect(r.receivedUsd).toBe('2,000');
  });

  it('D/J: $2,400 of $2,600 due fills 17,900,000 LBP and is not treated as millions', () => {
    const r = autoFillCashTender({
      dueUsdCents: 260_000,
      rate: RATE,
      receivedUsd: '2400',
      receivedLbp: '',
      edited: 'usd',
      usdManual: false,
      lbpManual: false,
    });
    expect(r.receivedUsd).toBe('2400');
    expect(r.receivedLbp).toBe('17,900,000');
    const paid = planCashTender({
      dueUsdCents: 260_000,
      dueLbp: 232_700_000,
      rate: RATE,
      receivedUsdCents: 240_000,
      receivedLbp: 17_900_000,
      manual: null,
      manualUsdCents: 0,
      manualLbp: 0,
      drawerUsdCents: 1_000_000,
      drawerLbp: 50_000_000,
    });
    expect(paid).toMatchObject({ ok: true, error: null, changeUsdCents: 0, changeLbp: 0 });
  });

  it('E/F/G: $3,000 of $2,600 is $400 change; All USD / All LBP match that', () => {
    const base = {
      dueUsdCents: 260_000,
      dueLbp: 232_700_000,
      rate: RATE,
      receivedUsdCents: 300_000,
      receivedLbp: 0,
      manual: null as ChangeManual,
      manualUsdCents: 0,
      manualLbp: 0,
      drawerUsdCents: 1_000_000,
      drawerLbp: 50_000_000,
    };
    const plan = planCashTender(base);
    expect(plan).toMatchObject({ ok: true, changeUsdCents: 40_000, changeLbp: 0, allUsdCents: 40_000, allLbp: 35_800_000 });
    const allUsd = planCashTender({ ...base, manual: 'usd', manualUsdCents: plan.allUsdCents });
    expect(allUsd).toMatchObject({ ok: true, changeUsdCents: 40_000, changeLbp: 0 });
    const allLbp = planCashTender({ ...base, manual: 'lbp', manualLbp: plan.allLbp });
    expect(allLbp).toMatchObject({ ok: true, changeUsdCents: 0, changeLbp: 35_800_000 });
  });

  it('H: mixed change never exceeds the overpay', () => {
    const plan = planCashTender({
      dueUsdCents: 260_000,
      dueLbp: 232_700_000,
      rate: RATE,
      receivedUsdCents: 300_000,
      receivedLbp: 0,
      manual: 'usd',
      manualUsdCents: 500_000,
      manualLbp: 0,
      drawerUsdCents: 1_000_000,
      drawerLbp: 50_000_000,
    });
    expect(plan.changeUsdCents).toBe(40_000);
    expect(plan.changeLbp).toBe(0);
  });
});

describe('credit sale does not auto-cover remaining cash', () => {
  it('I: $2,600 credit with $2,400 received leaves $200 debt', () => {
    const r = computeCredit({
      productsUsdCents: 260_000,
      paidUsdCents: 240_000,
      paidLbp: 0,
      rate: RATE,
      customerDebtUsdCents: 0,
      creditLimitUsdCents: 1_000_000,
      previousUsdCents: 0,
    });
    expect(r).toMatchObject({ ok: true, remainingCurrentUsdCents: 20_000, newTotalDebtUsdCents: 20_000, paidTotalUsdCents: 240_000 });
  });
});

describe('document numbers', () => {
  it('formats sequential and offline numbers', () => {
    expect(formatDocNumber('INV', 7)).toBe('INV-007');
    expect(formatDocNumber('PU', 1234)).toBe('PU-1234');
    expect(offlineDocNumber('INV', 'abcdef123')).toBe('INV-OFF-ABCDEF');
  });
});
