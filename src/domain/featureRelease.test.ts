import { describe, expect, it } from 'vitest';
import {
  FEATURE_REGISTRY,
  RESERVED_TEST_TENANT,
  cartHasOpenLines,
  posWorkInProgress,
  customerUpdate,
  effectiveRecord,
  emptyFeatureRecord,
  featureById,
  isEligibleCustomer,
  planActivation,
  planGrantPaid,
  planMarkReady,
  planPause,
  planPublish,
  planRollback,
  whatsappPurchaseUrl,
  type CustomerAccount,
  type FeatureDefinition,
} from './featureRelease';

const NOW = Date.parse('2026-11-05T00:00:00.000Z');

function customer(overrides: Partial<CustomerAccount> = {}): CustomerAccount {
  return {
    tenantId: 'store-a',
    storeName: 'Cedar Market',
    internalDemo: false,
    activated: true,
    lifetime: true,
    endsAt: null,
    ...overrides,
  };
}

function readyFeature(overrides: Partial<FeatureDefinition> = {}): FeatureDefinition {
  return {
    id: 'shelf_labels',
    title: 'Shelf labels',
    description: 'Print shelf labels from the catalog.',
    version: '1.2.0',
    icon: 'box',
    screenshots: [],
    category: 'catalog',
    classification: 'new',
    pricing: 'paid',
    priceUsdCents: 1500,
    capabilities: ['Print a label'],
    requirements: ['A printer'],
    compatibility: 'Zelvero POS',
    customerExecution: 'ready',
    navPath: '/products',
    navLabel: 'Labels',
    testingStatus: 'passed',
    activation: 'server',
    reloadRequired: true,
    ...overrides,
  };
}

