/**
 * Reusable feature catalog, publication, and activation rules.
 * Framework-free so Cloud Functions share this file with the POS.
 * Code deployment, publication, entitlement, and activation are separate decisions.
 */

export const FEATURE_ID = /^[a-z][a-z0-9_]{1,40}$/;
export const RESERVED_TEST_TENANT = 'zelveroAiInternal';

export const PUBLICATION_STATES = ['internal_testing', 'ready', 'published', 'paused', 'rolled_back'] as const;
export type Publication = (typeof PUBLICATION_STATES)[number];

export const ENTITLEMENT_STATES = ['notified', 'active', 'paused', 'revoked'] as const;
export type EntitlementStatus = (typeof ENTITLEMENT_STATES)[number];

export type FeatureClass = 'new' | 'existing' | 'improvement';
export type FeaturePricing = 'free' | 'paid';
export type CustomerExecution = 'unavailable' | 'ready';
export type TestingStatus = 'untested' | 'in_testing' | 'passed';

export interface FeatureDefinition {
  id: string;
  title: string;
  description: string;
  version: string;
  icon: string;
  screenshots: string[];
  category: string;
  classification: FeatureClass;
  pricing: FeaturePricing;
  priceUsdCents: number | null;
  capabilities: string[];
  requirements: string[];
  compatibility: string;
  /** Customer callables exist and passed their own tests. Internal testing is not enough. */
  customerExecution: CustomerExecution;
  /** POS route shown only after the customer activates the feature. Null hides it. */
  navPath: string | null;
  navLabel: string;
  testingStatus: TestingStatus;
  /** Server activation only. The client must not pretend a package was downloaded. */
  activation: 'server';
  reloadRequired: boolean;
}

export interface FeatureRecord {
  version: string;
  publication: Publication;
  audience: { allEligible: boolean; tenantIds: string[] };
  receipt: string | null;
  testingStatus: TestingStatus;
  history: FeatureHistoryEntry[];
}

export interface FeatureHistoryEntry {
  at: number;
  action: string;
  version: string;
  actorUid: string;
  tenantCount: number;
}

export interface CustomerAccount {
  tenantId: string;
  storeName: string;
  internalDemo: boolean;
  activated: boolean;
  lifetime: boolean;
  endsAt: number | null;
}

export interface EntitlementRecord {
  tenantId: string;
  featureId: string;
  version: string;
  pricing: FeaturePricing;
  priceUsdCents: number | null;
  status: EntitlementStatus;
  paidGrant: boolean;
}

const FLOW: Record<Publication, Publication[]> = {
  internal_testing: ['ready'],
  ready: ['published', 'internal_testing'],
  published: ['paused', 'rolled_back'],
  paused: ['published', 'rolled_back'],
  rolled_back: [],
};

export function canTransitionPublication(from: Publication, to: Publication): boolean {
  if (from === to) return true;
  return FLOW[from].includes(to);
}

/** A stored record from an older version does not keep its publication. */
export function effectiveRecord(definition: FeatureDefinition, stored: FeatureRecord | null): FeatureRecord {
  if (!stored || stored.version !== definition.version) {
    return {
      version: definition.version,
      publication: 'internal_testing',
      audience: { allEligible: false, tenantIds: [] },
      receipt: null,
      testingStatus: definition.testingStatus,
      history: stored?.history ?? [],
    };
  }
  return stored;
}

export function isEligibleCustomer(account: CustomerAccount, now: number): boolean {
  if (account.tenantId === RESERVED_TEST_TENANT) return false;
  if (account.internalDemo) return false;
  if (!account.activated) return false;
  if (account.lifetime) return true;
  return account.endsAt != null && account.endsAt > now;
}

export function publicationBlockers(definition: FeatureDefinition, killed: boolean): string[] {
  const blockers: string[] = [];
  if (killed) blockers.push('feature.blocked.killed');
  if (definition.customerExecution !== 'ready') blockers.push('feature.blocked.customerPath');
  if (definition.testingStatus !== 'passed') blockers.push('feature.blocked.testing');
  if (definition.pricing === 'paid' && (definition.priceUsdCents == null || definition.priceUsdCents <= 0)) {
    blockers.push('feature.blocked.price');
  }
  return blockers;
}

export function receiptFor(input: {
  featureId: string;
  version: string;
  tenantIds: string[];
  allEligible: boolean;
  pricing: FeaturePricing;
}): string {
  const tenants = [...input.tenantIds].sort().join(',');
  return `${input.featureId}|${input.version}|${input.allEligible ? 'all' : tenants}|${input.pricing}`;
}

