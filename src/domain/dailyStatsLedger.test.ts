import { describe, expect, it } from 'vitest';
import {
  addDailyFigures,
  figuresForDebtPayment,
  figuresForExpense,
  figuresForReturn,
  figuresForSale,
  zeroDailyFigures,
} from './dailyStatsLedger';

describe('daily stats reconciliation', () => {
  it('matches a day of sales, a return, an expense, and a debt payment with no drift', () => {
    let day = zeroDailyFigures();
    day = addDailyFigures(
      day,
      figuresForSale({
        revenueUsdCents: 1_000,
        costUsdCents: 400,
        discountUsdCents: 50,
        kind: 'cash',
        debtCollectedUsdCents: 0,
        creditIssuedUsdCents: 0,
      }),
    );
    day = addDailyFigures(
      day,
      figuresForSale({
        revenueUsdCents: 2_000,
        costUsdCents: 800,
        discountUsdCents: 0,
        kind: 'credit',
        debtCollectedUsdCents: 100,
        creditIssuedUsdCents: 500,
      }),
    );
    day = addDailyFigures(day, figuresForReturn(300, 120));
    day = addDailyFigures(day, figuresForExpense(75));
    day = addDailyFigures(day, figuresForDebtPayment(40));

    expect(day).toEqual({
      salesCount: 2,
      revenueUsdCents: 3_000,
      costUsdCents: 1_200,
      discountUsdCents: 50,
      cashSalesUsdCents: 1_000,
      creditSalesUsdCents: 2_000,
      debtCollectedUsdCents: 140,
      creditIssuedUsdCents: 500,
      returnsCount: 1,
      returnsUsdCents: 300,
      returnsCostUsdCents: 120,
      expensesUsdCents: 75,
    });
  });
});
