import { httpsCallable } from 'firebase/functions';
import { firebase } from '@/firebase/app';
import type { PermissionMap } from '@/constants/permissions';
import { withoutUndefined } from './callableData';

/** Typed wrappers for the callable Cloud Functions (see functions/src). */
function callable<Req, Res>(name: string) {
  return async (data: Req): Promise<Res> => {
    const fn = httpsCallable<Req, Res>(firebase.functions, name, { timeout: 60_000 });
    const result = await fn(withoutUndefined(data));
    return result.data;
  };
}

export interface SignupInput {
  fullName: string;
  storeName: string;
  subdomain: string;
  phone: string;
}

export interface AdminAccount {
  uid: string;
  email: string;
  fullName: string;
  storeName: string;
  subdomain: string;
  phone: string;
  createdAt: number | null;
  lastSignInAt: number | null;
  subUserCount: number;
  subscription: { activated: boolean; lifetime: boolean; startsAt: number | null; endsAt: number | null };
}

export type SubscriptionAction =
  | { action: 'activate'; days: number }
  | { action: 'extend'; days: number }
  | { action: 'lifetime' }
  | { action: 'deactivate' };

type Ok = { ok: true };
type Tier = 'retail' | 'wholesale' | 'vip';
type TierPriceInput = { usdCents: number; lbp: number | null };
type PricesInput = { retail: TierPriceInput; wholesale: TierPriceInput; vip: TierPriceInput };

export interface CheckoutCall {
  saleId: string;
  kind: 'cash' | 'credit';
  currency: 'USD' | 'LBP';
  rate: number;
  customerId: string | null;
  debtLineUsdCents: number | null;
  lines: {
    productId: string;
    tier: Tier;
    quantity: number;
    customUsdCents: number | null;
    imei: string | null;
    expectedUnitUsdCents?: number;
    expectedUnitLbp?: number;
  }[];
  expectedTotalUsdCents: number;
  cash?: { receivedUsdCents: number; receivedLbp: number };
  credit?: { paidUsdCents: number; paidLbp: number };
  clientCreatedAtMs?: number;
  offlineRef?: string | null;
}

export interface CheckoutResponse {
  sale: Record<string, unknown>;
  duplicate: boolean;
}

export interface ProductFieldsCall {
  name: string;
  category: string;
  barcode: string;
  prices: PricesInput;
  costUsdCents: number;
  minStock: number | null;
  supplierId: string | null;
  supplierName: string;
  expiryDate: string | null;
  imeiTracking: boolean;
}

export interface ImportRowCall {
  name: string;
  barcode: string;
  category: string;
  prices: PricesInput;
  costUsdCents: number;
  stock: number;
  minStock: number | null;
  expiryDate: string | null;
}

/** Money and stock operations: executed and validated server-side (functions/src/pos). */
export const posApi = {
  checkout: callable<CheckoutCall, CheckoutResponse>('posCheckout'),
  processReturn: callable<
    { saleId: string; lines: { index: number; quantity: number }[]; reason: string },
    { saleReturn: Record<string, unknown> & { id: string } }
  >('posReturn'),
  createProduct: callable<{ product: ProductFieldsCall; initialStock: number; initialImeis: string[] }, { id: string }>('posCreateProduct'),
  importProducts: callable<{ rows: ImportRowCall[] }, { imported: number }>('posImportProducts'),
  setProductStatus: callable<{ productId: string; status: 'active' | 'archived' }, Ok>('posSetProductStatus'),
  deleteProduct: callable<{ productId: string }, Ok>('posDeleteProduct'),
  adjustStock: callable<
    {
      productId: string;
      mode: 'add' | 'remove' | 'set';
      quantity: number;
      unitCostUsdCents: number | null;
      payFromCashbox: boolean;
      imeisToAdd: string[];
      imeisToRemove: string[];
      note: string;
    },
    Ok
  >('posAdjustStock'),
  createCustomer: callable<
    {
      customer: { name: string; phone: string; email: string; address: string; creditLimitUsdCents: number };
      openingDebtUsdCents: number;
    },
    { id: string }
  >('posCreateCustomer'),
  payDebt: callable<{ customerId: string; usdCents: number; lbp: number; rate: number; note: string }, Ok>('posPayDebt'),
  adjustDebt: callable<{ customerId: string; newDebtUsdCents: number; note: string }, Ok>('posAdjustDebt'),
  cashMove: callable<{ type: 'deposit' | 'expense' | 'withdrawal'; usdCents: number; lbp: number; category: string; note: string }, Ok>(
    'posCashMove',
  ),
  adjustDrawer: callable<{ usdCents: number; lbp: number; note: string }, Ok>('posAdjustDrawer'),
  createPurchase: callable<
    {
      supplierId: string;
      date: string;
      dueDate: string | null;
      items: { productId: string; quantity: number; unitCostUsdCents: number }[];
      updateCost: boolean;
      paidNowUsdCents: number;
      payFromCashbox: boolean;
      note: string;
    },
    { id: string }
  >('posCreatePurchase'),
  paySupplier: callable<
    { supplierId: string; currency: 'USD' | 'LBP'; amount: number; rate: number; method: 'cash' | 'card' | 'transfer' | 'other'; note: string },
    Ok
  >('posPaySupplier'),
  returnToSupplier: callable<{ purchaseId: string; lines: { index: number; quantity: number }[]; note: string }, Ok>(
    'posReturnToSupplier',
  ),
};

export const api = {
  checkSignupAvailability: callable<{ subdomain: string; email: string }, { subdomainAvailable: boolean; emailAvailable: boolean }>(
    'checkSignupAvailability',
  ),
  completeSignup: callable<SignupInput, { tenantId: string }>('completeSignup'),
  refreshMyClaims: callable<Record<string, never>, { ok: true }>('refreshMyClaims'),
  createSubUser: callable<{ email: string; password: string; fullName: string; permissions: PermissionMap }, { uid: string }>(
    'createSubUser',
  ),
  updateSubUser: callable<
    { uid: string; fullName?: string; permissions?: PermissionMap; isActive?: boolean; password?: string },
    { ok: true }
  >('updateSubUser'),
  deleteSubUser: callable<{ uid: string }, { ok: true }>('deleteSubUser'),
  clearTenantData: callable<{ confirm: string }, { deleted: number }>('clearTenantData'),
  testTelegram: callable<Record<string, never>, { ok: true }>('testTelegram'),
  bootstrapSuperAdmin: callable<Record<string, never>, { ok: true }>('bootstrapSuperAdmin'),
  adminListAccounts: callable<Record<string, never>, { accounts: AdminAccount[] }>('adminListAccounts'),
  adminSetSubscription: callable<{ uid: string } & SubscriptionAction, { ok: true }>('adminSetSubscription'),
  adminDeleteAccount: callable<{ uid: string; confirm: string }, { ok: true }>('adminDeleteAccount'),
};
