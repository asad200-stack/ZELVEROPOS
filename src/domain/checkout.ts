import type { Currency } from '@/types/models';
import type { CartTotals } from './cart';
import {
  formatLbpAmountInput,
  formatUsdCentsInput,
  lbpCentTolerance,
  lbpToUsdCents,
  parseLbpInput,
  parseUsdInput,
  usdCentsToLbp,
  type Cents,
} from './money';

function isZeroUsdInput(raw: string): boolean {
  if (!raw.trim()) return true;
  const cents = parseUsdInput(raw);
  return cents === 0;
}

function isZeroLbpInput(raw: string): boolean {
  if (!raw.trim()) return true;
  const pounds = parseLbpInput(raw);
  return pounds === 0;
}

/* ------------------------------------------------------------------ cash */

export interface CashPaymentInput {
  payCurrency: Currency;
  /** Amount typed by the cashier in `payCurrency` (cents for USD, pounds for LBP). */
  amount: number;
}

export type CashPaymentError = 'nothingDue' | 'invalidAmount' | 'overpay';

export type CashPaymentResult =
  | { ok: true; receivedUsdCents: Cents; receivedLbp: number; remainderLbp: number }
  | { ok: false; error: CashPaymentError; remainderLbp: number };

/**
 * CATCH POS cash rule: the cashier enters the amount paid in the chosen currency; any shortfall is
 * automatically completed in LBP (shortfall × rate). Overpayment is rejected (no change is given).
 */
export function computeCashPayment(
  totals: Pick<CartTotals, 'dueUsdCents' | 'dueLbp'>,
  cartCurrency: Currency,
  rate: number,
  input: CashPaymentInput,
): CashPaymentResult {
  const amount = Math.round(Number(input.amount));
  if (totals.dueUsdCents <= 0 && totals.dueLbp <= 0) return { ok: false, error: 'nothingDue', remainderLbp: 0 };
  if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: 'invalidAmount', remainderLbp: 0 };

  const tolerance = lbpCentTolerance(rate);

  if (input.payCurrency === 'USD') {
    const dueUsd = cartCurrency === 'USD' ? totals.dueUsdCents : lbpToUsdCents(totals.dueLbp, rate);
    if (amount > dueUsd) return { ok: false, error: 'overpay', remainderLbp: 0 };
    let remainderLbp =
      cartCurrency === 'USD'
        ? usdCentsToLbp(dueUsd - amount, rate)
        : Math.max(0, totals.dueLbp - usdCentsToLbp(amount, rate));
    if (remainderLbp < tolerance && amount === dueUsd) remainderLbp = 0;
    return { ok: true, receivedUsdCents: amount, receivedLbp: remainderLbp, remainderLbp };
  }

  const dueLbp = cartCurrency === 'LBP' ? totals.dueLbp : usdCentsToLbp(totals.dueUsdCents, rate);
  if (amount > dueLbp) return { ok: false, error: 'overpay', remainderLbp: 0 };
  const remainderLbp = dueLbp - amount;
  return { ok: true, receivedUsdCents: 0, receivedLbp: dueLbp, remainderLbp };
}

export type ChangeManual = 'usd' | 'lbp' | null;

/**
 * Full-payment mixed tender: the last-edited currency keeps the cashier's typing;
 * the other field is filled with the remaining due. Manual override of that other
 * field (usdManual/lbpManual) stops auto-fill so mixed payments are not fought.
 * Credit sales must not call this.
 */
