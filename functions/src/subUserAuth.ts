/**
 * Pure authorization helpers for owner-side sub-user updates.
 * Kept framework-free so unit tests can cover the contract without emulators.
 */

export type SubUserAuthFailure =
  | 'not-owner'
  | 'self-target'
  | 'cross-tenant'
  | 'not-sub-user'
  | 'not-found';

export interface SubUserUpdateCaller {
  uid: string;
  tenantId: string | null;
  role: 'owner' | 'subUser' | null;
  active: boolean;
}

export interface SubUserTargetProfile {
  role?: unknown;
  tenantId?: unknown;
}

/**
 * Owner of the caller's tenant may update a sub-user in that same tenant.
 * Rejects self-targets, non-owners, and cross-tenant / non-member targets.
 */
export function assertOwnerMayUpdateSubUser(
  caller: SubUserUpdateCaller,
  targetUid: string,
  target: SubUserTargetProfile | null | undefined,
): { ok: true } | { ok: false; reason: SubUserAuthFailure } {
  if (!caller.tenantId || caller.role !== 'owner' || !caller.active) {
    return { ok: false, reason: 'not-owner' };
  }
  if (targetUid === caller.uid) return { ok: false, reason: 'self-target' };
  if (!target) return { ok: false, reason: 'not-found' };
  if (target.role !== 'subUser') return { ok: false, reason: 'not-sub-user' };
  if (target.tenantId !== caller.tenantId) return { ok: false, reason: 'cross-tenant' };
  return { ok: true };
}
