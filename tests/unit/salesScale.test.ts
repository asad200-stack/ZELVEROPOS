import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('sales scale boundaries', () => {
  it('does not listen to the sales collection', () => {
    const page = read('../../src/features/sales/SalesPage.tsx');
    const service = read('../../src/services/salesService.ts');
    const windowHook = read('../../src/features/sales/useSalesWindow.ts');
    expect(page).not.toContain('onSnapshot');
    expect(page).toContain('useSalesWindow');
    expect(page).not.toContain('loadMore');
    expect(service).not.toContain('onSnapshot');
    expect(service).toContain('limit(PAGE_SIZE)');
    expect(service).toContain('limit(1)');
    expect(service).not.toContain('REPORT_MAX_DOCS');
    expect(windowHook).toContain('cancelled = true');
    expect(windowHook).toContain('acceptSalesResult');
    expect(windowHook).not.toContain('...s.items');
    expect(windowHook).not.toContain('...window.items');
    const settings = read('../../src/services/settingsService.ts');
    expect(settings).not.toContain('getDocs');
    expect(settings).not.toContain('50_000');
  });

  it('looks up an invoice and a sale document directly', () => {
    const service = read('../../src/services/salesService.ts');
    expect(service).toContain("where('invoiceNumber'");
    expect(service).toContain('getDoc(paths.doc(tenantId, \'sales\', saleId))');
    const modal = read('../../src/features/sales/SaleDetailsModal.tsx');
    expect(modal).toContain('getSale(');
    expect(modal).toContain('listReturnsForSale(');
    expect(modal).not.toContain('listSales(');
  });

  it('keeps customer history and returns on an equality filter', () => {
    const service = read('../../src/services/salesService.ts');
    expect(service).toContain("where('customerId', '==', filter.customerId)");
    expect(service).toContain("where('saleId', '==', saleId)");
    expect(service).toContain('limit(50)');
    const returns = read('../../functions/src/pos/sales.ts');
    const body = returns.slice(returns.indexOf('export const posReturn'));
    expect(body).toContain('planReturn(');
    expect(body).not.toContain("collection('returns')");
    expect(body).not.toContain('getDocs');
  });

  it('loads the dashboard and reports from summaries or bounded pages', () => {
    const dashboard = read('../../src/features/dashboard/DashboardPage.tsx');
    const reports = read('../../src/features/reports/ReportsPage.tsx');
    const stats = read('../../src/services/reportService.ts');
    expect(dashboard).toContain('loadDailyStats');
    expect(dashboard).not.toContain('listSales');
    expect(dashboard).not.toContain("col(tenantId, 'sales')");
    expect(reports).toContain('loadDailyStats');
    expect(reports).not.toContain('loadSalesRange');
    expect(reports).not.toContain('listSales');
    expect(reports).toContain('listCashTransactions');
    expect(stats).toContain("paths.col(tenantId, 'dailyStats')");
    expect(stats).not.toContain("'sales'");
  });
});