export function autoFillCashTender(input: {
  dueUsdCents: Cents;
  rate: number;
  receivedUsd: string;
  receivedLbp: string;
  edited: 'usd' | 'lbp';
  usdManual: boolean;
  lbpManual: boolean;
}): { receivedUsd: string; receivedLbp: string; usdManual: boolean; lbpManual: boolean } {
  const due = Math.max(0, Math.round(input.dueUsdCents) || 0);
  const rate = input.rate;
  let receivedUsd = input.receivedUsd;
  let receivedLbp = input.receivedLbp;
  let usdManual = input.usdManual;
  let lbpManual = input.lbpManual;
  const usdEmpty = isZeroUsdInput(receivedUsd);
  const lbpEmpty = isZeroLbpInput(receivedLbp);

  if (usdEmpty && lbpEmpty) {
    return { receivedUsd: '', receivedLbp: '', usdManual: false, lbpManual: false };
  }

  if (input.edited === 'usd') {
    if (usdEmpty) {
      usdManual = false;
      if (!lbpManual) receivedLbp = due > 0 ? formatLbpAmountInput(usdCentsToLbp(due, rate)) : '';
      return { receivedUsd, receivedLbp, usdManual, lbpManual };
    }
    usdManual = true;
    const cents = parseUsdInput(receivedUsd);
    if (cents === null) return { receivedUsd, receivedLbp, usdManual, lbpManual };
    if (!lbpManual) receivedLbp = cents >= due ? '' : formatLbpAmountInput(usdCentsToLbp(due - cents, rate));
    return { receivedUsd, receivedLbp, usdManual, lbpManual };
  }

  if (lbpEmpty) {
    lbpManual = false;
    if (!usdManual) receivedUsd = due > 0 ? formatUsdCentsInput(due) : '';
    return { receivedUsd, receivedLbp, usdManual, lbpManual };
  }
  lbpManual = true;
  const pounds = parseLbpInput(receivedLbp);
  if (pounds === null) return { receivedUsd, receivedLbp, usdManual, lbpManual };
  if (!usdManual) {
    const asUsd = lbpToUsdCents(pounds, rate);
    receivedUsd = asUsd >= due ? '' : formatUsdCentsInput(due - asUsd);
  }
  return { receivedUsd, receivedLbp, usdManual, lbpManual };
}

export type CashTenderError = 'invalidAmount' | 'nothingDue' | 'underpaid' | 'remaining' | 'exceeds' | 'drawer';

export interface CashTenderPlan {
  ok: boolean;
  error: CashTenderError | null;
  receivedUsdCents: Cents;
  receivedLbp: number;
  changeUsdCents: Cents;
  changeLbp: number;
  /** Change still owed to the customer. Zero when the two return fields cover the tender. */
  remainingUsdCents: Cents;
  remainingLbp: number;
  drawerShort: boolean;
  /** Giving back the whole change in one currency. Disabled when the drawer cannot cover it. */
  allUsdCents: Cents;
  allLbp: number;
  allUsdOk: boolean;
  allLbpOk: boolean;
}

/**
 * Dual-currency cash. The cashier records the physical bills received and the physical change
 * returned. The two return fields are one change value: editing one calculates the other.
 * Change is paid from the drawer that existed before this sale, so a large bill just received
 * cannot be broken unless the drawer already holds the notes being handed back.
 */
