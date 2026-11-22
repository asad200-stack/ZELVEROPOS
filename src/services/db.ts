import { collection, doc, Timestamp, type DocumentData } from 'firebase/firestore';
import { firebase } from '@/firebase/app';
import { DEFAULTS } from '@/constants/app';
import { normalizePermissions } from '@/constants/permissions';
import type {
  CashboxSummary,
  CashTransaction,
  Customer,
  CustomerLedgerEntry,
  ImeiEntry,
  Product,
  Purchase,
  PurchaseReturn,
  Sale,
  SaleItem,
  SaleReturn,
  StockMovement,
  StoreSettings,
  Subscription,
  Supplier,
  SupplierPayment,
  TierPrice,
  UserProfile,
} from '@/types/models';

/* ------------------------------------------------------------------ paths */

export type TenantCollection =
  | 'products'
  | 'customers'
  | 'customerLedger'
  | 'suppliers'
  | 'purchases'
  | 'purchaseReturns'
  | 'supplierPayments'
  | 'sales'
  | 'returns'
  | 'stockMovements'
  | 'cashTransactions'
  | 'dailyStats';

export const paths = {
  user: (uid: string) => doc(firebase.db, 'users', uid),
  users: () => collection(firebase.db, 'users'),
  subscription: (tenantId: string) => doc(firebase.db, 'subscriptions', tenantId),
  store: (tenantId: string) => doc(firebase.db, 'stores', tenantId),
  settings: (t: string) => doc(firebase.db, 'tenants', t, 'settings', 'main'),
  telegram: (t: string) => doc(firebase.db, 'tenants', t, 'private', 'telegram'),
  counter: (t: string, name: 'sales' | 'purchases') => doc(firebase.db, 'tenants', t, 'counters', name),
  cashbox: (t: string) => doc(firebase.db, 'tenants', t, 'cashbox', 'summary'),
  categories: (t: string) => doc(firebase.db, 'tenants', t, 'lists', 'categories'),
  col: (t: string, name: TenantCollection) => collection(firebase.db, 'tenants', t, name),
  doc: (t: string, name: TenantCollection, id: string) => doc(firebase.db, 'tenants', t, name, id),
  newId: (t: string, name: TenantCollection) => doc(collection(firebase.db, 'tenants', t, name)).id,
};

/** The acting user, stamped on every business document for audit purposes. */
export interface Actor {
  tenantId: string;
  uid: string;
  name: string;
}

/* ------------------------------------------------------------ primitives */

const num = (v: unknown, def = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : def);
const int = (v: unknown, def = 0): number => Math.round(num(v, def));
const str = (v: unknown, def = ''): string => (typeof v === 'string' ? v : def);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const bool = (v: unknown, def = false): boolean => (typeof v === 'boolean' ? v : def);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Firestore Timestamp → epoch ms. Falls back to the client-side `createdAtMs` while pending. */
export function millis(v: unknown, fallback?: unknown): number | null {
  if (v instanceof Timestamp) return v.toMillis();
  if (v && typeof (v as Timestamp).toMillis === 'function') return (v as Timestamp).toMillis();
  if (typeof fallback === 'number') return fallback;
  return null;
}

const tierPrice = (v: unknown): TierPrice => {
  const o = (v ?? {}) as DocumentData;
  return { usdCents: int(o.usdCents), lbp: typeof o.lbp === 'number' && o.lbp > 0 ? Math.round(o.lbp) : null };
};

/* ------------------------------------------------------------ converters */

/** Size/colour set fields, only on products that belong to one (see domain/variants). */
function variantFields(d: DocumentData): Pick<Product, 'groupId' | 'groupName' | 'options'> {
  if (typeof d.groupId !== 'string' || !d.groupId) return {};
  const options = Array.isArray(d.options)
    ? (d.options as unknown[])
        .filter((o): o is { name: string; value: string } => !!o && typeof (o as { name?: unknown }).name === 'string' && typeof (o as { value?: unknown }).value === 'string')
        .map((o) => ({ name: o.name, value: o.value }))
    : [];
  return { groupId: d.groupId, groupName: typeof d.groupName === 'string' ? d.groupName : '', options };
}

