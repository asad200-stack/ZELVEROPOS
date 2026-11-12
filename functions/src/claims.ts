import type { DocumentData } from 'firebase-admin/firestore';
import { auth, db } from './admin.js';
import { grantedOnly, normalizePermissions } from './permissions.js';
import { subUntilOf } from './subscriptionUntil.js';

export { LIFETIME_UNTIL, subUntilOf } from './subscriptionUntil.js';

export interface TenantClaims {
  tenantId: string;
  role: 'owner' | 'subUser';
  active: boolean;
  subUntil: number;
  cv: number;
  perms?: Record<string, true>;
  superAdmin?: true;
}

export function buildClaims(profile: DocumentData, sub: DocumentData | undefined, cv: number, superAdmin: boolean): TenantClaims {
  const role = profile.role === 'subUser' ? 'subUser' : 'owner';
  const claims: TenantClaims = {
    tenantId: String(profile.tenantId),
    role,
    active: profile.isActive !== false,
    subUntil: subUntilOf(sub),
    cv,
  };
  if (role === 'subUser') claims.perms = grantedOnly(normalizePermissions(profile.permissions));
  if (superAdmin) claims.superAdmin = true;
  return claims;
}

/**
 * Recomputes a user's custom claims from Firestore (profile + tenant subscription). Claims are set
 * before `claimsVersion` is bumped so the client's forced token refresh always sees the new claims.
 */
export async function syncUserClaims(uid: string): Promise<void> {
  const userRef = db.doc(`users/${uid}`);
  const [snap, record] = await Promise.all([userRef.get(), auth.getUser(uid)]);
  const superAdmin = record.customClaims?.superAdmin === true;
  const profile = snap.data();
  if (!profile?.tenantId) {
    await auth.setCustomUserClaims(uid, superAdmin ? { superAdmin: true } : null);
    return;
  }
  const sub = (await db.doc(`subscriptions/${profile.tenantId}`).get()).data();
  const cv = (typeof profile.claimsVersion === 'number' ? profile.claimsVersion : 0) + 1;
  await auth.setCustomUserClaims(uid, { ...buildClaims(profile, sub, cv, superAdmin) });
  await userRef.update({ claimsVersion: cv });
}

export async function tenantUserIds(tenantId: string): Promise<string[]> {
  const snap = await db.collection('users').where('tenantId', '==', tenantId).select().get();
  return snap.docs.map((d) => d.id);
}

/** Re-syncs the owner and every sub-user of a tenant (after subscription changes). */
export async function syncTenantClaims(tenantId: string): Promise<void> {
  const ids = await tenantUserIds(tenantId);
  for (const id of ids) {
    try {
      await syncUserClaims(id);
    } catch (e) {
      console.error('[claims] sync failed', id, e);
    }
  }
}

export async function revokeTenantSessions(tenantId: string): Promise<void> {
  const ids = await tenantUserIds(tenantId);
  await Promise.all(ids.map((id) => auth.revokeRefreshTokens(id).catch((e) => console.error('[claims] revoke failed', id, e))));
}
