import { db } from './admin.js';
import { fail } from './errors.js';
import { requireOwner, type Caller } from './validate.js';

/** Live Firestore profile, not ID-token claims. Disabled owners are rejected immediately. */
export async function requireLiveOwner(c: Caller): Promise<string> {
  const tenantId = requireOwner(c);
  const profile = (await db.doc(`users/${c.uid}`).get()).data();
  if (!profile || profile.role !== 'owner' || profile.tenantId !== tenantId || profile.isActive === false) {
    fail('permission-denied', 'error.fn.notOwner');
  }
  return tenantId;
}

export async function assertLiveTenantUser(c: Caller): Promise<void> {
  if (!c.tenantId) fail('permission-denied', 'error.permissionDenied');
  const profile = (await db.doc(`users/${c.uid}`).get()).data();
  if (!profile || profile.tenantId !== c.tenantId || profile.isActive === false) {
    fail('permission-denied', 'error.userInactive');
  }
}