export function toProduct(id: string, d: DocumentData): Product {
  const prices = (d.prices ?? {}) as DocumentData;
  return {
    id,
    name: str(d.name),
    category: str(d.category),
    barcode: str(d.barcode),
    prices: { retail: tierPrice(prices.retail), wholesale: tierPrice(prices.wholesale), vip: tierPrice(prices.vip) },
    costUsdCents: int(d.costUsdCents),
    costKnown: d.costKnown !== false,
    stock: int(d.stock),
    minStock: typeof d.minStock === 'number' ? d.minStock : null,
    supplierId: strOrNull(d.supplierId),
    supplierName: str(d.supplierName),
    expiryDate: strOrNull(d.expiryDate),
    imageUrl: strOrNull(d.imageUrl),
    imagePath: strOrNull(d.imagePath),
    imeiTracking: bool(d.imeiTracking),
    imeis: arr<ImeiEntry>(d.imeis).filter((e) => e && typeof e.imei === 'string'),
    lastMovementId: strOrNull(d.lastMovementId),
    ...variantFields(d),
    status: d.status === 'archived' ? 'archived' : 'active',
    archivedAt: millis(d.archivedAt),
    createdAt: millis(d.createdAt, d.createdAtMs),
    updatedAt: millis(d.updatedAt),
  };
}

export function toCustomer(id: string, d: DocumentData): Customer {
  return {
    id,
    name: str(d.name),
    phone: str(d.phone),
    email: str(d.email),
    address: str(d.address),
    creditLimitUsdCents: int(d.creditLimitUsdCents, DEFAULTS.creditLimitUsdCents),
    debtUsdCents: int(d.debtUsdCents),
    totalPurchasesUsdCents: int(d.totalPurchasesUsdCents),
    lastLedgerId: strOrNull(d.lastLedgerId),
    createdAt: millis(d.createdAt, d.createdAtMs),
    updatedAt: millis(d.updatedAt),
  };
}

const audit = (d: DocumentData) => ({
  localDate: str(d.localDate),
  createdAt: millis(d.createdAt, d.createdAtMs),
  createdBy: str(d.createdBy),
  createdByName: str(d.createdByName),
});

export function toLedgerEntry(id: string, d: DocumentData): CustomerLedgerEntry {
  return {
    id,
    customerId: str(d.customerId),
    customerName: str(d.customerName),
    type: str(d.type, 'adjustment') as CustomerLedgerEntry['type'],
    amountUsdCents: int(d.amountUsdCents),
    balanceAfterUsdCents: typeof d.balanceAfterUsdCents === 'number' ? d.balanceAfterUsdCents : null,
    paidUsdCents: int(d.paidUsdCents),
    paidLbp: int(d.paidLbp),
    refId: strOrNull(d.refId),
    refNumber: strOrNull(d.refNumber),
    note: str(d.note),
    ...audit(d),
  };
}

export function toSupplier(id: string, d: DocumentData): Supplier {
  return {
    id,
    name: str(d.name),
    contactPerson: str(d.contactPerson),
    phone: str(d.phone),
    email: str(d.email),
    address: str(d.address),
    balanceUsdCents: int(d.balanceUsdCents),
    createdAt: millis(d.createdAt, d.createdAtMs),
    updatedAt: millis(d.updatedAt),
  };
}

export function toPurchase(id: string, d: DocumentData): Purchase {
  return {
    id,
    number: str(d.number),
    supplierId: str(d.supplierId),
    supplierName: str(d.supplierName),
    date: str(d.date),
    dueDate: strOrNull(d.dueDate),
    items: arr<DocumentData>(d.items).map((i) => ({
      productId: str(i.productId),
      name: str(i.name),
      quantity: int(i.quantity),
      unitCostUsdCents: int(i.unitCostUsdCents),
      returnedQty: int(i.returnedQty),
    })),
    totalUsdCents: int(d.totalUsdCents),
    returnedUsdCents: int(d.returnedUsdCents),
    paidUsdCents: int(d.paidUsdCents),
    remainingUsdCents: int(d.remainingUsdCents),
    status: str(d.status, 'unpaid') as Purchase['status'],
    updateCost: bool(d.updateCost),
    note: str(d.note),
    createdAt: millis(d.createdAt, d.createdAtMs),
    createdBy: str(d.createdBy),
    createdByName: str(d.createdByName),
  };
}

export function toPurchaseReturn(id: string, d: DocumentData): PurchaseReturn {
  return {
    id,
    purchaseId: str(d.purchaseId),
    purchaseNumber: str(d.purchaseNumber),
    supplierId: str(d.supplierId),
    supplierName: str(d.supplierName),
    items: arr<DocumentData>(d.items).map((i) => ({
      productId: str(i.productId),
      name: str(i.name),
      quantity: int(i.quantity),
      unitCostUsdCents: int(i.unitCostUsdCents),
    })),
    amountUsdCents: int(d.amountUsdCents),
    note: str(d.note),
    ...audit(d),
  };
}

