import type { PermissionMap } from '@/constants/permissions';

/**
 * Domain model. Money is always stored as integers: USD in cents, LBP in whole pounds.
 * Timestamps are Firestore Timestamps in the database and epoch milliseconds in the app
 * (`null` while a server timestamp is still pending locally).
 */
export type Currency = 'USD' | 'LBP';
export type PriceTier = 'retail' | 'wholesale' | 'vip';
export const PRICE_TIERS: PriceTier[] = ['retail', 'wholesale', 'vip'];

export type Role = 'owner' | 'subUser';
export type Millis = number | null;

export interface TierPrice {
  usdCents: number;
  /** Manually fixed LBP price; null = derive from USD × exchange rate. */
  lbp: number | null;
}
export type TierPrices = Record<PriceTier, TierPrice>;

export interface ImeiEntry {
  imei: string;
  status: 'available' | 'sold';
}

export interface Product {
  id: string;
  name: string;
  category: string;
  barcode: string;
  prices: TierPrices;
  costUsdCents: number;
  stock: number;
  /** Per-product low-stock threshold; null = use the store default. */
  minStock: number | null;
  supplierId: string | null;
  supplierName: string;
  expiryDate: string | null;
  imageUrl: string | null;
  imagePath: string | null;
  imeiTracking: boolean;
  imeis: ImeiEntry[];
  lastMovementId: string | null;
  /** Archived products keep their stock and history but cannot be sold or purchased. */
  status: ProductStatus;
  archivedAt: Millis;
  createdAt: Millis;
  updatedAt: Millis;
}

export type ProductStatus = 'active' | 'archived';

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  creditLimitUsdCents: number;
  debtUsdCents: number;
  totalPurchasesUsdCents: number;
  lastLedgerId: string | null;
  createdAt: Millis;
  updatedAt: Millis;
}

export type LedgerType = 'opening' | 'creditSale' | 'settlement' | 'payment' | 'refund' | 'adjustment';

export interface CustomerLedgerEntry {
  id: string;
  customerId: string;
  customerName: string;
  type: LedgerType;
  /** Signed: positive increases debt, negative reduces it. */
  amountUsdCents: number;
  /** Debt after this entry; null when written offline with an atomic increment. */
  balanceAfterUsdCents: number | null;
  paidUsdCents: number;
  paidLbp: number;
  refId: string | null;
  refNumber: string | null;
  note: string;
  localDate: string;
  createdAt: Millis;
  createdBy: string;
  createdByName: string;
}

export interface Supplier {
  id: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  /** Open balance we owe the supplier (sum of remaining purchase amounts). */
  balanceUsdCents: number;
  createdAt: Millis;
  updatedAt: Millis;
}

export interface PurchaseItem {
  productId: string;
  name: string;
  quantity: number;
  unitCostUsdCents: number;
  returnedQty: number;
}

export type BillStatus = 'unpaid' | 'partial' | 'paid';

export interface Purchase {
  id: string;
  number: string;
  supplierId: string;
  supplierName: string;
  date: string;
  dueDate: string | null;
  items: PurchaseItem[];
  totalUsdCents: number;
  returnedUsdCents: number;
  paidUsdCents: number;
  remainingUsdCents: number;
  status: BillStatus;
  updateCost: boolean;
  note: string;
  createdAt: Millis;
  createdBy: string;
  createdByName: string;
}

export interface PurchaseReturn {
  id: string;
  purchaseId: string;
  purchaseNumber: string;
  supplierId: string;
  supplierName: string;
  items: { productId: string; name: string; quantity: number; unitCostUsdCents: number }[];
  amountUsdCents: number;
  note: string;
  localDate: string;
  createdAt: Millis;
  createdBy: string;
  createdByName: string;
}

export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'other';

export interface SupplierPayment {
  id: string;
  supplierId: string;
  supplierName: string;
  currency: Currency;
  /** Amount in the payment currency (cents for USD, pounds for LBP). */
  amount: number;
  amountUsdCents: number;
  exchangeRate: number;
  method: PaymentMethod;
  appliedTo: { purchaseId: string; purchaseNumber: string; amountUsdCents: number }[];
  note: string;
  localDate: string;
  createdAt: Millis;
  createdBy: string;
  createdByName: string;
}

