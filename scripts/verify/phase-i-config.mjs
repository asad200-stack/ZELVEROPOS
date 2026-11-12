/**
 * Phase I talks ONLY to the disposable benchmark project.
 * Any production / CATCH / real-tenant project id is a hard stop.
 */
export const PROJECT_ID = 'certain-art-491520-g0';
export const DATABASE_ID = '(default)';
export const REGION = 'eur3';

const FORBIDDEN = new Set([
  'zelvoropos',
  'pos-catch',
  'catch-pos-guide',
  'jhpos-e4784',
  'professionalfoodsystem',
  'deltaposnet-84c6d',
  'deltaposnet-b7686',
  'cafenetbyjohny',
  'kermes-2d907',
]);

export function assertBenchProject(id = PROJECT_ID) {
  if (!id || FORBIDDEN.has(id) || id === 'zelvoropos') {
    throw new Error(`refusing to use project "${id}" for Phase I`);
  }
  if (id !== PROJECT_ID) throw new Error(`unexpected project "${id}"`);
}

export const SALES_SIZES = [10_000, 100_000, 500_000, 1_000_000];
export const salesTenant = (n) => `scale-sales-${n}`;
export const CUSTOMER_TENANT = 'scale-customer-sales';
export const STATS_TENANT = 'scale-stats-1000';

export const DAY_MS = 86_400_000;
export const START_MS = Date.UTC(2025, 0, 1);
export const DATE_SPAN = 400;

export function localDate(index, span = DATE_SPAN) {
  const day = new Date(START_MS + (index % span) * DAY_MS);
  return `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, '0')}-${String(day.getUTCDate()).padStart(2, '0')}`;
}

export function dateOnDay(dayIndex) {
  const day = new Date(START_MS + dayIndex * DAY_MS);
  return `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, '0')}-${String(day.getUTCDate()).padStart(2, '0')}`;
}

export function saleId(index) {
  return `s${String(index).padStart(7, '0')}`;
}

export function invoiceNumber(index) {
  return `INV-${String(index).padStart(8, '0')}`;
}

/** Three documents share createdAtMs so __name__ tie-break is exercised. */
export function createdAtMs(index) {
  return START_MS + Math.floor(index / 3);
}

export function saleFields(index, customer) {
  const kind = index % 5 === 0 ? 'credit' : 'cash';
  const paid = kind === 'cash' ? 500 : 0;
  return {
    invoiceNumber: invoiceNumber(index),
    kind,
    currency: 'USD',
    exchangeRate: 89_500,
    items: [{ productId: 'p1', name: 'Item', quantity: 1, returnedQty: 0, unitUsdCents: 500, costUsdCents: 200 }],
    totalUsdCents: 500,
    totalLbp: 0,
    discountUsdCents: 0,
    costUsdCents: 200,
    customerId: customer,
    customerName: customer ?? '',
    orderLabel: '',
    note: '',
    payment: { receivedUsdCents: paid, receivedLbp: 0, changeUsdCents: 0, changeLbp: 0 },
    returnedUsdCents: 0,
    returnedDebtUsdCents: 0,
    refundedUsdCents: 0,
    refundedLbp: 0,
    returnStatus: 'none',
    lastReturnId: null,
    offline: false,
    localDate: localDate(index),
    createdAtMs: createdAtMs(index),
    createdBy: 'scale',
    createdByName: 'Scale',
  };
}

export function customerForScaleSale(index) {
  return `c${String(index % 1000).padStart(4, '0')}`;
}

export function customerHistoryId(index) {
  if (index < 10) return 'c10';
  if (index < 1_010) return 'c1000';
  if (index < 11_010) return 'c10000';
  return 'c100000';
}

export const CUSTOMER_HISTORY_COUNT = 111_010;
