import { describe, expect, it } from 'vitest';
import {
  alreadyInAppTree,
  canAssignTenants,
  canCreateVersion,
  canReleaseToEveryone,
  canTransition,
  clientApiAllowed,
  compareSemver,
  isPublicPath,
  isValidVersion,
  mapBootLocation,
  requiresForcedUpdate,
  resolveTenantVersion,
  rollbackSafe,
  stripAppTreePrefix,
  treesEligibleForDelete,
  updateAvailable,
} from './release';

describe('semver', () => {
  it('accepts MAJOR.MINOR.PATCH and rejects junk', () => {
    expect(isValidVersion('1.0.1')).toBe(true);
    expect(isValidVersion('0.9.0-dev')).toBe(true);
    expect(isValidVersion('1')).toBe(false);
    expect(isValidVersion('01.0.0')).toBe(false);
    expect(isValidVersion('')).toBe(false);
  });

  it('orders versions and blocks accidental downgrades', () => {
    expect(compareSemver('1.0.1', '1.0.0')).toBeGreaterThan(0);
    expect(canCreateVersion('1.0.1', '1.0.0')).toBe(true);
    expect(canCreateVersion('1.0.0', '1.0.1')).toBe(false);
  });

  it('refuses to create 1.0.0 before freeze', () => {
    expect(canCreateVersion('1.0.0', null)).toBe(false);
    expect(canCreateVersion('0.9.0-dev', null)).toBe(true);
  });
});

describe('status flow', () => {
  it('does not allow DRAFT → EVERYONE', () => {
    expect(canReleaseToEveryone('draft')).toBe(false);
    expect(canReleaseToEveryone('draft', true)).toBe(false);
    expect(canReleaseToEveryone('pilot')).toBe(true);
    expect(canTransition('draft', 'released')).toBe(false);
    expect(canTransition('testing', 'ready')).toBe(true);
    expect(canAssignTenants('ready')).toBe(true);
    expect(canAssignTenants('draft')).toBe(false);
  });
});

describe('boot mapping', () => {
  it('lets signed-out and first-time browsers use the site default without a tenant', () => {
    const r = resolveTenantVersion({
      tenantId: null,
      signedIn: false,
      offline: false,
      lastGoodVersion: null,
      lastTenantId: null,
      siteDefaultVersion: '0.9.0-dev',
      manifest: { productionVersion: null, previousProductionVersion: null, stagingVersion: '0.9.0-dev', minSupportedVersion: null, paused: false, updatedAt: null },
      assignment: null,
    });
    expect(r).toMatchObject({ version: '0.9.0-dev', requireTenant: false, reason: 'signed-out' });
  });

  it('maps deep links onto the assigned tree', () => {
    expect(mapBootLocation({ version: '0.9.0-dev', pathname: '/pos' })).toBe('/app/0.9.0-dev/pos');
    expect(mapBootLocation({ version: '0.9.0-dev', pathname: '/settings', search: '?x=1' })).toBe('/app/0.9.0-dev/settings?x=1');
    expect(mapBootLocation({ version: '0.9.0-dev', pathname: '/auth/action', search: '?mode=resetPassword&oobCode=abc' })).toBe(
      '/app/0.9.0-dev/auth/action?mode=resetPassword&oobCode=abc',
    );
    expect(stripAppTreePrefix('/app/0.9.0-dev/pos')).toBe('/pos');
    expect(alreadyInAppTree('/app/0.9.0-dev/login')).toBe(true);
    expect(isPublicPath('/login')).toBe(true);
    expect(isPublicPath('/app/0.9.0-dev/auth/action')).toBe(true);
    expect(isPublicPath('/pos')).toBe(false);
  });

  it('uses last-good while offline and tenant assignment when online', () => {
    const base = {
      tenantId: 'storeA',
      signedIn: true,
      lastTenantId: 'storeA',
      siteDefaultVersion: '0.9.0-dev',
      manifest: { productionVersion: null, previousProductionVersion: null, stagingVersion: '0.9.0-dev', minSupportedVersion: null, paused: false, updatedAt: null },
    };
    expect(
      resolveTenantVersion({ ...base, offline: true, lastGoodVersion: '0.9.0-dev', assignment: { tenantId: 'storeA', assignedVersion: '1.0.1' } }).version,
    ).toBe('0.9.0-dev');
    expect(
      resolveTenantVersion({
        ...base,
        offline: false,
        lastGoodVersion: '0.9.0-dev',
        assignment: { tenantId: 'storeA', assignedVersion: '1.0.1' },
      }).version,
    ).toBe('1.0.1');
  });

  it('does not give store B store A’s assignment, and staging is not production', () => {
    const manifest = {
      productionVersion: null,
      previousProductionVersion: null,
      stagingVersion: '0.9.0-dev',
      minSupportedVersion: null,
      paused: false,
      updatedAt: null,
    };
    const a = resolveTenantVersion({
      tenantId: 'storeA',
      signedIn: true,
      offline: false,
      lastGoodVersion: null,
      lastTenantId: 'storeA',
      siteDefaultVersion: '0.8.0-dev',
      manifest,
      assignment: { tenantId: 'storeA', assignedVersion: '0.9.0-dev' },
    });
    const b = resolveTenantVersion({
      tenantId: 'storeB',
      signedIn: true,
      offline: false,
      lastGoodVersion: null,
      lastTenantId: 'storeB',
      siteDefaultVersion: '0.8.0-dev',
      manifest,
      assignment: null,
    });
    expect(a.version).toBe('0.9.0-dev');
    expect(b.version).toBe('0.8.0-dev');
    expect(b.reason).toBe('site-default');
  });
});

describe('update + retention + compatibility', () => {
  it('hides updates when paused and forces only below min supported', () => {
    expect(updateAvailable('0.9.0-dev', '1.0.1', false)).toBe(true);
    expect(updateAvailable('0.9.0-dev', '1.0.1', true)).toBe(false);
    expect(requiresForcedUpdate('1.0.0', '1.1.0')).toBe(true);
    expect(requiresForcedUpdate('1.2.0', '1.1.0')).toBe(false);
  });

  it('never deletes a tree that is assigned, production, previous, min, staging or rollback', () => {
    expect(
      treesEligibleForDelete({
        trees: ['0.8.0-dev', '0.9.0-dev', '1.0.1', 'old'],
        assignedVersions: ['0.9.0-dev'],
        productionVersion: '1.0.0',
        previousProductionVersion: '0.9.0-dev',
        minSupportedVersion: '0.8.0-dev',
        rollbackVersions: ['1.0.0'],
        stagingVersion: '1.0.1',
      }),
    ).toEqual(['old']);
  });

  it('accepts legacy clients without an API version and rejects too-old ones', () => {
    expect(clientApiAllowed(undefined, 1, 1)).toBe(true);
    expect(clientApiAllowed(1, 1, 1)).toBe(true);
    expect(clientApiAllowed(0, 1, 1)).toBe(false);
  });

  it('blocks rollback after a migration or onto an incompatible API', () => {
    expect(rollbackSafe({ toVersion: '1.0.0', fromVersion: '1.0.1', toApi: 1, liveApiMin: 1, toOfflineSchema: 1, liveOfflineSchema: 1, fromRequiresMigration: false })).toBe(true);
    expect(rollbackSafe({ toVersion: '1.0.0', fromVersion: '1.0.1', toApi: 1, liveApiMin: 1, toOfflineSchema: 1, liveOfflineSchema: 1, fromRequiresMigration: true })).toBe(false);
  });
});