export interface PublishInput {
  definition: FeatureDefinition;
  record: FeatureRecord;
  killed: boolean;
  confirmPublication: boolean;
  confirmAllEligible: boolean;
  allEligible: boolean;
  tenantIds: string[];
  accounts: CustomerAccount[];
  now: number;
  actorUid: string;
}

export type PublishPlan =
  | { ok: false; reason: string }
  | {
      ok: true;
      duplicate: boolean;
      record: FeatureRecord;
      entitlements: EntitlementRecord[];
    };

export function planPublish(input: PublishInput): PublishPlan {
  const blockers = publicationBlockers(input.definition, input.killed);
  if (blockers.length) return { ok: false, reason: blockers[0]! };
  if (!input.confirmPublication) return { ok: false, reason: 'feature.blocked.confirm' };
  const requested = [...new Set(input.tenantIds.map((id) => id.trim()).filter(Boolean))];
  if (requested.some((id) => id === RESERVED_TEST_TENANT)) return { ok: false, reason: 'feature.blocked.testTenant' };
  if (input.allEligible && !input.confirmAllEligible) return { ok: false, reason: 'feature.blocked.confirmAll' };
  const eligible = input.accounts.filter((account) => isEligibleCustomer(account, input.now));
  const eligibleIds = new Set(eligible.map((account) => account.tenantId));
  const tenantIds = input.allEligible ? [...eligibleIds] : requested;
  if (!input.allEligible && tenantIds.some((id) => !eligibleIds.has(id))) return { ok: false, reason: 'feature.blocked.customer' };
  if (tenantIds.length === 0) return { ok: false, reason: 'feature.blocked.none' };
  const receipt = receiptFor({
    featureId: input.definition.id,
    version: input.definition.version,
    tenantIds,
    allEligible: input.allEligible,
    pricing: input.definition.pricing,
  });
  if (input.record.publication === 'published' && input.record.receipt === receipt) {
    return { ok: true, duplicate: true, record: input.record, entitlements: [] };
  }
  if (!canTransitionPublication(input.record.publication, 'published') || (input.record.publication !== 'ready' && input.record.publication !== 'paused')) {
    return { ok: false, reason: 'feature.blocked.transition' };
  }
  const entitlements: EntitlementRecord[] = tenantIds.map((tenantId) => ({
    tenantId,
    featureId: input.definition.id,
    version: input.definition.version,
    pricing: input.definition.pricing,
    priceUsdCents: input.definition.priceUsdCents,
    status: 'notified',
    paidGrant: false,
  }));
  return {
    ok: true,
    duplicate: false,
    record: {
      ...input.record,
      version: input.definition.version,
      publication: 'published',
      audience: { allEligible: input.allEligible, tenantIds },
      receipt,
      history: history(input.record, 'published', input.definition.version, input.actorUid, tenantIds.length, input.now),
    },
    entitlements,
  };
}

export function planMarkReady(definition: FeatureDefinition, record: FeatureRecord, killed: boolean, actorUid: string, now: number): PublishPlan {
  const blockers = publicationBlockers(definition, killed);
  if (blockers.length) return { ok: false, reason: blockers[0]! };
  if (!canTransitionPublication(record.publication, 'ready')) return { ok: false, reason: 'feature.blocked.transition' };
  return {
    ok: true,
    duplicate: record.publication === 'ready',
    entitlements: [],
    record: {
      ...record,
      publication: 'ready',
      testingStatus: 'passed',
      history: history(record, 'ready', definition.version, actorUid, 0, now),
    },
  };
}

export function planPause(record: FeatureRecord, actorUid: string, now: number): { ok: true; record: FeatureRecord } | { ok: false; reason: string } {
  if (!canTransitionPublication(record.publication, 'paused')) return { ok: false, reason: 'feature.blocked.transition' };
  return {
    ok: true,
    record: {
      ...record,
      publication: 'paused',
      history: history(record, 'paused', record.version, actorUid, record.audience.tenantIds.length, now),
    },
  };
}

export function planRollback(record: FeatureRecord, actorUid: string, now: number): { ok: true; record: FeatureRecord } | { ok: false; reason: string } {
  if (!canTransitionPublication(record.publication, 'rolled_back')) return { ok: false, reason: 'feature.blocked.transition' };
  return {
    ok: true,
    record: {
      ...record,
      publication: 'rolled_back',
      receipt: null,
      history: history(record, 'rolled_back', record.version, actorUid, record.audience.tenantIds.length, now),
    },
  };
}

function history(record: FeatureRecord, action: string, version: string, actorUid: string, tenantCount: number, now: number): FeatureHistoryEntry[] {
  return [...record.history, { at: now, action, version, actorUid, tenantCount }].slice(-20);
}

