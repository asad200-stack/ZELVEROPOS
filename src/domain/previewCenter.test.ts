import { describe, expect, it } from 'vitest';
import type { CustomerAccount } from './featureRelease';
import { deliveredFrontendVersion, draftReleaseRecord, eligibleCustomerTenantIds, releaseTargetIds } from './previewCenter';

const now = Date.parse('2026-11-10T00:00:00Z');

function store(patch: Partial<CustomerAccount> = {}): CustomerAccount {
  return {
    tenantId: 'store-a',
    storeName: 'Store A',
    internalDemo: false,
    activated: true,
    lifetime: true,
    endsAt: null,
    ...patch,
  };
}

describe('preview and release delivery', () => {
  it('keeps an unselected store on the approved production version', () => {
    expect(
      deliveredFrontendVersion({
        assignedVersion: null,
        productionVersion: '0.9.0',
        paused: false,
      }),
    ).toBe('0.9.0');
  });

  it('gives a selected store its pinned version and leaves everyone else alone', () => {
    expect(deliveredFrontendVersion({ assignedVersion: '0.9.1', productionVersion: '0.9.0', paused: false })).toBe('0.9.1');
    expect(deliveredFrontendVersion({ assignedVersion: null, productionVersion: '0.9.0', paused: false })).toBe('0.9.0');
  });

  it('does not move stores to a testing build', () => {
    const testingBuild = '0.9.1-test';
    expect(deliveredFrontendVersion({ assignedVersion: null, productionVersion: '0.9.0', paused: false })).not.toBe(testingBuild);
  });

  it('excludes the synthetic demo store from customer release targets', () => {
    const accounts = [
      store({ tenantId: 'demo', storeName: 'ZELVERO INTERNAL DEMO', internalDemo: true }),
      store({ tenantId: 'store-a' }),
      store({ tenantId: 'expired', lifetime: false, endsAt: now - 1 }),
    ];
    const eligible = eligibleCustomerTenantIds(accounts, now);
    expect(eligible).toEqual(['store-a']);
    expect(releaseTargetIds(eligible, ['demo', 'store-a', 'expired'], false)).toEqual(['store-a']);
    expect(releaseTargetIds(eligible, [], true)).toEqual(['store-a']);
  });

  it('records a draft against one build and no stores', () => {
    expect(
      draftReleaseRecord({
        version: '0.9.1',
        title: 'Cart spacing',
        description: 'Tested on the internal demo store.',
        buildId: 'build-abc',
      }),
    ).toEqual({
      version: '0.9.1',
      title: 'Cart spacing',
      notes: 'Tested on the internal demo store.',
      buildId: 'build-abc',
      status: 'draft',
      targetType: 'none',
      targetTenantIds: [],
    });
  });
});