export function toSupplierPayment(id: string, d: DocumentData): SupplierPayment {
  return {
    id,
    supplierId: str(d.supplierId),
    supplierName: str(d.supplierName),
    currency: str(d.currency, 'USD') as SupplierPayment['currency'],
    amount: int(d.amount),
    amountUsdCents: int(d.amountUsdCents),
    exchangeRate: num(d.exchangeRate, DEFAULTS.exchangeRate),
    method: str(d.method, 'cash') as SupplierPayment['method'],
    appliedTo: arr<DocumentData>(d.appliedTo).map((a) => ({
      purchaseId: str(a.purchaseId),
      purchaseNumber: str(a.purchaseNumber),
      amountUsdCents: int(a.amountUsdCents),
    })),
    note: str(d.note),
    ...audit(d),
  };
}

function toSaleItem(i: DocumentData): SaleItem {
  return {
    productId: str(i.productId),
    name: str(i.name),
    quantity: int(i.quantity),
    tier: str(i.tier, 'retail') as SaleItem['tier'],
    unitUsdCents: int(i.unitUsdCents),
    unitLbp: int(i.unitLbp),
    originalUnitUsdCents: int(i.originalUnitUsdCents),
    discountUsdCents: int(i.discountUsdCents),
    costUsdCents: int(i.costUsdCents),
    imei: strOrNull(i.imei),
    returnedQty: int(i.returnedQty),
  };
}

export function toSale(id: string, d: DocumentData): Sale {
  const p = (d.payment ?? {}) as DocumentData;
  return {
    id,
    invoiceNumber: str(d.invoiceNumber),
    kind: str(d.kind, 'cash') as Sale['kind'],
    currency: str(d.currency, 'USD') as Sale['currency'],
    exchangeRate: num(d.exchangeRate, DEFAULTS.exchangeRate),
    items: arr<DocumentData>(d.items).map(toSaleItem),
    totalUsdCents: int(d.totalUsdCents),
    totalLbp: int(d.totalLbp),
    discountUsdCents: int(d.discountUsdCents),
    checkoutDiscountUsdCents: int(d.checkoutDiscountUsdCents),
    checkoutDiscountLbp: int(d.checkoutDiscountLbp),
    checkoutDiscountKind: d.checkoutDiscountKind === 'fixed' || d.checkoutDiscountKind === 'roundDown' ? d.checkoutDiscountKind : null,
    payableUsdCents: int(d.payableUsdCents),
    payableLbp: int(d.payableLbp),
    costUsdCents: int(d.costUsdCents),
    customerId: strOrNull(d.customerId),
    customerName: str(d.customerName),
    orderLabel: str(d.orderLabel),
    note: str(d.note),
    payment: {
      receivedUsdCents: int(p.receivedUsdCents),
      receivedLbp: int(p.receivedLbp),
      changeUsdCents: int(p.changeUsdCents),
      changeLbp: int(p.changeLbp),
      previousDebtUsdCents: int(p.previousDebtUsdCents),
      settledPreviousUsdCents: int(p.settledPreviousUsdCents),
      unpaidUsdCents: int(p.unpaidUsdCents),
      debtAddedUsdCents: int(p.debtAddedUsdCents),
      debtAfterUsdCents: typeof p.debtAfterUsdCents === 'number' ? p.debtAfterUsdCents : null,
    },
    returnedUsdCents: int(d.returnedUsdCents),
    returnedDebtUsdCents: int(d.returnedDebtUsdCents),
    refundedUsdCents: int(d.refundedUsdCents),
    refundedLbp: int(d.refundedLbp),
    returnStatus: str(d.returnStatus, 'none') as Sale['returnStatus'],
    lastReturnId: strOrNull(d.lastReturnId),
    offline: bool(d.offline),
    ...audit(d),
  };
}

export function toSaleReturn(id: string, d: DocumentData): SaleReturn {
  return {
    id,
    number: str(d.number),
    saleId: str(d.saleId),
    saleInvoiceNumber: str(d.saleInvoiceNumber),
    customerId: strOrNull(d.customerId),
    customerName: str(d.customerName),
    items: arr<DocumentData>(d.items).map((i) => ({
      productId: str(i.productId),
      name: str(i.name),
      quantity: int(i.quantity),
      unitUsdCents: int(i.unitUsdCents),
      costUsdCents: int(i.costUsdCents),
      imei: strOrNull(i.imei),
    })),
    amountUsdCents: int(d.amountUsdCents),
    refundUsdCents: int(d.refundUsdCents),
    refundLbp: int(d.refundLbp),
    debtReducedUsdCents: int(d.debtReducedUsdCents),
    reason: str(d.reason),
    ...audit(d),
  };
}

