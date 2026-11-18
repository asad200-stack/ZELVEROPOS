import { describe, expect, it } from 'vitest';
import type { TFunction } from '@/i18n/i18n';
import type { Sale, StoreSettings } from '@/types/models';
import { buildSaleReceipt } from './receipt';

const xss = '<script>alert(1)</script>';
const t = ((k: string) => k) as TFunction;

const settings: StoreSettings = {
  storeName: xss,
  storeAddress: xss,
  storePhone: '1',
  logoUrl: 'javascript:alert(1)',
  logoPath: null,
  receiptFooter: xss,
  printFormat: 'thermal80',
  autoPrintInvoice: false,
  exchangeRate: 89500,
  defaultCurrency: 'USD',
  lowStockAlert: false,
  lowStockThreshold: 0,
  telegram: { enabled: false, events: { sales: true, returns: true, cash: true, lowStock: false } },
  updatedAt: 0,
};

const sale: Sale = {
  id: 's1',
  invoiceNumber: 'INV-1',
  kind: 'cash',
  currency: 'USD',
  exchangeRate: 89500,
  items: [
    {
      productId: 'p1',
      name: xss,
      quantity: 1,
      tier: 'retail',
      unitUsdCents: 100,
      unitLbp: 0,
      originalUnitUsdCents: 100,
      discountUsdCents: 0,
      costUsdCents: 50,
      imei: xss,
      returnedQty: 0,
    },
  ],
  totalUsdCents: 100,
  totalLbp: 0,
  discountUsdCents: 0,
  checkoutDiscountUsdCents: 0,
  checkoutDiscountLbp: 0,
  checkoutDiscountKind: null,
  payableUsdCents: 100,
  payableLbp: 0,
  costUsdCents: 50,
  customerId: 'c1',
  customerName: xss,
  orderLabel: xss,
  note: xss,
  payment: {
    receivedUsdCents: 100,
    receivedLbp: 0,
    previousDebtUsdCents: 0,
    settledPreviousUsdCents: 0,
    unpaidUsdCents: 0,
    debtAddedUsdCents: 0,
    debtAfterUsdCents: null,
  },
  returnedUsdCents: 0,
  returnedDebtUsdCents: 0,
  refundedUsdCents: 0,
  refundedLbp: 0,
  returnStatus: 'none',
  lastReturnId: null,
  offline: false,
  createdAt: Date.now(),
  createdBy: 'u1',
  createdByName: xss,
  localDate: '2026-10-09',
};

describe('receipt format', () => {
  it('prints the same sale as 80mm or A4 without changing the amounts', () => {
    const ctx = { settings, lang: 'en' as const, t };
    const thermal = buildSaleReceipt(sale, { ...ctx, format: 'thermal80' });
    const a4 = buildSaleReceipt(sale, { ...ctx, format: 'a4' });
    expect(thermal).toContain('size:80mm auto');
    expect(thermal).not.toContain('size:A4');
    expect(a4).toContain('size:A4');
    expect(a4).not.toContain('size:80mm auto');
    for (const html of [thermal, a4]) {
      expect(html).toContain('INV-1');
      expect(html).toContain('$1.00');
      expect(html).toContain('&lt;script&gt;');
      expect(html).not.toContain('<script>');
    }
    expect(settings.printFormat).toBe('thermal80');
  });
});

describe('receipt XSS', () => {
  it('escapes user-controlled names, notes and IMEI in printed HTML', () => {
    const html = buildSaleReceipt(sale, { settings, lang: 'en', t });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('javascript:alert');
  });
});

describe('receipt previous debt', () => {
  it('I: lists previous debt paid separately from sale items and revenue', () => {
    const html = buildSaleReceipt(
      {
        ...sale,
        customerName: 'Ada',
        totalUsdCents: 10_000,
        payment: {
          ...sale.payment,
          receivedUsdCents: 14_000,
          previousDebtUsdCents: 4_000,
          settledPreviousUsdCents: 4_000,
          debtAfterUsdCents: 0,
        },
      },
      { settings, lang: 'en', t },
    );
    expect(html).toContain('pos.totalSale');
    expect(html).toContain('receipt.previousDebtPaid');
    expect(html).toContain('$40.00');
    expect(html).toContain('receipt.totalCollected');
    expect(html).toContain('$140.00');
    expect(html).toContain('receipt.balanceAfter');
    expect(html).not.toMatch(/<td>Previous balance<\/td>/);
    const itemTable = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'));
    expect(itemTable).not.toContain('$40.00');
  });
});
