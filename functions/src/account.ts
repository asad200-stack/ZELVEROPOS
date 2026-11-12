import { FieldValue, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { auth, db } from './admin.js';
import { syncUserClaims } from './claims.js';
import { grantEveryoneEntitlementsForNewTenant } from './featureCenter.js';
import { DAY_MS, REGION, SIGNUP_TRIAL_DAYS, SUBDOMAIN_RE } from './config.js';
import { fail } from './errors.js';
import { tenantIdReserved, type CleanupRecord } from './storageCleanup.js';
import { caller, parse, trimmed } from './validate.js';

const subdomainField = z.string().trim().toLowerCase().regex(SUBDOMAIN_RE);

/** Unknown keys (e.g. an `email` sent by an older client) are stripped and never read. */
const availabilitySchema = z.object({ subdomain: subdomainField });

/**
 * Public pre-check used by the signup form (the transaction in completeSignup is authoritative).
 * Store subdomains are public; account e-mails are not: nothing here may depend on an e-mail
 * address, or the endpoint would defeat Firebase Auth e-mail enumeration protection.
 */
export const checkSignupAvailability = onCall({ region: REGION, enforceAppCheck: false }, async (request) => {
  const input = parse(availabilitySchema, request.data);
  const sub = await db.doc(`storeSubdomains/${input.subdomain}`).get();
  return { subdomainAvailable: !sub.exists };
});

export interface NewTenant {
  uid: string;
  email: string;
  fullName: string;
  storeName: string;
  subdomain: string;
  phone: string;
  subscription: Record<string, unknown>;
  /** Only the internal demo store carries a marker; customer stores are written exactly as before. */
  marker?: Record<string, unknown>;
}

/** Writes a brand-new store owned by `uid` (tenant id = uid). Callers must have checked that nothing exists. */
export function writeNewTenant(tx: Transaction, t: NewTenant): void {
  const tenantId = t.uid;
  const now = FieldValue.serverTimestamp();
  const marker = t.marker ?? {};
  const tenantRef = db.doc(`tenants/${tenantId}`);
  tx.set(db.doc(`users/${t.uid}`), {
    uid: t.uid,
    email: t.email,
    fullName: t.fullName,
    role: 'owner',
    tenantId,
    isActive: true,
    permissions: {},
    storeName: t.storeName,
    subdomain: t.subdomain,
    phone: t.phone,
    claimsVersion: 0,
    createdAt: now,
    ...marker,
  });
  tx.set(db.doc(`stores/${tenantId}`), {
    ownerUid: t.uid,
    ownerEmail: t.email,
    ownerName: t.fullName,
    storeName: t.storeName,
    subdomain: t.subdomain,
    phone: t.phone,
    createdAt: now,
    ...marker,
  });
  tx.set(db.doc(`storeSubdomains/${t.subdomain}`), { tenantId, createdAt: now });
  tx.set(tenantRef, { ownerUid: t.uid, createdAt: now, ...marker });
  tx.set(tenantRef.collection('settings').doc('main'), {
    storeName: t.storeName,
    storePhone: t.phone,
    storeAddress: '',
    receiptFooter: '',
    updatedAt: now,
  });
  tx.set(tenantRef.collection('counters').doc('sales'), { nextId: 1, updatedAt: now });
  tx.set(tenantRef.collection('counters').doc('purchases'), { nextId: 1, updatedAt: now });
  tx.set(tenantRef.collection('cashbox').doc('summary'), { usdCents: 0, lbp: 0, lastTxId: null, updatedAt: now });
  tx.set(tenantRef.collection('lists').doc('categories'), { names: [] });
  tx.set(db.doc(`subscriptions/${tenantId}`), { ...t.subscription, ...marker, updatedAt: now });
}

const signupSchema = z.object({
  fullName: trimmed(80),
  storeName: trimmed(80),
  subdomain: subdomainField,
  phone: z.string().trim().min(3).max(30),
});

/**
 * Creates the caller's store (tenant = the owner's uid). Idempotent: calling it again for an
 * already set-up owner only re-syncs claims. The subdomain is reserved inside the transaction.
 */
export const completeSignup = onCall({ region: REGION }, async (request) => {
  const c = caller(request);
  const input = parse(signupSchema, request.data);
  const record = await auth.getUser(c.uid);
  const email = (record.email ?? '').toLowerCase();
  if (!email) fail('failed-precondition', 'error.invalidInput');

  const trialDays = Math.max(0, SIGNUP_TRIAL_DAYS.value());
  const tenantId = c.uid;
  const userRef = db.doc(`users/${c.uid}`);
  const subdomainRef = db.doc(`storeSubdomains/${input.subdomain}`);

  await db.runTransaction(async (tx) => {
    const [userSnap, subdomainSnap, cleanupSnap] = await Promise.all([
      tx.get(userRef),
      tx.get(subdomainRef),
      tx.get(db.doc(`platformStorageCleanup/${tenantId}`)),
    ]);
    if (tenantIdReserved(cleanupSnap.exists ? cleanupSnap.data() as CleanupRecord : undefined)) {
      fail('failed-precondition', 'error.fn.notAllowed');
    }
    if (userSnap.exists) {
      const profile = userSnap.data()!;
      if (profile.role === 'owner' && profile.tenantId === tenantId) return;
      fail('already-exists', 'error.fn.alreadySetUp');
    }
    if (subdomainSnap.exists && subdomainSnap.get('tenantId') !== tenantId) fail('already-exists', 'error.subdomainTaken');

    const nowMs = Date.now();
    writeNewTenant(tx, {
      uid: c.uid,
      email,
      fullName: input.fullName,
      storeName: input.storeName,
      subdomain: input.subdomain,
      phone: input.phone,
      subscription: {
        activated: trialDays > 0,
        lifetime: false,
        trial: trialDays > 0,
        startsAt: trialDays > 0 ? Timestamp.fromMillis(nowMs) : null,
        endsAt: trialDays > 0 ? Timestamp.fromMillis(nowMs + trialDays * DAY_MS) : null,
      },
    });
  });

  await syncUserClaims(c.uid);
  await grantEveryoneEntitlementsForNewTenant(tenantId);
  return { tenantId };
});

/** Re-derives the caller's claims from Firestore (repairs missing or stale claims). */
export const refreshMyClaims = onCall({ region: REGION }, async (request) => {
  const c = caller(request);
  await syncUserClaims(c.uid);
  return { ok: true as const };
});
