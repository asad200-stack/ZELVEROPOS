import { describe, expect, it } from 'vitest';
import { DAILY_STATS_LIMIT, planDailyStats, planInvoiceLookup, planReturnsForSale, planSales, SALES_PAGE_SIZE } from './salesPlan';
import { acceptSalesResult, emptySalesWindow, goToNextSalesPage, goToPreviousSalesPage, showSalesPage, type SalesCursorKey } from './salesSession';

const limitOf = (plan: { op: string; n?: number }[]) => plan.find((step) => step.op === 'limit');

describe('sales query plans', () => {
  it('pages a date range with a cursor and a fixed page size', () => {
    const plan = planSales({ from: '2026-01-01', to: '2026-01-31', hasCursor: true });
    expect(SALES_PAGE_SIZE).toBe(50);
    expect(limitOf(plan)).toEqual({ op: 'limit', n: 50 });
    expect(plan.some((step) => step.op === 'startAfter')).toBe(true);
    expect(plan.filter((step) => step.op === 'orderBy')).toEqual([
      { op: 'orderBy', field: 'localDate', dir: 'desc' },
      { op: 'orderBy', field: 'createdAtMs', dir: 'desc' },
      { op: 'orderBy', field: '__name__', dir: 'desc' },
    ]);
    expect(JSON.stringify(plan)).not.toContain('offset');
  });

  it('filters one customer inside the date range', () => {
    const plan = planSales({ from: '2026-01-01', to: '2026-12-31', customerId: 'c-10000', hasCursor: false });
    expect(plan).toContainEqual({ op: 'where', field: 'customerId', cmp: '==', value: 'c-10000' });
    expect(limitOf(plan)).toEqual({ op: 'limit', n: 50 });
  });

  it('looks up an invoice by exact number', () => {
    const plan = planInvoiceLookup(' inv-2026-001234 ');
    expect(plan).toEqual([
      { op: 'where', field: 'invoiceNumber', cmp: '==', value: 'INV-2026-001234' },
      { op: 'limit', n: 1 },
    ]);
  });

  it('loads returns for one sale', () => {
    const plan = planReturnsForSale(false);
    expect(plan).toContainEqual({ op: 'where', field: 'saleId', cmp: '==', value: 'sale' });
    expect(limitOf(plan)?.n).toBeLessThanOrEqual(50);
    expect(JSON.stringify(plan)).not.toContain('sales');
  });

  it('reads daily summaries, not sales, for a period', () => {
    const plan = planDailyStats();
    expect(limitOf(plan)).toEqual({ op: 'limit', n: DAILY_STATS_LIMIT });
    expect(plan.some((step) => step.op === 'where' && step.field === 'date')).toBe(true);
    expect(JSON.stringify(plan)).not.toContain('localDate');
  });
});

describe('sales page window', () => {
  it('keeps the visible page until the next page arrives and then replaces it', () => {
    let window = showSalesPage(emptySalesWindow<string>(), ['page-0']);
    const seen = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      const end: SalesCursorKey = { localDate: '2026-01-01', createdAtMs: 1_000 - i, id: `s${i}` };
      expect(seen.has(end.id)).toBe(false);
      seen.add(end.id);
      window = goToNextSalesPage(window, end);
      expect(window.items).toEqual(['page-0']);
    }
    expect(window.back).toHaveLength(20);
    window = showSalesPage(window, ['page-20']);
    expect(window.items).toEqual(['page-20']);
    window = goToPreviousSalesPage(window);
    expect(window.start?.id).toBe('s18');
    expect(window.items).toEqual(['page-20']);
    window = showSalesPage(window, ['back']);
    expect(window.items).toEqual(['back']);
  });

  it('drops a response that belongs to an older filter or page', () => {
    expect(acceptSalesResult(1, 1)).toBe(true);
    expect(acceptSalesResult(1, 2)).toBe(false);
    expect(acceptSalesResult(4, 4)).toBe(true);
  });
});