export function planCashTender(input: {
  dueUsdCents: Cents;
  dueLbp: number;
  rate: number;
  receivedUsdCents: Cents;
  receivedLbp: number;
  manual: ChangeManual;
  manualUsdCents: Cents;
  manualLbp: number;
  drawerUsdCents: Cents;
  drawerLbp: number;
}): CashTenderPlan {
  const receivedUsd = whole(input.receivedUsdCents);
  const receivedLbp = whole(input.receivedLbp);
  const drawerUsd = Math.max(0, whole(input.drawerUsdCents) ?? 0);
  const drawerLbp = Math.max(0, whole(input.drawerLbp) ?? 0);
  const blank: CashTenderPlan = {
    ok: false,
    error: 'invalidAmount',
    receivedUsdCents: 0,
    receivedLbp: 0,
    changeUsdCents: 0,
    changeLbp: 0,
    remainingUsdCents: 0,
    remainingLbp: 0,
    drawerShort: false,
    allUsdCents: 0,
    allLbp: 0,
    allUsdOk: false,
    allLbpOk: false,
  };
  if (receivedUsd === null || receivedLbp === null) return blank;
  if (input.dueUsdCents <= 0 && input.dueLbp <= 0) return { ...blank, error: 'nothingDue' };

  const dueUsd = input.dueUsdCents;
  const dueLbp = input.dueLbp;
  const rate = input.rate;
  const lbpFor = (changeUsd: number) => receivedLbp - dueLbp + usdCentsToLbp(receivedUsd - changeUsd, rate);
  const usdFor = (changeLbp: number) => receivedUsd - lbpToUsdCents(changeLbp + dueLbp - receivedLbp, rate);

  const allUsdCents = Math.max(0, usdFor(0));
  const allLbp = Math.max(0, lbpFor(0));
  // Change can be handed back from the notes already in the drawer plus the cash just received, per currency.
  const availableUsd = drawerUsd + receivedUsd;
  const availableLbp = drawerLbp + receivedLbp;
  const quick = {
    allUsdCents,
    allLbp,
    allUsdOk: allUsdCents <= availableUsd && Math.max(0, lbpFor(allUsdCents)) <= availableLbp,
    allLbpOk: allLbp <= availableLbp && Math.max(0, usdFor(allLbp)) <= availableUsd,
  };

  const receivedValue = receivedUsd + lbpToUsdCents(receivedLbp, rate);
  if (receivedValue + 1 < dueUsd) {
    const short = dueUsd - receivedValue;
    return {
      ...blank,
      error: 'underpaid',
      receivedUsdCents: receivedUsd,
      receivedLbp,
      remainingUsdCents: short,
      remainingLbp: usdCentsToLbp(short, rate),
      ...quick,
    };
  }

  let changeUsd: number;
  let changeLbp: number;
  if (input.manual === 'usd') {
    const typed = whole(input.manualUsdCents);
    if (typed === null) return blank;
    changeUsd = typed;
    changeLbp = Math.max(0, lbpFor(changeUsd));
  } else if (input.manual === 'lbp') {
    const typed = whole(input.manualLbp);
    if (typed === null) return blank;
    changeLbp = typed;
    changeUsd = Math.max(0, usdFor(changeLbp));
  } else {
    const preferUsd = receivedUsd > 0 && (receivedLbp === 0 || receivedUsd >= lbpToUsdCents(receivedLbp, rate));
    if (preferUsd) {
      changeUsd = Math.min(Math.max(0, usdFor(0)), availableUsd);
      changeLbp = Math.max(0, lbpFor(changeUsd));
      if (changeLbp > availableLbp) {
        changeLbp = availableLbp;
        changeUsd = Math.min(Math.max(0, usdFor(changeLbp)), availableUsd);
      }
    } else {
      changeLbp = Math.min(Math.max(0, lbpFor(0)), availableLbp);
      changeUsd = Math.max(0, usdFor(changeLbp));
      if (changeUsd > availableUsd) {
        changeUsd = availableUsd;
        changeLbp = Math.min(Math.max(0, lbpFor(changeUsd)), availableLbp);
      }
    }
  }

  const overpayCents = receivedValue - dueUsd;
  const given = changeUsd + lbpToUsdCents(changeLbp, rate);
  if (given > overpayCents + 1) {
    if (input.manual === 'usd') {
      changeUsd = Math.min(Math.max(0, changeUsd), Math.max(0, overpayCents));
      changeLbp = Math.max(0, usdCentsToLbp(overpayCents - changeUsd, rate));
    } else if (input.manual === 'lbp') {
      const maxLbp = Math.max(0, usdCentsToLbp(overpayCents, rate));
      changeLbp = Math.min(Math.max(0, changeLbp), maxLbp);
      changeUsd = Math.max(0, overpayCents - lbpToUsdCents(changeLbp, rate));
    } else if (receivedUsd > 0 && (receivedLbp === 0 || receivedUsd >= lbpToUsdCents(receivedLbp, rate))) {
      changeUsd = Math.min(Math.max(0, overpayCents), availableUsd);
      changeLbp = Math.max(0, usdCentsToLbp(overpayCents - changeUsd, rate));
    } else {
      changeLbp = Math.min(Math.max(0, usdCentsToLbp(overpayCents, rate)), availableLbp);
      changeUsd = Math.max(0, overpayCents - lbpToUsdCents(changeLbp, rate));
    }
    if (changeUsd + lbpToUsdCents(changeLbp, rate) > overpayCents + 1) {
      changeUsd = Math.min(Math.max(0, overpayCents), availableUsd);
      changeLbp = 0;
    }
  }

  const remainingCents = receivedValue - dueUsd - (changeUsd + lbpToUsdCents(changeLbp, rate));
  const drawerShort = changeUsd > availableUsd || changeLbp > availableLbp;
  let error: CashTenderError | null = null;
  if (remainingCents < -1) error = 'exceeds';
  else if (remainingCents > 1) error = 'remaining';
  else if (drawerShort) error = 'drawer';
  const remaining = Math.max(0, remainingCents);

  return {
    ok: error === null,
    error,
    receivedUsdCents: receivedUsd,
    receivedLbp,
    changeUsdCents: changeUsd,
    changeLbp,
    remainingUsdCents: remaining,
    remainingLbp: remaining > 0 ? usdCentsToLbp(remaining, rate) : 0,
    drawerShort,
    ...quick,
  };
}

