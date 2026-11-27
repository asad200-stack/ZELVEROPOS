import { httpsCallable } from 'firebase/functions';
import { API_COMPAT_VERSION, APP_RELEASE_VERSION } from '@/constants/app';
import { isAdminPreviewBuild } from '@/domain/adminPreview';
import { customerReleaseCutoverAllowed } from '@/domain/previewAccess';
import { firebase } from '@/firebase/app';
import type { PermissionMap } from '@/constants/permissions';
import type { LookSlot, OnlineStoreConfig, PublicProduct, PublicStore, StatsRange, StoreBranding, StoreEvent, StoreStatsSummary } from '@/domain/onlineStore';
import type { FulfillmentMethod, OnlineOrder, ManualPayment, OrderStatus, PaymentMethod, PaymentStatus, ProductReview, PublicOrderReceipt, PublicOrderTracking, PublicReview, ReviewStatus, ReviewSummary, SalesSplit } from '@/domain/onlineOrders';
import { withoutUndefined } from './callableData';
import { requirePreviewCredential } from './previewCredential';

/** Typed wrappers for the callable Cloud Functions (see functions/src). */
/** What the owner sees of the Whish connection (the secret never comes back). */
export interface WhishPaymentsView {
  whish: { enabled: boolean; sandbox: boolean; channel: string; websiteUrl: string; hasSecret: boolean };
}

function callable<Req, Res>(name: string) {
  return async (data: Req): Promise<Res> => {
    const fn = httpsCallable<Req & { clientApiVersion: number; clientReleaseVersion: string }, Res>(firebase.functions, name, { timeout: 60_000 });
    const result = await fn(withoutUndefined({ ...(data as object), clientApiVersion: API_COMPAT_VERSION, clientReleaseVersion: APP_RELEASE_VERSION } as Req & { clientApiVersion: number; clientReleaseVersion: string }));
    return result.data;
  };
}

/** Customer builds call the POS function directly. The preview build must present its server credential. */
function posOperation<Req, Res>(operation: string) {
  if (!isAdminPreviewBuild(import.meta.env)) return callable<Req, Res>(operation);
  return async (data: Req): Promise<Res> => {
    const cred = requirePreviewCredential();
    return callable<{ credentialId: string; secret: string; operation: string; payload: Req }, Res>('previewPos')({
      credentialId: cred.credentialId,
      secret: cred.secret,
      operation,
      payload: data,
    });
  };
}

/** The preview bundle cannot start a customer release. The normal Super Admin app still can. */
function releaseCutover<Req, Res>(name: string) {
  if (!customerReleaseCutoverAllowed(isAdminPreviewBuild(import.meta.env))) {
    return async (): Promise<Res> => {
      throw new Error('preview-release-cutover-blocked');
    };
  }
  return callable<Req, Res>(name);
}

export interface SignupInput {
  fullName: string;
  storeName: string;
  subdomain: string;
  phone: string;
  /** Captured from a Marketing Partner's referral link (?ref=CODE), if any. */
  referralCode?: string;
}

export interface AdminAccount {
  uid: string;
  tenantId?: string;
  email: string;
  fullName: string;
  storeName: string;
  subdomain: string;
  phone: string;
  createdAt: number | null;
  lastSignInAt: number | null;
  subUserCount: number;
  internalDemo?: boolean;
  subscription: {
    activated: boolean;
    lifetime: boolean;
    startsAt: number | null;
    endsAt: number | null;
    trial?: boolean;
    status?: string | null;
  };
}

export type SubscriptionAction =
  | { action: 'activate'; days: number }
  | { action: 'extend'; days: number }
  | { action: 'lifetime' }
  | { action: 'deactivate' };

type Ok = { ok: true; duplicate?: boolean };
type Tier = 'retail' | 'wholesale' | 'vip';
type TierPriceInput = { usdCents: number; lbp: number | null };
type PricesInput = { retail: TierPriceInput; wholesale: TierPriceInput; vip: TierPriceInput };

