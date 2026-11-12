import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  DEFAULT_SUBUSER_PERMISSIONS,
  normalizePermissions,
  PERMISSION_GROUPS,
  PERMISSION_KEYS,
  type PermissionKey,
} from '@/constants/permissions';
import {
  AI_ACCESS_PERMISSION,
  aiAccessDeniedText,
  aiDockModeAfterPermissionChange,
  assertCanAccessZelveroAi,
  canAccessZelveroAi,
  shouldShowAiEntry,
} from './aiAccess';
import { AI_TOOLS } from './actions/allowlist';
import { conversationStorageKey } from './engine';

function canOf(granted: PermissionKey[]) {
  const set = new Set(granted);
  return (permission: PermissionKey) => set.has(permission);
}

describe('canUseZelveroAI permission', () => {
  it('1. user with canUseZelveroAI=true can open and use the assistant', () => {
    const ctx = { isOwner: false, can: canOf(['canUseZelveroAI', 'canSell']) };
    expect(canAccessZelveroAi(ctx)).toBe(true);
    expect(shouldShowAiEntry(ctx)).toBe(true);
    expect(assertCanAccessZelveroAi(ctx)).toEqual({ ok: true });
  });

  it('2. user with canUseZelveroAI=false cannot see or open it', () => {
    const ctx = { isOwner: false, can: canOf(['canSell', 'canViewProducts', 'canViewSales']) };
    expect(canAccessZelveroAi(ctx)).toBe(false);
    expect(shouldShowAiEntry(ctx)).toBe(false);
    expect(shouldShowAiEntry({ ...ctx, adminOnly: true })).toBe(false);
    expect(aiDockModeAfterPermissionChange(false, 'open')).toBe('closed');
  });

  it('3. direct attempts to invoke AI without permission are rejected', () => {
    const denied = assertCanAccessZelveroAi({ isOwner: false, can: () => false });
    expect(denied).toEqual({ ok: false, reason: 'denied' });
    expect(aiAccessDeniedText('en')).toMatch(/do not have permission/i);
    expect(aiAccessDeniedText('ar')).toMatch(/صلاحية/);
  });

  it('4. revoking permission while the panel is open disables it immediately', () => {
    expect(aiDockModeAfterPermissionChange(true, 'open')).toBe('open');
    expect(aiDockModeAfterPermissionChange(true, 'minimized')).toBe('minimized');
    expect(aiDockModeAfterPermissionChange(false, 'open')).toBe('closed');
    expect(aiDockModeAfterPermissionChange(false, 'minimized')).toBe('closed');
  });

  it('5. permission management stays owner-gated in the shared permission model', () => {
    expect(PERMISSION_GROUPS.some((g) => g.permissions.includes('canUseZelveroAI'))).toBe(true);
    expect(PERMISSION_KEYS).toContain('canUseZelveroAI');
    // Sub-user defaults do not grant AI; only an authorized owner can enable it via Users UI / updateSubUser.
    expect(DEFAULT_SUBUSER_PERMISSIONS.canUseZelveroAI).toBe(false);
    expect(normalizePermissions({ canSell: true }).canUseZelveroAI).toBe(false);
    expect(normalizePermissions({ canUseZelveroAI: true }).canUseZelveroAI).toBe(true);
  });

  it('6. AI access does not grant unrelated POS permissions', () => {
    const onlyAi = normalizePermissions({ canUseZelveroAI: true });
    expect(onlyAi.canUseZelveroAI).toBe(true);
    expect(onlyAi.canSell).toBe(false);
    expect(onlyAi.canViewProducts).toBe(false);
    expect(onlyAi.canManageCashDrawer).toBe(false);
    expect(onlyAi.canViewReports).toBe(false);
    expect(AI_TOOLS.includes('checkout' as never)).toBe(false);
    const ctx = { isOwner: false, can: (p: PermissionKey) => onlyAi[p] === true };
    expect(canAccessZelveroAi(ctx)).toBe(true);
    expect(ctx.can('canSell')).toBe(false);
  });

  it('7. existing owner behavior remains correct (owners have every permission including AI)', () => {
    expect(ALL_PERMISSIONS.canUseZelveroAI).toBe(true);
    const owner = { isOwner: true, can: (p: PermissionKey) => ALL_PERMISSIONS[p] === true };
    expect(canAccessZelveroAi(owner)).toBe(true);
    expect(shouldShowAiEntry(owner)).toBe(true);
    // Super-admin platform shell (adminOnly) still hides the POS AI entry.
    expect(shouldShowAiEntry({ ...owner, adminOnly: true })).toBe(false);
  });

  it('8. tenant isolation remains intact for AI conversation storage', () => {
    expect(conversationStorageKey('tenant-a', 'user-1')).not.toBe(conversationStorageKey('tenant-b', 'user-1'));
    expect(AI_ACCESS_PERMISSION).toBe('canUseZelveroAI');
  });
});
