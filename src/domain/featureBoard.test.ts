import { describe, expect, it } from 'vitest';
import { BASE_FEATURE_IDS, FEATURE_REGISTRY, RESERVED_TEST_TENANT, effectiveRecord, planAdminGrant, type FeatureRecord } from './featureRelease';

const store = FEATURE_REGISTRY.find((f) => f.id === 'online_store')!;
const links = FEATURE_REGISTRY.find((f) => f.id === 'stock_links')!;
const published = (version: string): FeatureRecord =>
  effectiveRecord(store, { version, publication: 'published', audience: { allEligible: false, tenantIds: [] }, receipt: null, testingStatus: 'passed', history: [] });

describe('Super Admin feature board', () => {
  it('base features are the online store and Zelvero AI', () => {
    expect([...BASE_FEATURE_IDS]).toEqual(['online_store', 'zelvero_ai']);
  });

  it('switches a published, tested feature straight on', () => {
    const plan = planAdminGrant({ definition: store, record: published(store.version), tenantId: 'shop1', killed: false });
    expect(plan.ok && plan.entitlement).toEqual({
      tenantId: 'shop1',
      featureId: 'online_store',
      version: store.version,
      pricing: 'free',
      priceUsdCents: null,
      status: 'active',
      paidGrant: false,
    });
  });

  it('refuses the emergency stop, untested, unpublished, old version and the test account', () => {
    expect(planAdminGrant({ definition: store, record: published(store.version), tenantId: 'x', killed: true })).toEqual({ ok: false, reason: 'killed' });
    expect(planAdminGrant({ definition: { ...links, customerExecution: 'unavailable' }, record: published(links.version), tenantId: 'x', killed: false })).toEqual({ ok: false, reason: 'customerPath' });
    const draft = { ...published(store.version), publication: 'ready' as const };
    expect(planAdminGrant({ definition: store, record: draft, tenantId: 'x', killed: false })).toEqual({ ok: false, reason: 'notPublished' });
    expect(planAdminGrant({ definition: store, record: { ...published(store.version), version: '0.1.0' }, tenantId: 'x', killed: false }).ok).toBe(false);
    expect(planAdminGrant({ definition: store, record: published(store.version), tenantId: RESERVED_TEST_TENANT, killed: false })).toEqual({ ok: false, reason: 'testTenant' });
  });
});
