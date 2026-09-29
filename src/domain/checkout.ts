import type { Currency } from '@/types/models';
import type { CartTotals } from './cart';
import { lbpCentTolerance, lbpToUsdCents, usdCentsToLbp, type Cents } from './money';

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

/* ---------------------------------------------------------------- credit */

export interface CreditInput {
  productsUsdCents: Cents;
  paidUsdCents: Cents;
  paidLbp: number;
  rate: number;
  customerDebtUsdCents: Cents;
  creditLimitUsdCents: Cents;
  includePreviousDebt: boolean;
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
 * CATCH POS partial/credit rule (unchanged formulas):
 *   totalDue = cart + (previous line ? existing debt : 0)
 *   paidTowardCurrent = min(cart, paid); remainingCurrent = cart − paidTowardCurrent
 *   settledFromPrev = previous line ? min(debt, paid − paidTowardCurrent) : 0
 *   newTotalDebt = previous line ? max(0, debt − settled + remainingCurrent) : debt + remainingCurrent
 * Blocking: paid > totalDue, totalDue ≤ 0, newTotalDebt > credit limit (only when new debt is added).
 */
export function computeCredit(input: CreditInput): CreditResult {
  const cart = Math.max(0, input.productsUsdCents);
  const debt = Math.max(0, input.customerDebtUsdCents);
  const paidUsd = Math.round(input.paidUsdCents);
  const paidLbp = Math.round(input.paidLbp);
  const invalid = !Number.isFinite(paidUsd) || !Number.isFinite(paidLbp) || paidUsd < 0 || paidLbp < 0;
  const paid = invalid ? 0 : paidUsd + lbpToUsdCents(paidLbp, input.rate);

  const totalDue = cart + (input.includePreviousDebt ? debt : 0);
  const paidTowardCurrent = Math.min(cart, paid);
  const remainingCurrent = cart - paidTowardCurrent;
  const settledFromPrev = input.includePreviousDebt ? Math.min(debt, Math.max(0, paid - paidTowardCurrent)) : 0;
  const newTotalDebt = input.includePreviousDebt
    ? Math.max(0, debt - settledFromPrev + remainingCurrent)
    : debt + remainingCurrent;
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
