import { describe, expect, it } from 'vitest';
import { cleanupAttention, decideStorageCleanup, judgeAccountAbsence, tenantIdReserved, tenantStoragePrefix, type AbsenceEvidence, type CleanupRecord } from '../../functions/src/storageCleanup';

const gone: AbsenceEvidence = {
  tenantDocExists: false,
  tenantSubcollectionCount: 0,
  storeDocExists: false,
  subscriptionDocExists: false,
  subdomainDocExists: false,
  usersWithTenant: 0,
  userDocExists: { 'owner-1': false, 'store-1': false },
  authUserExists: { 'owner-1': false },
};

const closed: CleanupRecord = {
  tenantId: 'store-1',
  prefix: 'tenants/store-1/',
  ownerUid: 'owner-1',
  memberUids: ['owner-1'],
  subdomain: 'store',
  accountDeleted: false,
  storageCleanup: 'pending',
};

describe('storage cleanup retry scope', () => {
  it('deletes only the recorded tenant prefix after the account is gone', () => {
    expect(decideStorageCleanup('store-1', {
      tenantId: 'store-1',
      prefix: 'tenants/store-1/',
      accountDeleted: true,
      storageCleanup: 'pending',
    })).toEqual({ action: 'delete', prefix: 'tenants/store-1/' });
  });

  it('does nothing further when cleanup already completed', () => {
    expect(decideStorageCleanup('store-1', {
      tenantId: 'store-1',
      prefix: 'tenants/store-1/',
      accountDeleted: true,
      storageCleanup: 'complete',
    })).toEqual({ action: 'complete' });
  });

  it('does not delete files before the account deletion is recorded', () => {
    expect(decideStorageCleanup('store-1', {
      tenantId: 'store-1',
      prefix: 'tenants/store-1/',
      accountDeleted: false,
      storageCleanup: 'pending',
    })).toEqual({ action: 'pending' });
  });

  it('rejects a uid prefix, another tenant, and a missing record', () => {
    expect(decideStorageCleanup('store-1', {
      tenantId: 'store-1',
      prefix: 'tenants/auth-uid/',
      accountDeleted: true,
      storageCleanup: 'pending',
    })).toEqual({ action: 'reject' });
    expect(decideStorageCleanup('store-1', {
      tenantId: 'store-2',
      prefix: 'tenants/store-2/',
      accountDeleted: true,
      storageCleanup: 'pending',
    })).toEqual({ action: 'reject' });
    expect(decideStorageCleanup('store-1', undefined)).toEqual({ action: 'reject' });
    expect(tenantStoragePrefix('../store-1')).toBeNull();
    expect(tenantStoragePrefix('store-1')).toBe('tenants/store-1/');
  });

  it('proves absence only from the recorded auth users and firestore records', () => {
    expect(judgeAccountAbsence('store-1', closed, gone)).toBe('absent');
    expect(judgeAccountAbsence('store-1', closed, gone)).toBe('absent');
    expect(judgeAccountAbsence('store-1', closed, { ...gone, userDocExists: { ...gone.userDocExists, 'owner-1': true } })).toBe('present');
    expect(judgeAccountAbsence('store-1', closed, { ...gone, authUserExists: { 'owner-1': true } })).toBe('present');
    expect(judgeAccountAbsence('store-1', closed, { ...gone, authUserExists: { 'owner-1': null } })).toBe('ambiguous');
    expect(judgeAccountAbsence('store-1', closed, { ...gone, usersWithTenant: 1 })).toBe('present');
    expect(judgeAccountAbsence('store-1', closed, { ...gone, tenantSubcollectionCount: 1 })).toBe('present');
    expect(judgeAccountAbsence('store-1', closed, { ...gone, subdomainDocExists: true })).toBe('present');
    expect(judgeAccountAbsence('store-1', { ...closed, memberUids: undefined }, gone)).toBe('ambiguous');
    expect(judgeAccountAbsence('store-1', { ...closed, prefix: 'tenants/owner-1/' }, gone)).toBe('ambiguous');
  });

  it('keeps a pending cleanup visible after the store leaves the accounts list', () => {
    const accounts = [{ tenantId: 'other-store' }];
    const row = cleanupAttention('store-1', { ...closed, prefix: 'tenants/store-1/', memberUids: ['owner-1'], lastOutcome: 'storage-failed' });
    expect(row).toEqual({
      tenantId: 'store-1',
      storageCleanup: 'pending',
      lastOutcome: 'storage-failed',
      updatedAt: null,
      lastAttemptAt: null,
    });
    expect(accounts.some((account) => account.tenantId === row?.tenantId)).toBe(false);
    expect(cleanupAttention('store-1', { ...closed, storageCleanup: 'complete' })).toBeNull();
  });

  it('reserves a tenant id for both pending and completed cleanup, including a legacy record', () => {
    expect(tenantIdReserved(undefined)).toBe(false);
    expect(tenantIdReserved({ tenantId: 'store-1', storageCleanup: 'pending' })).toBe(true);
    expect(tenantIdReserved({ tenantId: 'store-1', storageCleanup: 'complete', accountDeleted: true })).toBe(true);
    expect(tenantIdReserved({ tenantId: 'store-1', storageCleanup: 'pending', accountDeleted: false })).toBe(true);
    expect(judgeAccountAbsence('store-1', { tenantId: 'store-1', prefix: 'tenants/store-1/', accountDeleted: false, storageCleanup: 'pending' }, gone)).toBe('ambiguous');
  });
});