export function planGrantPaid(input: {
  definition: FeatureDefinition;
  record: FeatureRecord;
  entitlement: EntitlementRecord | null;
  killed: boolean;
}): { ok: true; entitlement: EntitlementRecord } | { ok: false; reason: string } {
  if (input.killed || input.record.publication !== 'published') return { ok: false, reason: 'feature.blocked.transition' };
  if (input.definition.pricing !== 'paid') return { ok: false, reason: 'feature.blocked.notPaid' };
  if (!input.entitlement || input.entitlement.status === 'revoked') return { ok: false, reason: 'feature.blocked.customer' };
  if (input.entitlement.paidGrant) return { ok: true, entitlement: input.entitlement };
  return { ok: true, entitlement: { ...input.entitlement, paidGrant: true } };
}

export function planActivation(input: {
  definition: FeatureDefinition;
  record: FeatureRecord;
  entitlement: EntitlementRecord | null;
  killed: boolean;
}): { ok: true; duplicate: boolean; entitlement: EntitlementRecord } | { ok: false; reason: string } {
  if (input.killed) return { ok: false, reason: 'feature.blocked.killed' };
  if (input.definition.customerExecution !== 'ready') return { ok: false, reason: 'feature.blocked.customerPath' };
  if (input.record.publication !== 'published') return { ok: false, reason: 'feature.blocked.transition' };
  const entitlement = input.entitlement;
  if (!entitlement || entitlement.status === 'revoked' || entitlement.status === 'paused') {
    return { ok: false, reason: 'feature.blocked.customer' };
  }
  if (entitlement.version !== input.definition.version) return { ok: false, reason: 'feature.blocked.version' };
  if (input.definition.pricing === 'paid' && !entitlement.paidGrant) return { ok: false, reason: 'feature.blocked.payment' };
  if (entitlement.status === 'active') return { ok: true, duplicate: true, entitlement };
  return { ok: true, duplicate: false, entitlement: { ...entitlement, status: 'active' } };
}

/** A purchase request. It never grants the entitlement. */
export function whatsappPurchaseUrl(input: {
  phone: string;
  storeName: string;
  featureTitle: string;
  version: string;
  priceUsdCents: number | null;
}): string | null {
  const digits = input.phone.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  const price = input.priceUsdCents == null ? 'not listed' : `$${(input.priceUsdCents / 100).toFixed(2)}`;
  const message = [
    `Store: ${input.storeName.replace(/[\r\n]/g, ' ').slice(0, 80)}`,
    `Feature: ${input.featureTitle.replace(/[\r\n]/g, ' ').slice(0, 80)}`,
    `Version: ${input.version}`,
    `Price: ${price}`,
    'Request: I want to buy this feature.',
  ].join('\n');
  if (/token|secret|password|api[_-]?key/i.test(message)) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export function cartHasOpenLines(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as { carts?: { lines?: unknown[] }[] };
    if (!parsed || !Array.isArray(parsed.carts)) return true;
    return parsed.carts.some((cart) => Array.isArray(cart?.lines) && cart.lines.length > 0);
  } catch {
    return true;
  }
}

/** A sale, typed payment, or unreadable cart must survive until the cashier finishes it. */
export function posWorkInProgress(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as {
      carts?: {
        lines?: unknown[];
        debtLineUsdCents?: unknown;
        draft?: Record<string, unknown>;
      }[];
    };
    if (!parsed || !Array.isArray(parsed.carts)) return true;
    return parsed.carts.some((cart) => {
      if (Array.isArray(cart?.lines) && cart.lines.length > 0) return true;
      if (typeof cart?.debtLineUsdCents === 'number' && cart.debtLineUsdCents > 0) return true;
      const draft = cart?.draft;
      if (!draft) return false;
      const typed = ['receivedUsd', 'receivedLbp', 'changeUsd', 'changeLbp', 'creditUsd', 'creditLbp'];
      if (typed.some((key) => typeof draft[key] === 'string' && draft[key].trim() !== '')) return true;
      return draft.kind === 'credit' || draft.tenderUsdManual === true || draft.tenderLbpManual === true || draft.changeManual != null;
    });
  } catch {
    return true;
  }
}

export interface CustomerUpdate {
  featureId: string;
  title: string;
  description: string;
  version: string;
  icon: string;
  screenshots: string[];
  capabilities: string[];
  requirements: string[];
  compatibility: string;
  pricing: FeaturePricing;
  priceUsdCents: number | null;
  status: EntitlementStatus | 'unavailable';
  navPath: string | null;
  navLabel: string;
  reloadRequired: boolean;
  canActivate: boolean;
  canRequestPurchase: boolean;
}

