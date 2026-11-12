import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  DEFAULT_SUBUSER_PERMISSIONS,
  grantedOnly,
  mergePermissionPatch,
  normalizePermissions,
  PERMISSION_KEYS,
  type PermissionKey,
} from '../../src/constants/permissions';
import { assertOwnerMayUpdateSubUser } from '../../functions/src/subUserAuth';

describe('canUseZelveroAI permission contract', () => {
  it('defaults missing canUseZelveroAI to false', () => {
    const perms = normalizePermissions({ canSell: true });
    expect(perms.canUseZelveroAI).toBe(false);
    expect(grantedOnly(perms).canUseZelveroAI).toBeUndefined();
  });

  it('keeps explicit true and false', () => {
    expect(normalizePermissions({ canUseZelveroAI: true }).canUseZelveroAI).toBe(true);
    expect(normalizePermissions({ canUseZelveroAI: false }).canUseZelveroAI).toBe(false);
    expect(normalizePermissions({ canUseZelveroAI: 'yes' }).canUseZelveroAI).toBe(false);
    expect(normalizePermissions({ canUseZelveroAI: 1 }).canUseZelveroAI).toBe(false);
  });

  it('keeps owner ALL_PERMISSIONS intact including AI', () => {
    expect(ALL_PERMISSIONS.canUseZelveroAI).toBe(true);
    for (const key of PERMISSION_KEYS) expect(ALL_PERMISSIONS[key]).toBe(true);
  });

  it('default sub-user template has AI false', () => {
    expect(DEFAULT_SUBUSER_PERMISSIONS.canUseZelveroAI).toBe(false);
  });

  it('AI permission does not imply any POS permission', () => {
    const onlyAi = normalizePermissions({ canUseZelveroAI: true });
    expect(onlyAi.canUseZelveroAI).toBe(true);
    const posKeys = PERMISSION_KEYS.filter((k) => k !== 'canUseZelveroAI');
    for (const key of posKeys) expect(onlyAi[key], key).toBe(false);
  });

  it('granting AI via merge leaves canSell and other POS keys unchanged', () => {
    const existing = normalizePermissions({
      canSell: true,
      canViewProducts: true,
      canAddProducts: true,
      canUseZelveroAI: false,
    });
    const next = mergePermissionPatch(existing, { canUseZelveroAI: true });
    expect(next.canUseZelveroAI).toBe(true);
    expect(next.canSell).toBe(true);
    expect(next.canAddProducts).toBe(true);
    expect(next.canViewProducts).toBe(true);
  });

  it('revoking AI via merge leaves unrelated POS keys unchanged', () => {
    const existing = normalizePermissions({
      canSell: true,
      canViewReports: true,
      canUseZelveroAI: true,
    });
    const next = mergePermissionPatch(existing, { canUseZelveroAI: false });
    expect(next.canUseZelveroAI).toBe(false);
    expect(next.canSell).toBe(true);
    expect(next.canViewReports).toBe(true);
  });

  it('ignores unknown permission keys in a patch', () => {
    const existing = normalizePermissions({ canSell: true });
    const next = mergePermissionPatch(existing, {
      canUseZelveroAI: true,
      canManageUsers: true,
      bogus: true,
    } as Record<string, boolean>);
    expect(next.canUseZelveroAI).toBe(true);
    expect(next.canSell).toBe(true);
    expect((next as Record<string, boolean>).canManageUsers).toBeUndefined();
    expect((next as Record<string, boolean>).bogus).toBeUndefined();
  });

  it('idempotent identical AI grant/revoke patches', () => {
    const base = normalizePermissions({ canSell: true, canUseZelveroAI: true });
    expect(mergePermissionPatch(base, { canUseZelveroAI: true })).toEqual(base);
    const revoked = mergePermissionPatch(base, { canUseZelveroAI: false });
    expect(mergePermissionPatch(revoked, { canUseZelveroAI: false })).toEqual(revoked);
  });
});