export interface SaleItem {
  productId: string;
  name: string;
  quantity: number;
  tier: PriceTier;
  unitUsdCents: number;
  unitLbp: number;
  originalUnitUsdCents: number;
  /** Discount per unit vs the tier price (never negative). */
  discountUsdCents: number;
  costUsdCents: number;
  imei: string | null;
  returnedQty: number;
}

export type SaleKind = 'cash' | 'credit';

export interface SalePayment {
  /** Money physically received into the drawer for this sale. */
  receivedUsdCents: number;
  receivedLbp: number;
  /** Credit sales and debt lines. */
  previousDebtUsdCents: number;
  settledPreviousUsdCents: number;
  /** Unpaid part of this sale's products (credit sales). */
  unpaidUsdCents: number;
  debtAddedUsdCents: number;
  debtAfterUsdCents: number | null;
}

export interface Sale {
  id: string;
  invoiceNumber: string;
  kind: SaleKind;
  currency: Currency;
  exchangeRate: number;
  items: SaleItem[];
  /** Products only (after line discounts). A previous-debt line is never revenue. */
  totalUsdCents: number;
  totalLbp: number;
  discountUsdCents: number;
  costUsdCents: number;
  customerId: string | null;
  customerName: string;
  payment: SalePayment;
  returnedUsdCents: number;
  returnedDebtUsdCents: number;
  refundedUsdCents: number;
  refundedLbp: number;
  returnStatus: 'none' | 'partial' | 'full';
  lastReturnId: string | null;
  offline: boolean;
  localDate: string;
  createdAt: Millis;
  createdBy: string;
  createdByName: string;
}

export interface SaleReturn {
  id: string;
  number: string;
  saleId: string;
  saleInvoiceNumber: string;
  customerId: string | null;
  customerName: string;
  items: { productId: string; name: string; quantity: number; unitUsdCents: number; costUsdCents: number; imei: string | null }[];
  amountUsdCents: number;
  refundUsdCents: number;
  refundLbp: number;
  debtReducedUsdCents: number;
  reason: string;
  localDate: string;
  createdAt: Millis;
  createdBy: string;
  createdByName: string;
}

export type MovementType = 'sale' | 'return' | 'purchase' | 'purchaseReturn' | 'adjustment' | 'initial';

export interface StockMovement {
  id: string;
  productId: string;
  productName: string;
  type: MovementType;
  /** Signed quantity. */
  quantity: number;
  stockAfter: number | null;
  refId: string | null;
  refNumber: string | null;
  note: string;
  localDate: string;
  createdAt: Millis;
  createdBy: string;
  createdByName: string;
}

export type CashTxType =
  | 'sale'
  | 'debtPayment'
  | 'refund'
  | 'deposit'
  | 'expense'
  | 'withdrawal'
  | 'adjustment'
  | 'supplierPayment';

export interface CashTransaction {
  id: string;
  type: CashTxType;
  /** Signed amounts: positive = into the drawer. */
  usdCents: number;
  lbp: number;
  balanceAfter: { usdCents: number; lbp: number } | null;
  category: string;
  note: string;
  refId: string | null;
  refNumber: string | null;
  localDate: string;
  createdAt: Millis;
  createdBy: string;
  createdByName: string;
}

export interface CashboxSummary {
  usdCents: number;
  lbp: number;
  lastTxId: string | null;
  updatedAt: Millis;
}

export type PrintFormat = 'thermal80' | 'a4';

export interface TelegramEvents {
  sales: boolean;
  returns: boolean;
  cash: boolean;
  lowStock: boolean;
}

export interface StoreSettings {
  storeName: string;
  storeAddress: string;
  storePhone: string;
  logoUrl: string | null;
  logoPath: string | null;
  receiptFooter: string;
  printFormat: PrintFormat;
  exchangeRate: number;
  defaultCurrency: Currency;
  lowStockAlert: boolean;
  lowStockThreshold: number;
  telegram: { enabled: boolean; events: TelegramEvents };
  updatedAt: Millis;
}

export interface UserProfile {
  uid: string;
  email: string;
  fullName: string;
  role: Role;
  tenantId: string;
  isActive: boolean;
  permissions: PermissionMap;
  storeName: string;
  subdomain: string;
  phone: string;
  claimsVersion: number;
  createdAt: Millis;
}

export interface Subscription {
  activated: boolean;
  lifetime: boolean;
  startsAt: Millis;
  endsAt: Millis;
  updatedAt: Millis;
}
