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

describe('receipt XSS', () => {
  it('escapes user-controlled names, notes and IMEI in printed HTML', () => {
    const html = buildSaleReceipt(sale, { settings, lang: 'en', t });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('javascript:alert');
  });
});
