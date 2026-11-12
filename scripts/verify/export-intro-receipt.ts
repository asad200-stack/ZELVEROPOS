/**
 * Renders the real thermal receipt for the local demo sale.
 * Does not write to Firestore and does not touch production.
 */
import { writeFileSync } from 'node:fs';
import { buildSaleReceipt } from '../../src/features/sales/receipt';
import { translate } from '../../src/i18n/i18n';
import type { Sale, StoreSettings } from '../../src/types/models';

const settings: StoreSettings = {
  storeName: 'Demo Store',
  storeAddress: '',
  storePhone: '',
  logoUrl: null,
  logoPath: null,
  receiptFooter: '',
  printFormat: 'thermal80',
  autoPrintInvoice: false,
  exchangeRate: 89500,
  defaultCurrency: 'USD',
  lowStockAlert: true,
  lowStockThreshold: 10,
  telegram: { enabled: false, events: { sales: true, returns: true, cash: true, lowStock: false } },
  updatedAt: null,
};

const sale: Sale = {
  id: 'u5fxgddcTU9Ap0E7vB6G',
  invoiceNumber: 'INV-001',
  kind: 'cash',
  currency: 'USD',
  exchangeRate: 89500,
  items: [
    {
      productId: 'case',
      name: 'Phone case',
      quantity: 1,
      tier: 'retail',
      unitUsdCents: 500,
      unitLbp: 447500,
      originalUnitUsdCents: 500,
      discountUsdCents: 0,
      costUsdCents: 250,
      imei: null,
      returnedQty: 0,
    },
  ],
  totalUsdCents: 500,
  totalLbp: 447500,
  discountUsdCents: 0,
  costUsdCents: 250,
  customerId: null,
  customerName: '',
  orderLabel: '',
  note: '',
  payment: {
    receivedUsdCents: 500,
    receivedLbp: 0,
    changeUsdCents: 0,
    changeLbp: 0,
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
  createdAt: 1791937228832,
  createdBy: 'demoStore',
  createdByName: 'Demo Owner',
  localDate: '2026-10-14',
};

const html = buildSaleReceipt(sale, { settings, lang: 'en', t: (key, params) => translate('en', key, params) });
const plate = html.replace('body{', 'html,body{background:#fff;color:#000;color-scheme:light;');
writeFileSync(new URL('../../docs/awakening/continuity/receipt.html', import.meta.url), plate);
console.log('wrote receipt.html');