export function toStockMovement(id: string, d: DocumentData): StockMovement {
  return {
    id,
    productId: str(d.productId),
    productName: str(d.productName),
    type: str(d.type, 'adjustment') as StockMovement['type'],
    quantity: int(d.quantity),
    stockAfter: typeof d.stockAfter === 'number' ? d.stockAfter : null,
    refId: strOrNull(d.refId),
    refNumber: strOrNull(d.refNumber),
    note: str(d.note),
    ...audit(d),
  };
}

export function toCashTransaction(id: string, d: DocumentData): CashTransaction {
  const b = d.balanceAfter as DocumentData | null | undefined;
  return {
    id,
    type: str(d.type, 'adjustment') as CashTransaction['type'],
    usdCents: int(d.usdCents),
    lbp: int(d.lbp),
    balanceAfter: b ? { usdCents: int(b.usdCents), lbp: int(b.lbp) } : null,
    category: str(d.category),
    note: str(d.note),
    refId: strOrNull(d.refId),
    refNumber: strOrNull(d.refNumber),
    ...audit(d),
  };
}

export function toCashbox(d: DocumentData | undefined): CashboxSummary {
  return {
    usdCents: int(d?.usdCents),
    lbp: int(d?.lbp),
    lastTxId: strOrNull(d?.lastTxId),
    updatedAt: millis(d?.updatedAt),
  };
}

export const DEFAULT_SETTINGS: StoreSettings = {
  storeName: '',
  storeAddress: '',
  storePhone: '',
  logoUrl: null,
  logoPath: null,
  receiptFooter: '',
  printFormat: 'thermal80',
  autoPrintInvoice: false,
  exchangeRate: DEFAULTS.exchangeRate,
  defaultCurrency: 'USD',
  lowStockAlert: true,
  lowStockThreshold: DEFAULTS.lowStockThreshold,
  telegram: { enabled: false, events: { sales: true, returns: true, cash: true, lowStock: false, onlineOrders: true } },
  updatedAt: null,
};

export function toSettings(d: DocumentData | undefined): StoreSettings {
  if (!d) return DEFAULT_SETTINGS;
  const tg = (d.telegram ?? {}) as DocumentData;
  const ev = (tg.events ?? {}) as DocumentData;
  const rate = int(d.exchangeRate, DEFAULTS.exchangeRate);
  return {
    storeName: str(d.storeName),
    storeAddress: str(d.storeAddress),
    storePhone: str(d.storePhone),
    logoUrl: strOrNull(d.logoUrl),
    logoPath: strOrNull(d.logoPath),
    receiptFooter: str(d.receiptFooter),
    printFormat: d.printFormat === 'a4' ? 'a4' : 'thermal80',
    autoPrintInvoice: bool(d.autoPrintInvoice),
    exchangeRate: rate > 0 ? rate : DEFAULTS.exchangeRate,
    defaultCurrency: d.defaultCurrency === 'LBP' ? 'LBP' : 'USD',
    lowStockAlert: bool(d.lowStockAlert, true),
    lowStockThreshold: int(d.lowStockThreshold, DEFAULTS.lowStockThreshold),
    telegram: {
      enabled: bool(tg.enabled),
      events: {
        sales: bool(ev.sales, true),
        returns: bool(ev.returns, true),
        cash: bool(ev.cash, true),
        lowStock: bool(ev.lowStock),
        onlineOrders: bool(ev.onlineOrders, true),
      },
    },
    updatedAt: millis(d.updatedAt),
  };
}

export function toUserProfile(uid: string, d: DocumentData): UserProfile {
  return {
    uid,
    email: str(d.email),
    fullName: str(d.fullName),
    role: d.role === 'subUser' ? 'subUser' : 'owner',
    tenantId: str(d.tenantId),
    isActive: bool(d.isActive, true),
    permissions: normalizePermissions(d.permissions),
    storeName: str(d.storeName),
    subdomain: str(d.subdomain),
    phone: str(d.phone),
    claimsVersion: int(d.claimsVersion),
    createdAt: millis(d.createdAt),
  };
}

export function toSubscription(d: DocumentData | undefined): Subscription {
  return {
    activated: bool(d?.activated),
    lifetime: bool(d?.lifetime),
    startsAt: millis(d?.startsAt),
    endsAt: millis(d?.endsAt),
    updatedAt: millis(d?.updatedAt),
    trial: bool(d?.trial),
    status: str(d?.status, ''),
    source: str(d?.source, ''),
    referralCode: strOrNull(d?.referralCode),
    plan: strOrNull(d?.plan),
    internalDemo: d?.internalDemo === true,
  };
}