describe('feature release engine', () => {
  it('keeps Zelvero AI in internal testing and refuses customer publication', () => {
    const ai = featureById('zelvero_ai');
    expect(ai?.customerExecution).toBe('unavailable');
    expect(ai?.navPath).toBeNull();
    const record = emptyFeatureRecord(ai!);
    expect(record.publication).toBe('internal_testing');
    expect(planMarkReady(ai!, record, false, 'admin', NOW).ok).toBe(false);
    const published = planPublish({
      definition: ai!,
      record,
      killed: false,
      confirmPublication: true,
      confirmAllEligible: true,
      allEligible: true,
      tenantIds: [],
      accounts: [customer()],
      now: NOW,
      actorUid: 'admin',
    });
    expect(published.ok).toBe(false);
    if (!published.ok) expect(published.reason).toBe('feature.blocked.customerPath');
    expect(FEATURE_REGISTRY.filter((feature) => feature.id === 'zelvero_ai')).toHaveLength(1);
  });

  it('publishes only after explicit confirmation and rejects the reserved test tenant', () => {
    const feature = readyFeature({ pricing: 'free', priceUsdCents: null });
    const record = emptyFeatureRecord(feature);
    const ready = planMarkReady(feature, record, false, 'admin', NOW);
    expect(ready.ok).toBe(true);
    if (!ready.ok) return;
    expect(
      planPublish({
        definition: feature,
        record: ready.record,
        killed: false,
        confirmPublication: false,
        confirmAllEligible: false,
        allEligible: false,
        tenantIds: ['store-a'],
        accounts: [customer()],
        now: NOW,
        actorUid: 'admin',
      }).ok,
    ).toBe(false);
    expect(
      planPublish({
        definition: feature,
        record: ready.record,
        killed: false,
        confirmPublication: true,
        confirmAllEligible: false,
        allEligible: true,
        tenantIds: [],
        accounts: [customer()],
        now: NOW,
        actorUid: 'admin',
      }).ok,
    ).toBe(false);
    const reserved = planPublish({
      definition: feature,
      record: ready.record,
      killed: false,
      confirmPublication: true,
      confirmAllEligible: false,
      allEligible: false,
      tenantIds: [RESERVED_TEST_TENANT],
      accounts: [customer({ tenantId: RESERVED_TEST_TENANT, storeName: 'TEST' })],
      now: NOW,
      actorUid: 'admin',
    });
    expect(reserved.ok).toBe(false);
    const demo = planPublish({
      definition: feature,
      record: ready.record,
      killed: false,
      confirmPublication: true,
      confirmAllEligible: true,
      allEligible: true,
      tenantIds: [],
      accounts: [customer({ internalDemo: true }), customer({ tenantId: 'store-b', storeName: 'Real' })],
      now: NOW,
      actorUid: 'admin',
    });
    expect(demo.ok).toBe(true);
    if (demo.ok) {
      expect(demo.entitlements.map((item) => item.tenantId)).toEqual(['store-b']);
      expect(demo.entitlements[0]?.paidGrant).toBe(false);
    }
  });

  it('treats a repeated publish as a duplicate and rolls back without leaving it published', () => {
    const feature = readyFeature({ pricing: 'free', priceUsdCents: null });
    const ready = planMarkReady(feature, emptyFeatureRecord(feature), false, 'admin', NOW);
    if (!ready.ok) throw new Error('ready');
    const first = planPublish({
      definition: feature,
      record: ready.record,
      killed: false,
      confirmPublication: true,
      confirmAllEligible: false,
      allEligible: false,
      tenantIds: ['store-a'],
      accounts: [customer()],
      now: NOW,
      actorUid: 'admin',
    });
    if (!first.ok) throw new Error('publish');
    const again = planPublish({
      definition: feature,
      record: first.record,
      killed: false,
      confirmPublication: true,
      confirmAllEligible: false,
      allEligible: false,
      tenantIds: ['store-a'],
      accounts: [customer()],
      now: NOW,
      actorUid: 'admin',
    });
    expect(again.ok && again.duplicate).toBe(true);
    const paused = planPause(first.record, 'admin', NOW);
    expect(paused.ok).toBe(true);
    if (!paused.ok) return;
    const rolled = planRollback(paused.record, 'admin', NOW);
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    expect(rolled.record.publication).toBe('rolled_back');
    expect(planPause(rolled.record, 'admin', NOW).ok).toBe(false);
    expect(effectiveRecord(feature, { ...rolled.record, version: '0.1.0' }).publication).toBe('internal_testing');
  });

  it('does not activate a paid feature from a WhatsApp request', () => {
    const feature = readyFeature();
    const ready = planMarkReady(feature, emptyFeatureRecord(feature), false, 'admin', NOW);
    if (!ready.ok) throw new Error('ready');
    const published = planPublish({
      definition: feature,
      record: ready.record,
      killed: false,
      confirmPublication: true,
      confirmAllEligible: false,
      allEligible: false,
      tenantIds: ['store-a'],
      accounts: [customer()],
      now: NOW,
      actorUid: 'admin',
    });
    if (!published.ok) throw new Error('publish');
    const entitlement = published.entitlements[0]!;
    const url = whatsappPurchaseUrl({
      phone: '+961 70 123 456',
      storeName: 'Cedar Market',
      featureTitle: feature.title,
      version: feature.version,
      priceUsdCents: feature.priceUsdCents,
    });
    expect(url).toContain('https://wa.me/96170123456?text=');
    expect(decodeURIComponent(url!.split('text=')[1]!)).toContain('Price: $15.00');
    expect(url).not.toContain('store-a');
    expect(url).not.toMatch(/secret|token|password/i);
    expect(whatsappPurchaseUrl({ phone: '', storeName: 'Cedar', featureTitle: 'Shelf', version: '1.2.0', priceUsdCents: 1500 })).toBeNull();
    const beforeGrant = planActivation({ definition: feature, record: published.record, entitlement, killed: false });
    expect(beforeGrant.ok).toBe(false);
    const granted = planGrantPaid({ definition: feature, record: published.record, entitlement, killed: false });
    expect(granted.ok).toBe(true);
    if (!granted.ok) return;
    const activated = planActivation({ definition: feature, record: published.record, entitlement: granted.entitlement, killed: false });
    expect(activated.ok).toBe(true);
    if (!activated.ok) return;
    expect(activated.entitlement.status).toBe('active');
    expect(planActivation({ definition: feature, record: published.record, entitlement: activated.entitlement, killed: true }).ok).toBe(false);
    const visible = customerUpdate({
      definition: feature,
      record: published.record,
      entitlement: activated.entitlement,
      killed: false,
    });
    expect(visible?.navPath).toBe('/products');
    expect(visible?.canRequestPurchase).toBe(false);
  });

  it('blocks a reload while a sale is still open', () => {
    expect(cartHasOpenLines(null)).toBe(false);
    expect(cartHasOpenLines(JSON.stringify({ carts: [{ lines: [] }] }))).toBe(false);
    expect(cartHasOpenLines(JSON.stringify({ carts: [{ lines: [{ productId: 'p1' }] }] }))).toBe(true);
    expect(cartHasOpenLines('not-json')).toBe(true);
    expect(posWorkInProgress(null)).toBe(false);
    expect(posWorkInProgress(JSON.stringify({ carts: [{ lines: [], draft: { receivedUsd: '5' } }] }))).toBe(true);
    expect(posWorkInProgress(JSON.stringify({ carts: [{ lines: [], debtLineUsdCents: 100 }] }))).toBe(true);
    expect(posWorkInProgress(JSON.stringify({ carts: [{ lines: [], draft: { kind: 'cash' } }] }))).toBe(false);
    expect(posWorkInProgress('not-json')).toBe(true);
  });

  it('hides an internal feature from the customer update list', () => {
    const ai = featureById('zelvero_ai')!;
    expect(
      customerUpdate({
        definition: ai,
        record: emptyFeatureRecord(ai),
        entitlement: {
          tenantId: 'store-a',
          featureId: ai.id,
          version: ai.version,
          pricing: 'free',
          priceUsdCents: null,
          status: 'notified',
          paidGrant: false,
        },
        killed: false,
      }),
    ).toBeNull();
    expect(isEligibleCustomer(customer({ activated: false, lifetime: false }), NOW)).toBe(false);
  });
});