/** Net drawer movement (physical in minus physical change) covers the amount due. */
export function cashNetCoversDue(
  currency: Currency,
  rate: number,
  dueUsdCents: Cents,
  dueLbp: number,
  netUsdCents: Cents,
  netLbp: number,
): boolean {
  return currency === 'USD'
    ? Math.abs(netUsdCents + lbpToUsdCents(netLbp, rate) - dueUsdCents) <= 1
    : Math.abs(usdCentsToLbp(netUsdCents, rate) + netLbp - dueLbp) <= lbpCentTolerance(rate);
}

function whole(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const n = Math.round(value);
  return n < 0 ? null : n;
}

/* ---------------------------------------------------------------- credit */

export interface CreditInput {
  productsUsdCents: Cents;
  paidUsdCents: Cents;
  paidLbp: number;
  rate: number;
  customerDebtUsdCents: Cents;
  creditLimitUsdCents: Cents;
  /** Previous-debt amount to collect in this checkout. 0 means leave old debt untouched. */
  previousUsdCents: Cents;
}

export type CreditError = 'nothingDue' | 'overpay' | 'creditLimit' | 'invalidAmount';

export interface CreditResult {
  ok: boolean;
  error: CreditError | null;
  paidTotalUsdCents: Cents;
  totalDueUsdCents: Cents;
  paidTowardCurrentUsdCents: Cents;
  remainingCurrentUsdCents: Cents;
  settledFromPreviousUsdCents: Cents;
  newTotalDebtUsdCents: Cents;
  debtToAddUsdCents: Cents;
}

/**
 * Allocation: previous debt first, then the current sale.
 *   previous = min(requested previous, live debt)
 *   totalDue = cart + previous
 *   settledFromPrev = min(previous, paid)
 *   paidTowardCurrent = min(cart, paid − settledFromPrev)
 *   remainingCurrent = cart − paidTowardCurrent
 *   newTotalDebt = liveDebt − settledFromPrev + remainingCurrent
 * Blocking: paid > totalDue, totalDue ≤ 0, newTotalDebt > credit limit (only when new debt is added).
 */
export function computeCredit(input: CreditInput): CreditResult {
  const cart = Math.max(0, input.productsUsdCents);
  const debt = Math.max(0, input.customerDebtUsdCents);
  const previous = Math.max(0, Math.min(Math.round(input.previousUsdCents) || 0, debt));
  const paidUsd = Math.round(input.paidUsdCents);
  const paidLbp = Math.round(input.paidLbp);
  const invalid = !Number.isFinite(paidUsd) || !Number.isFinite(paidLbp) || paidUsd < 0 || paidLbp < 0;
  const paid = invalid ? 0 : paidUsd + lbpToUsdCents(paidLbp, input.rate);

  const totalDue = cart + previous;
  const settledFromPrev = Math.min(previous, paid);
  const paidTowardCurrent = Math.min(cart, Math.max(0, paid - settledFromPrev));
  const remainingCurrent = cart - paidTowardCurrent;
  const newTotalDebt = Math.max(0, debt - settledFromPrev + remainingCurrent);
  const debtToAdd = Math.max(0, newTotalDebt - debt);

  let error: CreditError | null = null;
  if (invalid) error = 'invalidAmount';
  else if (totalDue <= 0) error = 'nothingDue';
  else if (paid > totalDue) error = 'overpay';
  else if (debtToAdd > 0 && newTotalDebt > input.creditLimitUsdCents) error = 'creditLimit';

  return {
    ok: error === null,
    error,
    paidTotalUsdCents: paid,
    totalDueUsdCents: totalDue,
    paidTowardCurrentUsdCents: paidTowardCurrent,
    remainingCurrentUsdCents: remainingCurrent,
    settledFromPreviousUsdCents: settledFromPrev,
    newTotalDebtUsdCents: newTotalDebt,
    debtToAddUsdCents: debtToAdd,
  };
}

/** Previous-balance line on a cash sale settles at most the current debt. */
export function debtLineSettlement(lineUsdCents: Cents, customerDebtUsdCents: Cents): Cents {
  return Math.max(0, Math.min(customerDebtUsdCents, lineUsdCents));
}

/* --------------------------------------------------------------- numbers */

export function formatDocNumber(prefix: string, id: number): string {
  return `${prefix}-${String(id).padStart(3, '0')}`;
}

export function offlineDocNumber(prefix: string, docId: string): string {
  return `${prefix}-OFF-${docId.slice(0, 6).toUpperCase()}`;
}