export interface CheckoutCall {
  saleId: string;
  kind: 'cash' | 'credit';
  currency: 'USD' | 'LBP';
  tier?: Tier;
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
  /** Cart label. Omitted when the cashier left the default number. */
  orderLabel?: string;
  note?: string;
  cash?: { receivedUsdCents: number; receivedLbp: number; changeUsdCents?: number; changeLbp?: number };
  credit?: { paidUsdCents: number; paidLbp: number };
  /** Explicit checkout-level discount (cash only). Omitted/0 = no discount. */
  checkoutDiscountUsdCents?: number;
  checkoutDiscountKind?: 'fixed' | 'roundDown' | null;
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
  /** False when the number is a placeholder because the purchase cost was not provided. */
  costKnown?: boolean;
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
  imageUrl?: string | null;
}

/** Money and stock operations: executed and validated server-side (functions/src/pos). */
export const posApi = {
  checkout: posOperation<CheckoutCall, CheckoutResponse>('posCheckout'),
  /** Wakes the checkout function before Complete sale (no data read or written). Not used by preview builds. */
  warmCheckout: callable<{ warmup: true }, { warm: boolean }>('posCheckout'),
  processReturn: posOperation<
    { clientOperationId: string; saleId: string; lines: { index: number; quantity: number }[]; reason: string },
    { saleReturn: Record<string, unknown> & { id: string }; duplicate: boolean }
  >('posReturn'),
  createProduct: posOperation<
    { clientOperationId: string; product: ProductFieldsCall; initialStock: number; initialImeis: string[] },
    { id: string; duplicate: boolean }
  >('posCreateProduct'),
  createProductGroup: posOperation<
    {
      clientOperationId: string;
      product: Omit<ProductFieldsCall, 'barcode' | 'imeiTracking'>;
      axes: { name: string; values: string[] }[];
      rows: { values: string[]; stock: number; barcode: string; retailUsdCents: number | null }[];
    },
    { groupId: string; ids: string[]; duplicate: boolean }
  >('posCreateProductGroup'),
  addProductOptions: posOperation<
    {
      clientOperationId: string;
      groupId: string;
      rows: { values: string[]; stock: number; barcode: string; retailUsdCents: number | null }[];
    },
    { ids: string[]; duplicate: boolean }
  >('posAddProductOptions'),
  importProducts: posOperation<{ rows: ImportRowCall[] }, { imported: number }>('posImportProducts'),
  setProductStatus: posOperation<{ productId: string; status: 'active' | 'archived' }, Ok>('posSetProductStatus'),
  deleteProduct: posOperation<{ productId: string }, Ok>('posDeleteProduct'),
  setStockLinks: posOperation<{ productId: string; links: { productId: string; quantity: number }[] }, Ok>('posSetStockLinks'),
  adjustStock: posOperation<
    {
      clientOperationId: string;
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
  createCustomer: posOperation<
    {
      clientOperationId: string;
      customer: { name: string; phone: string; email: string; address: string; creditLimitUsdCents: number };
      openingDebtUsdCents: number;
    },
    { id: string; duplicate: boolean }
  >('posCreateCustomer'),
  payDebt: posOperation<
    { clientOperationId: string; customerId: string; usdCents: number; lbp: number; rate: number; note: string },
    Ok
  >('posPayDebt'),
  adjustDebt: posOperation<{ clientOperationId: string; customerId: string; newDebtUsdCents: number; note: string }, Ok>('posAdjustDebt'),
  cashMove: posOperation<
    {
      clientOperationId: string;
      type: 'deposit' | 'expense' | 'withdrawal';
      usdCents: number;
      lbp: number;
      category: string;
      note: string;
    },
    Ok
  >('posCashMove'),
  adjustDrawer: posOperation<{ clientOperationId: string; usdCents: number; lbp: number; note: string }, Ok>('posAdjustDrawer'),
  createPurchase: posOperation<
    {
      clientOperationId: string;
      supplierId: string;
      date: string;
      dueDate: string | null;
      items: { productId: string; quantity: number; unitCostUsdCents: number }[];
      updateCost: boolean;
      paidNowUsdCents: number;
      payFromCashbox: boolean;
      note: string;
    },
    { id: string; duplicate: boolean }
  >('posCreatePurchase'),
  paySupplier: posOperation<
    {
      clientOperationId: string;
      supplierId: string;
      currency: 'USD' | 'LBP';
      amount: number;
      rate: number;
      method: 'cash' | 'card' | 'transfer' | 'other';
      note: string;
    },
    Ok
  >('posPaySupplier'),
  returnToSupplier: posOperation<
    { clientOperationId: string; purchaseId: string; lines: { index: number; quantity: number }[]; note: string },
    Ok
  >('posReturnToSupplier'),
};

export const api = {
  checkSignupAvailability: callable<{ subdomain: string }, { subdomainAvailable: boolean }>('checkSignupAvailability'),
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
  adminProvisionInternalDemo: callable<Record<string, never>, { ok: true; tenantId: string; created: boolean }>('adminProvisionInternalDemo'),
  /** Zelvero AI (internal demo only). Server resolves the store and refuses everyone else. */
  aiCopilotAccess: callable<Record<string, never>, { allowed: true; tenantId: string }>('aiCopilotAccess'),
  aiCopilotRead: callable<Record<string, unknown>, unknown>('aiCopilotRead'),
  // Online Store (Milestone A). The server resolves the tenant; never send one.
  onlineStoreGetConfig: callable<Record<string, never>, { config: OnlineStoreConfig; products: PublicProduct[]; productsTruncated: boolean }>('onlineStoreGetConfig'),
  onlineStoreSaveDraft: callable<{ enabled: boolean; draft: StoreBranding }, { config: OnlineStoreConfig }>('onlineStoreSaveDraft'),
  onlineStoreSetSlug: callable<{ slug: string }, { config: OnlineStoreConfig }>('onlineStoreSetSlug'),
  onlineStorePublish: callable<Record<string, never>, { config: OnlineStoreConfig }>('onlineStorePublish'),
  onlineStoreUnpublish: callable<Record<string, never>, { config: OnlineStoreConfig }>('onlineStoreUnpublish'),
  onlineStoreSetProductVisibility: callable<{ productIds: string[] }, { config: OnlineStoreConfig }>('onlineStoreSetProductVisibility'),
  onlineStoreSaveListing: callable<
    {
      productId: string;
      description: string;
      compareAtUsdCents: number | null;
      cutoutUrl?: string;
      lookUrl?: string;
      lookSlot?: LookSlot | '';
      lookHem?: number;
    },
    { config: OnlineStoreConfig }
  >('onlineStoreSaveListing'),
  onlineStoreSetDomain: callable<{ domain: string }, { config: OnlineStoreConfig }>('onlineStoreSetDomain'),
  publicStoreByDomain: callable<{ domain: string }, { slug: string }>('publicStoreByDomain'),
  onlineStoreStats: callable<{ days: StatsRange }, StoreStatsSummary & { names: Record<string, string>; sales?: SalesSplit }>('onlineStoreStats'),
  publicTrackEvent: callable<{ slug: string; type: StoreEvent; productId?: string }, { ok: true }>('publicTrackEvent'),
  publicStoreCatalog: callable<
    { slug: string },
    { store: PublicStore; products: PublicProduct[]; bestSellerIds?: string[]; payments?: { whish: boolean } }
  >('publicStoreCatalog'),
  publicPayOrder: callable<{ slug: string; ref: string; phone: string }, { ref: string; paymentStatus: PaymentStatus; payUrl?: string }>('publicPayOrder'),
  publicCheckPayment: callable<{ slug: string; ref: string; phone: string }, { ref: string; paymentStatus: PaymentStatus }>('publicCheckPayment'),
  onlineOrdersCheckPayment: callable<{ orderId: string }, { paymentStatus: PaymentStatus }>('onlineOrdersCheckPayment'),
  onlineStoreGetPayments: callable<Record<string, never>, WhishPaymentsView>('onlineStoreGetPayments'),
  onlineStoreSetWhish: callable<
    { enabled: boolean; sandbox: boolean; channel: string; secret: string; websiteUrl: string },
    WhishPaymentsView
  >('onlineStoreSetWhish'),
  publicPlaceOrder: callable<
    {
      slug: string;
      lines: { productId: string; qty: number }[];
      name: string;
      phone: string;
      address: string;
      note: string;
      fulfillment: FulfillmentMethod;
      payment: PaymentMethod;
      zoneId?: string;
    },
    PublicOrderReceipt
  >('publicPlaceOrder'),
  onlineOrdersList: callable<{ status?: OrderStatus; limit?: number }, { orders: OnlineOrder[] }>('onlineOrdersList'),
  onlineOrdersSetStatus: callable<{ orderId: string; status: OrderStatus }, { order: OnlineOrder }>('onlineOrdersSetStatus'),
  onlineOrdersSettlePayment: callable<{ orderId: string; how: ManualPayment }, { order: OnlineOrder }>('onlineOrdersSettlePayment'),
  publicTrackOrder: callable<{ slug: string; ref: string; phone: string }, PublicOrderTracking>('publicTrackOrder'),
  publicSubmitReview: callable<{ slug: string; ref: string; phone: string; productId: string; rating: number; text: string }, { ok: true }>('publicSubmitReview'),
  publicProductReviews: callable<{ slug: string; productId: string }, { reviews: PublicReview[]; summary: ReviewSummary }>('publicProductReviews'),
  onlineReviewsList: callable<{ status?: ReviewStatus; limit?: number }, { reviews: ProductReview[] }>('onlineReviewsList'),
  onlineReviewsSetStatus: callable<{ reviewId: string; status: ReviewStatus }, { review: ProductReview }>('onlineReviewsSetStatus'),
  issuePreviewCredential: callable<Record<string, never>, { credentialId: string; secret: string; tenantId: string; expiresAtMs: number }>('issuePreviewCredential'),
  adminListLeads: callable<
    Record<string, never>,
    {
      leads: {
        id: string;
        name: string;
        businessName: string;
        email: string;
        phone: string;
        businessType: string;
        source: string;
        status: string;
        referralCode: string | null;
        assignedTo: string | null;
        notes: string;
        interestedFeatures: string[];
        createdAt: number | null;
        updatedAt: number | null;
      }[];
    }
  >('adminListLeads'),
  adminSetLeadStatus: callable<{ leadId: string; status: string; notes?: string; assignedTo?: string }, { ok: true }>('adminSetLeadStatus'),
  adminListTrials: callable<
    Record<string, never>,
    {
      trials: {
        tenantId: string;
        business: string;
        owner: string;
        ownerEmail: string;
        startDate: number | null;
        endDate: number | null;
        daysRemaining: number;
        status: string;
        referralCode: string | null;
        converted: boolean;
      }[];
    }
  >('adminListTrials'),
  adminSetSubscription: callable<{ uid: string } & SubscriptionAction, { ok: true; writesEnabled: boolean; closed: boolean }>('adminSetSubscription'),
  adminDeleteAccount: callable<{ uid: string; confirm: string }, { ok: true; accountDeleted: boolean; tenantId: string; storageCleanup: 'complete' | 'pending'; outcome: 'complete' | 'storage-failed' | 'account-remains' | 'unverified' }>('adminDeleteAccount'),
  adminRetryStorageCleanup: callable<{ tenantId: string }, { ok: true; accountDeleted: boolean; storageCleanup: 'complete' | 'pending'; outcome: 'complete' | 'storage-failed' | 'account-remains' | 'unverified' }>('adminRetryStorageCleanup'),
  adminListStorageCleanup: callable<Record<string, never>, {
    records: {
      tenantId: string;
      storageCleanup: 'pending';
      lastOutcome: 'storage-failed' | 'account-remains' | 'unverified' | null;
      updatedAt: number | null;
      lastAttemptAt: number | null;
    }[];
  }>('adminListStorageCleanup'),
  createRelease: callable<
    { version: string; title: string; notes: string; releaseType: 'patch' | 'minor' | 'major'; buildId: string; gitSha?: string; requiresMigration?: boolean },
    { ok: true }
  >('createRelease'),
  setReleaseStatus: callable<{ version: string; status: 'testing' | 'ready' | 'draft' }, { ok: true }>('setReleaseStatus'),
  assignReleaseTenants: releaseCutover<{ version: string; tenantIds: string[]; confirm: string }, { ok: true; tenantCount: number }>('assignReleaseTenants'),
  releaseToEveryone: releaseCutover<{ version: string; confirm: string; emergency?: boolean; emergencyReason?: string }, { ok: true }>('releaseToEveryone'),
  pauseRelease: callable<{ version: string }, { ok: true }>('pauseRelease'),
  rollbackRelease: callable<{ fromVersion: string; toVersion: string; confirm: string }, { ok: true; rollbackSafe: boolean }>('rollbackRelease'),
  setMinSupportedVersion: callable<{ version: string }, { ok: true }>('setMinSupportedVersion'),
  getMyReleaseAssignment: callable<
    Record<string, never>,
    {
      assignedVersion: string | null;
      productionVersion: string | null;
      stagingVersion: string | null;
      minSupportedVersion: string | null;
      paused: boolean;
      title: string | null;
      notes: string | null;
      buildId: string | null;
      status?: string | null;
    }
  >('getMyReleaseAssignment'),
  listReleases: callable<
    Record<string, never>,
    {
      manifest: {
        productionVersion: string | null;
        previousProductionVersion: string | null;
        stagingVersion: string | null;
        minSupportedVersion: string | null;
        paused: boolean;
      };
      releases: {
        version: string;
        buildId: string;
        gitSha: string;
        title: string;
        notes: string;
        releaseType: string;
        status: string;
        targetType: string;
        targetTenantIds: string[];
        createdAt: number | null;
        releasedAt: number | null;
        releasedBy: string | null;
        requiresMigration: boolean;
        rollbackSafe: boolean;
      }[];
      audit: { id: string; action: string; version: string; at: number | null; actorUid: string }[];
    }
  >('listReleases'),
  checkReleaseTreeRetention: callable<{ trees: string[] }, { deletable: string[]; kept: string[] }>('checkReleaseTreeRetention'),
  listFeatureCatalog: callable<Record<string, never>, FeatureCatalogResult>('listFeatureCatalog'),
  markFeatureReady: callable<{ featureId: string }, { ok: true; duplicate: boolean }>('markFeatureReady'),
  publishFeature: callable<
    { featureId: string; confirmPublication: true; confirmAllEligible: boolean; allEligible: boolean; tenantIds: string[] },
    { ok: true; duplicate: boolean; tenants: number }
  >('publishFeature'),
  pauseFeature: callable<{ featureId: string; confirm: true }, { ok: true }>('pauseFeature'),
  rollbackFeature: callable<{ featureId: string; confirm: true }, { ok: true }>('rollbackFeature'),
  grantFeaturePurchase: callable<{ featureId: string; tenantId: string; confirm: true }, { ok: true }>('grantFeaturePurchase'),
  setFeatureKillSwitch: callable<{ killed: boolean; confirm: true }, { ok: true; killed: boolean }>('setFeatureKillSwitch'),
  recordFeaturePreview: callable<{ featureId: string }, { ok: true; path: string }>('recordFeaturePreview'),
  adminFeatureBoard: callable<Record<string, never>, FeatureBoard>('adminFeatureBoard'),
  adminSetTenantFeatures: callable<{ tenantId: string; grant: string[]; revoke: string[]; confirm: true }, { ok: true; changed: number }>(
    'adminSetTenantFeatures',
  ),
  listMyFeatureUpdates: callable<Record<string, never>, { updates: CustomerFeatureUpdate[] }>('listMyFeatureUpdates'),
  activateMyFeature: callable<{ featureId: string }, { ok: true; duplicate: boolean; reloadRequired: boolean; stages: Array<'checked' | 'entitled' | 'active'> }>(
    'activateMyFeature',
  ),
  /* ---------------------------------------------------- Marketing Partner & Client Assignment */
  grantMarketingPartner: callable<
    { email: string; name: string; contactAuthorized: boolean },
    { ok: true; partnerId: string; referralCode: string; created: boolean; resetLink: string | null }
  >('grantMarketingPartner'),
  revokeMarketingPartner: callable<{ partnerId: string }, { ok: true }>('revokeMarketingPartner'),
  adminListPartners: callable<Record<string, never>, { partners: MarketingPartnerRow[] }>('adminListPartners'),
  adminListClientAssignments: callable<
    { group?: 'all' | 'mine' | 'partner' | 'unassigned'; search?: string; partnerId?: string },
    { rows: ClientAssignmentRow[] }
  >('adminListClientAssignments'),
  adminAssignClient: callable<
    { tenantId: string; assignTo: 'superAdmin' | 'partner'; partnerId?: string; confirm: string },
    { ok: true }
  >('adminAssignClient'),
  adminListClientAssignmentAudit: callable<
    { tenantId?: string; limit?: number },
    { entries: ClientAssignmentAuditEntry[] }
  >('adminListClientAssignmentAudit'),
  partnerListMyClients: callable<Record<string, never>, { clients: PartnerClientRow[] }>('partnerListMyClients'),
  adminBackfillClientAssignments: callable<Record<string, never>, { scanned: number; created: number; skipped: number }>(
    'adminBackfillClientAssignments',
  ),
};

export interface MarketingPartnerRow {
  uid: string;
  email: string;
  name: string;
  referralCode: string;
  contactAuthorized: boolean;
  active: boolean;
  createdAtMs: number | null;
}

export interface ClientAssignmentRow {
  tenantId: string;
  storeName: string;
  ownerEmail: string;
  ownerName: string;
  createdAtMs: number | null;
  subscriptionStatus: 'trial' | 'active' | 'expired' | 'unknown';
  acquisition: { source: 'referral' | 'direct'; partnerId: string | null; referralCode: string | null };
  assignedTo: 'superAdmin' | 'partner' | null;
  assignedPartnerId: string | null;
  assignedBy: string | null;
  assignedAtMs: number | null;
}

export interface ClientAssignmentAuditEntry {
  id: string;
  action: string;
  actorUid: string;
  tenantId?: string;
  partnerId?: string;
  meta?: Record<string, unknown>;
  atMs: number;
}

export interface PartnerClientRow {
  tenantId: string;
  storeName: string;
  signupAtMs: number | null;
  subscriptionStatus: 'trial' | 'active' | 'expired' | 'unknown';
  activationStatus: 'active' | 'inactive';
  contact: { email: string; phone: string } | null;
}

export interface FeatureCatalogItem {
  id: string;
  title: string;
  description: string;
  version: string;
  icon: string;
  screenshots: string[];
  category: string;
  classification: 'new' | 'existing' | 'improvement';
  pricing: 'free' | 'paid';
  priceUsdCents: number | null;
  capabilities: string[];
  requirements: string[];
  compatibility: string;
  customerExecution: 'unavailable' | 'ready';
  navPath: string | null;
  navLabel: string;
  activation: 'server';
  reloadRequired: boolean;
  publication: 'internal_testing' | 'ready' | 'published' | 'paused' | 'rolled_back';
  testingStatus: 'untested' | 'in_testing' | 'passed';
  audienceCount: number;
  allEligible: boolean;
  history: { at: number; action: string; version: string; actorUid: string; tenantCount: number }[];
  blockers: string[];
}

export interface FeatureDelivery {
  featureId: string;
  notified: number;
  active: number;
  paused: number;
  revoked: number;
}

export interface FeatureCatalogResult {
  killed: boolean;
  features: FeatureCatalogItem[];
  delivery: FeatureDelivery[];
}

export interface FeatureBoard {
  features: { id: string; title: string; description: string; version: string; base: boolean; available: boolean; blockedReason: string | null }[];
  tenants: { tenantId: string; storeName: string; email: string; internalDemo: boolean; features: Record<string, string> }[];
  killed: boolean;
}

export interface CustomerFeatureUpdate {
  featureId: string;
  title: string;
  description: string;
  version: string;
  icon: string;
  screenshots: string[];
  capabilities: string[];
  requirements: string[];
  compatibility: string;
  pricing: 'free' | 'paid';
  priceUsdCents: number | null;
  status: 'notified' | 'active' | 'paused' | 'revoked' | 'unavailable';
  navPath: string | null;
  navLabel: string;
  reloadRequired: boolean;
  canActivate: boolean;
  canRequestPurchase: boolean;
}