describe('updateSubUser authorization contract', () => {
  const owner = {
    uid: 'owner-1',
    tenantId: 'tenant-a',
    role: 'owner' as const,
    active: true,
  };

  it('allows owner to grant/revoke AI for a member of their tenant', () => {
    const target = { role: 'subUser', tenantId: 'tenant-a' };
    expect(assertOwnerMayUpdateSubUser(owner, 'staff-1', target)).toEqual({ ok: true });
  });

  it('rejects non-owner callers', () => {
    expect(
      assertOwnerMayUpdateSubUser(
        { uid: 'staff-1', tenantId: 'tenant-a', role: 'subUser', active: true },
        'staff-2',
        { role: 'subUser', tenantId: 'tenant-a' },
      ),
    ).toEqual({ ok: false, reason: 'not-owner' });
  });

  it('rejects self-grant / self-target', () => {
    expect(assertOwnerMayUpdateSubUser(owner, 'owner-1', { role: 'subUser', tenantId: 'tenant-a' })).toEqual({
      ok: false,
      reason: 'self-target',
    });
  });

  it('rejects cross-tenant targets', () => {
    expect(
      assertOwnerMayUpdateSubUser(owner, 'staff-other', { role: 'subUser', tenantId: 'tenant-b' }),
    ).toEqual({ ok: false, reason: 'cross-tenant' });
  });

  it('rejects missing or non-sub-user targets', () => {
    expect(assertOwnerMayUpdateSubUser(owner, 'missing', null)).toEqual({ ok: false, reason: 'not-found' });
    expect(assertOwnerMayUpdateSubUser(owner, 'peer-owner', { role: 'owner', tenantId: 'tenant-a' })).toEqual({
      ok: false,
      reason: 'not-sub-user',
    });
  });
});

describe('claims persistence shape for AI permission', () => {
  // Mirrors functions/src/claims.ts: sub-user claims.perms = grantedOnly(normalizePermissions(...))
  it('grant serializes canUseZelveroAI into claims without inventing POS claims', () => {
    const perms = mergePermissionPatch(
      { canSell: true, canViewSales: true, canUseZelveroAI: false },
      { canUseZelveroAI: true },
    );
    const claimPerms = grantedOnly(perms);
    expect(claimPerms.canUseZelveroAI).toBe(true);
    expect(claimPerms.canSell).toBe(true);
    expect(claimPerms.canAddProducts).toBeUndefined();
  });

  it('revoke omits AI from claims while keeping canSell', () => {
    const perms = mergePermissionPatch(
      { canSell: true, canUseZelveroAI: true },
      { canUseZelveroAI: false },
    );
    const claimPerms = grantedOnly(perms);
    expect(claimPerms.canUseZelveroAI).toBeUndefined();
    expect(claimPerms.canSell).toBe(true);
  });

  it('owner ALL_PERMISSIONS still includes AI; sub-user claims use grantedOnly only', () => {
    expect(ALL_PERMISSIONS.canUseZelveroAI).toBe(true);
    // Owners do not embed perms in custom claims (role===owner path in buildClaims).
    expect(Object.keys(grantedOnly(ALL_PERMISSIONS)).length).toBe(PERMISSION_KEYS.length);
  });
});

describe('AI vs POS independence matrix', () => {
  const cases: Array<{ label: string; patch: Partial<Record<PermissionKey, boolean>>; sell: boolean; ai: boolean }> = [
    { label: 'AI+sell', patch: { canSell: true, canUseZelveroAI: true }, sell: true, ai: true },
    { label: 'sell only', patch: { canSell: true, canUseZelveroAI: false }, sell: true, ai: false },
    { label: 'AI only', patch: { canSell: false, canUseZelveroAI: true }, sell: false, ai: true },
  ];

  it.each(cases)('$label keeps sell and AI orthogonal', ({ patch, sell, ai }) => {
    const perms = normalizePermissions(patch);
    expect(perms.canSell).toBe(sell);
    expect(perms.canUseZelveroAI).toBe(ai);
  });
});
