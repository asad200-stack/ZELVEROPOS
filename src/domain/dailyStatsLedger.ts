/**
 * The same additions Cloud Functions apply with `bumpDailyStats`.
 * A rebuild of one day must produce these figures from that day's sales, returns, expenses, and debt payments.
 */

export interface DailyFigures {
  salesCount: number;
  revenueUsdCents: number;
  costUsdCents: number;
  discountUsdCents: number;
  cashSalesUsdCents: number;
  creditSalesUsdCents: number;
  debtCollectedUsdCents: number;
  creditIssuedUsdCents: number;
  returnsCount: number;
  returnsUsdCents: number;
  returnsCostUsdCents: number;
  expensesUsdCents: number;
}

export const DAILY_FIGURE_KEYS = [
  'salesCount',
  'revenueUsdCents',
  'costUsdCents',
  'discountUsdCents',
  'cashSalesUsdCents',
  'creditSalesUsdCents',
  'debtCollectedUsdCents',
  'creditIssuedUsdCents',
  'returnsCount',
  'returnsUsdCents',
  'returnsCostUsdCents',
  'expensesUsdCents',
] as const satisfies readonly (keyof DailyFigures)[];

export function zeroDailyFigures(): DailyFigures {
  return {
    salesCount: 0,
    revenueUsdCents: 0,
    costUsdCents: 0,
    discountUsdCents: 0,
    cashSalesUsdCents: 0,
    creditSalesUsdCents: 0,
    debtCollectedUsdCents: 0,
    creditIssuedUsdCents: 0,
    returnsCount: 0,
    returnsUsdCents: 0,
    returnsCostUsdCents: 0,
    expensesUsdCents: 0,
  };
}

export function addDailyFigures(base: DailyFigures, delta: Partial<DailyFigures>): DailyFigures {
  const next = { ...base };
  for (const key of DAILY_FIGURE_KEYS) next[key] += delta[key] ?? 0;
  return next;
}

export function figuresForSale(input: {
  revenueUsdCents: number;
  costUsdCents: number;
  discountUsdCents: number;
  kind: 'cash' | 'credit';
  debtCollectedUsdCents: number;
  creditIssuedUsdCents: number;
}): Partial<DailyFigures> {
  return {
    salesCount: 1,
    revenueUsdCents: input.revenueUsdCents,
    costUsdCents: input.costUsdCents,
    discountUsdCents: input.discountUsdCents,
    [input.kind === 'cash' ? 'cashSalesUsdCents' : 'creditSalesUsdCents']: input.revenueUsdCents,
    debtCollectedUsdCents: input.debtCollectedUsdCents,
    creditIssuedUsdCents: input.creditIssuedUsdCents,
  };
}

export function figuresForReturn(amountUsdCents: number, costUsdCents: number): Partial<DailyFigures> {
  return { returnsCount: 1, returnsUsdCents: amountUsdCents, returnsCostUsdCents: costUsdCents };
}

export function figuresForExpense(expensesUsdCents: number): Partial<DailyFigures> {
  return { expensesUsdCents };
}

export function figuresForDebtPayment(debtCollectedUsdCents: number): Partial<DailyFigures> {
  return { debtCollectedUsdCents };
}