export function customerUpdate(input: {
  definition: FeatureDefinition;
  record: FeatureRecord;
  entitlement: EntitlementRecord;
  killed: boolean;
}): CustomerUpdate | null {
  if (input.record.version !== input.definition.version) return null;
  if (input.record.publication === 'internal_testing' || input.record.publication === 'rolled_back') return null;
  const unavailable = input.killed || input.record.publication !== 'published';
  const canActivate =
    !unavailable &&
    input.definition.customerExecution === 'ready' &&
    (input.entitlement.status === 'notified' || input.entitlement.status === 'active') &&
    (input.definition.pricing === 'free' || input.entitlement.paidGrant);
  return {
    featureId: input.definition.id,
    title: input.definition.title,
    description: input.definition.description,
    version: input.definition.version,
    icon: input.definition.icon,
    screenshots: input.definition.screenshots,
    capabilities: input.definition.capabilities,
    requirements: input.definition.requirements,
    compatibility: input.definition.compatibility,
    pricing: input.definition.pricing,
    priceUsdCents: input.definition.priceUsdCents,
    status: unavailable ? 'unavailable' : input.entitlement.status,
    navPath: input.entitlement.status === 'active' && !unavailable ? input.definition.navPath : null,
    navLabel: input.definition.navLabel,
    reloadRequired: input.definition.reloadRequired,
    canActivate,
    canRequestPurchase: !unavailable && input.definition.pricing === 'paid' && !input.entitlement.paidGrant,
  };
}

/**
 * Registered features. Zelvero AI stays internal until a separate customer execution path exists.
 * Do not point that path at the reserved internal test tenant.
 */
export const FEATURE_REGISTRY: FeatureDefinition[] = [
  {
    id: 'zelvero_ai',
    title: 'Zelvero AI',
    description: 'Ask the store assistant about sales, stock, and confirmed catalog changes.',
    version: '2.0.0',
    icon: 'box',
    screenshots: [],
    category: 'assistant',
    classification: 'new',
    pricing: 'free',
    priceUsdCents: null,
    capabilities: ['Review today sales', 'Review products and low stock', 'Prepare a product for confirmation'],
    requirements: ['Store owner', 'A tested customer assistant path'],
    compatibility: 'Zelvero POS',
    customerExecution: 'ready',
    navPath: null,
    navLabel: 'Zelvero AI',
    testingStatus: 'passed',
    activation: 'server',
    reloadRequired: false,
  },
  {
    // Online Store 1.0 (2026-11): storefront with themes, checkout, website orders, reviews,
    // Whish payments and sizes. Released per store by the Super Admin from the Feature Center.
    id: 'online_store',
    title: 'Online Store',
    description: 'Your own store website from your POS products: themes, website orders, reviews and Whish payments.',
    version: '1.0.0',
    icon: 'box',
    screenshots: [],
    category: 'sales',
    classification: 'new',
    pricing: 'free',
    priceUsdCents: null,
    capabilities: ['Create your store website with a theme for your kind of shop', 'Receive website orders in the POS', 'Sizes and colours, reviews and Whish payments'],
    requirements: ['Store owner', 'Zelvero POS 0.9.3 or later'],
    compatibility: 'Zelvero POS 0.9.3+',
    customerExecution: 'ready',
    navPath: '/online-store',
    navLabel: 'Online Store',
    testingStatus: 'passed',
    activation: 'server',
    reloadRequired: false,
  },
  {
    // Cartons and sets (2026-11): sell a carton of 10 from the piece stock, or a full hookah
    // (base + hose + heads) as one item. Built for hookah/tobacco shops; useful for any shop that
    // sells packs or kits. Released per store by the Super Admin from the Feature Center.
    id: 'stock_links',
    title: 'Cartons and sets',
    description: 'Sell a carton and a single piece from the same stock, and sell sets (like a full hookah) that take each part out of stock.',
    version: '1.0.0',
    icon: 'box',
    screenshots: [],
    category: 'inventory',
    classification: 'new',
    pricing: 'free',
    priceUsdCents: null,
    capabilities: ['Carton with its own barcode and price, deducted from the pieces', 'Sets that deduct every part', 'Returns put the same pieces back'],
    requirements: ['Store owner or a user who can edit products'],
    compatibility: 'Zelvero POS 1.0+',
    customerExecution: 'unavailable',
    navPath: null,
    navLabel: 'Cartons and sets',
    testingStatus: 'in_testing',
    activation: 'server',
    reloadRequired: false,
  },
];

export function featureById(id: string): FeatureDefinition | null {
  return FEATURE_REGISTRY.find((feature) => feature.id === id) ?? null;
}

export function emptyFeatureRecord(definition: FeatureDefinition): FeatureRecord {
  return effectiveRecord(definition, null);
}
