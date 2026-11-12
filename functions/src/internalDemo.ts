import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { auth, db } from './admin.js';
import { writeNewTenant } from './account.js';
import { syncUserClaims } from './claims.js';
import { REGION } from './config.js';
import { fail } from './errors.js';
import { tenantIdReserved, type CleanupRecord } from './storageCleanup.js';
import { caller, requireSuperAdmin } from './validate.js';

export const INTERNAL_DEMO_SUBDOMAIN = 'zelvero-internal-demo';
export const INTERNAL_DEMO_STORE_NAME = 'ZELVERO INTERNAL DEMO';

/**
 * Gives the calling super admin one internal demo store (tenant id = the super admin's uid).
 * Never attaches the caller to an existing store: any profile, tenant, store or subscription already
 * keyed by the caller's uid is refused, except the demo store this function created (idempotent).
 * The subscription is an explicit lifetime grant marked `internalDemo`, visible in the admin list;
 * claims are recomputed the normal way, so subscription checks still apply.
 */
export const adminProvisionInternalDemo = onCall({ region: REGION }, async (request) => {
  const c = caller(request);
  requireSuperAdmin(c);
  const record = await auth.getUser(c.uid);
  if (record.customClaims?.superAdmin !== true) fail('permission-denied', 'error.fn.notAllowed');
  const email = (record.email ?? '').toLowerCase();
  if (!email) fail('failed-precondition', 'error.invalidInput');

  const tenantId = c.uid;
  const refs = {
    user: db.doc(`users/${tenantId}`),
    tenant: db.doc(`tenants/${tenantId}`),
    store: db.doc(`stores/${tenantId}`),
    subscription: db.doc(`subscriptions/${tenantId}`),
    subdomain: db.doc(`storeSubdomains/${INTERNAL_DEMO_SUBDOMAIN}`),
    cleanup: db.doc(`platformStorageCleanup/${tenantId}`),
  };

  const created = await db.runTransaction(async (tx) => {
    const [user, tenant, store, subscription, subdomain, cleanup] = await Promise.all([
      tx.get(refs.user),
      tx.get(refs.tenant),
      tx.get(refs.store),
      tx.get(refs.subscription),
      tx.get(refs.subdomain),
      tx.get(refs.cleanup),
    ]);
    if (tenantIdReserved(cleanup.exists ? (cleanup.data() as CleanupRecord) : undefined)) fail('failed-precondition', 'error.fn.notAllowed');

    const ownDemo = user.get('internalDemo') === true && user.get('tenantId') === tenantId && subscription.get('internalDemo') === true;
    if (ownDemo) return false;
    if (user.exists) fail('already-exists', 'error.fn.alreadySetUp');
    if (tenant.exists || store.exists || subscription.exists) fail('failed-precondition', 'error.fn.notAllowed');
    if (subdomain.exists) fail('already-exists', 'error.subdomainTaken');

    writeNewTenant(tx, {
      uid: tenantId,
      email,
      fullName: record.displayName || 'Platform admin',
      storeName: INTERNAL_DEMO_STORE_NAME,
      subdomain: INTERNAL_DEMO_SUBDOMAIN,
      phone: '000',
      subscription: {
        activated: true,
        lifetime: true,
        trial: false,
        startsAt: Timestamp.fromMillis(Date.now()),
        updatedBy: c.uid,
      },
      marker: { internalDemo: true },
    });
    tx.set(db.collection('platformAudit').doc(), {
      action: 'internal_demo_created',
      tenantId,
      uid: c.uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    return true;
  });

  await syncUserClaims(c.uid);
  return { ok: true as const, tenantId, created };
});
