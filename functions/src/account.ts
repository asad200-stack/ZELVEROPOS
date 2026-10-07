import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { auth, db } from './admin.js';
import { syncUserClaims } from './claims.js';
import { DAY_MS, REGION, SIGNUP_TRIAL_DAYS, SUBDOMAIN_RE } from './config.js';
import { fail } from './errors.js';
import { caller, parse, trimmed } from './validate.js';

const subdomainField = z.string().trim().toLowerCase().regex(SUBDOMAIN_RE);

/** Unknown keys (e.g. an `email` sent by an older client) are stripped and never read. */
const availabilitySchema = z.object({ subdomain: subdomainField });

/**
 * Public pre-check used by the signup form (the transaction in completeSignup is authoritative).
 * Store subdomains are public; account e-mails are not: nothing here may depend on an e-mail
 * address, or the endpoint would defeat Firebase Auth e-mail enumeration protection.
 */
export const checkSignupAvailability = onCall({ region: REGION }, async (request) => {
  const input = parse(availabilitySchema, request.data);
  const sub = await db.doc(`storeSubdomains/${input.subdomain}`).get();
  return { subdomainAvailable: !sub.exists };
});

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
  const tenantRef = db.doc(`tenants/${tenantId}`);

  await db.runTransaction(async (tx) => {
    const [userSnap, subdomainSnap] = await Promise.all([tx.get(userRef), tx.get(subdomainRef)]);
    if (userSnap.exists) {
      const profile = userSnap.data()!;
      if (profile.role === 'owner' && profile.tenantId === tenantId) return;
      fail('already-exists', 'error.fn.alreadySetUp');
    }
    if (subdomainSnap.exists && subdomainSnap.get('tenantId') !== tenantId) fail('already-exists', 'error.subdomainTaken');

    const now = FieldValue.serverTimestamp();
    const nowMs = Date.now();
    tx.set(userRef, {
      uid: c.uid,
      email,
      fullName: input.fullName,
      role: 'owner',
      tenantId,
      isActive: true,
      permissions: {},
      storeName: input.storeName,
      subdomain: input.subdomain,
      phone: input.phone,
      claimsVersion: 0,
      createdAt: now,
    });
    tx.set(db.doc(`stores/${tenantId}`), {
      ownerUid: c.uid,
      ownerEmail: email,
      ownerName: input.fullName,
      storeName: input.storeName,
      subdomain: input.subdomain,
      phone: input.phone,
      createdAt: now,
    });
    tx.set(subdomainRef, { tenantId, createdAt: now });
    tx.set(tenantRef, { ownerUid: c.uid, createdAt: now });
    tx.set(tenantRef.collection('settings').doc('main'), {
      storeName: input.storeName,
      storePhone: input.phone,
      storeAddress: '',
      receiptFooter: '',
      updatedAt: now,
    });
    tx.set(tenantRef.collection('counters').doc('sales'), { nextId: 1, updatedAt: now });
    tx.set(tenantRef.collection('counters').doc('purchases'), { nextId: 1, updatedAt: now });
    tx.set(tenantRef.collection('cashbox').doc('summary'), { usdCents: 0, lbp: 0, lastTxId: null, updatedAt: now });
    tx.set(tenantRef.collection('lists').doc('categories'), { names: [] });
    tx.set(db.doc(`subscriptions/${tenantId}`), {
      activated: trialDays > 0,
      lifetime: false,
      trial: trialDays > 0,
      startsAt: trialDays > 0 ? Timestamp.fromMillis(nowMs) : null,
      endsAt: trialDays > 0 ? Timestamp.fromMillis(nowMs + trialDays * DAY_MS) : null,
      updatedAt: now,
    });
  });

  await syncUserClaims(c.uid);
  return { tenantId };
});

/** Re-derives the caller's claims from Firestore (repairs missing or stale claims). */
export const refreshMyClaims = onCall({ region: REGION }, async (request) => {
  const c = caller(request);
  await syncUserClaims(c.uid);
  return { ok: true as const };
});
