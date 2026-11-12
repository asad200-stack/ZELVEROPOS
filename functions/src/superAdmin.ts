import { FieldValue, Timestamp, type DocumentData } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { auth, db, storage } from './admin.js';
import { revokeTenantSessions, syncTenantClaims } from './claims.js';
import { REGION, SUPER_ADMIN_EMAILS } from './config.js';
import { fail } from './errors.js';
import { planSubscriptionUpdate } from './subscriptionOutcome.js';
import {
  cleanupAttention,
  describedMembers,
  judgeAccountAbsence,
  provenTenantPrefix,
  requiredUserDocs,
  tenantStoragePrefix,
  type AbsenceEvidence,
  type CleanupOutcome,
  type CleanupRecord,
} from './storageCleanup.js';
import { caller, parse, requireSuperAdmin } from './validate.js';

function allowList(): string[] {
  return SUPER_ADMIN_EMAILS.value()
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Grants the super admin claim to a verified e-mail listed in SUPER_ADMIN_EMAILS. */
export const bootstrapSuperAdmin = onCall({ region: REGION }, async (request) => {
  const c = caller(request);
  if (!c.emailVerified) fail('failed-precondition', 'error.fn.emailNotVerified');
  if (!c.email || !allowList().includes(c.email)) fail('permission-denied', 'error.fn.notAllowed');
  const record = await auth.getUser(c.uid);
  await auth.setCustomUserClaims(c.uid, { ...(record.customClaims ?? {}), superAdmin: true });
  return { ok: true as const };
});

const ms = (v: unknown): number | null => {
  const t = v as { toMillis?: () => number } | null | undefined;
  return typeof t?.toMillis === 'function' ? t.toMillis() : null;
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export const adminListAccounts = onCall({ region: REGION, timeoutSeconds: 120 }, async (request) => {
  requireSuperAdmin(caller(request));

  const [ownersSnap, subUsersSnap] = await Promise.all([
    db.collection('users').where('role', '==', 'owner').get(),
    db.collection('users').where('role', '==', 'subUser').select('tenantId').get(),
  ]);
  const subCounts = new Map<string, number>();
  for (const d of subUsersSnap.docs) {
    const t = String(d.get('tenantId') ?? '');
    subCounts.set(t, (subCounts.get(t) ?? 0) + 1);
  }

  const owners = ownersSnap.docs;
  const tenantIdOf = (p: DocumentData, uid: string) => String(p.tenantId ?? uid);
  const subscriptions = new Map<string, DocumentData | undefined>();
  for (const group of chunk(owners, 300)) {
    const snaps = await db.getAll(...group.map((d) => db.doc(`subscriptions/${tenantIdOf(d.data(), d.id)}`)));
    for (const s of snaps) subscriptions.set(s.id, s.data());
  }
  const lastSignIn = new Map<string, number | null>();
  for (const group of chunk(owners, 100)) {
    const result = await auth.getUsers(group.map((d) => ({ uid: d.id })));
    for (const u of result.users) {
      const t = u.metadata.lastSignInTime ? Date.parse(u.metadata.lastSignInTime) : NaN;
      lastSignIn.set(u.uid, Number.isFinite(t) ? t : null);
    }
  }

  const accounts = owners.map((d) => {
    const p = d.data();
    const tenantId = tenantIdOf(p, d.id);
    const sub = subscriptions.get(tenantId);
    return {
      uid: d.id,
      tenantId,
      email: String(p.email ?? ''),
      fullName: String(p.fullName ?? ''),
      storeName: String(p.storeName ?? ''),
      subdomain: String(p.subdomain ?? ''),
      phone: String(p.phone ?? ''),
      createdAt: ms(p.createdAt),
      lastSignInAt: lastSignIn.get(d.id) ?? null,
      subUserCount: subCounts.get(tenantId) ?? 0,
      internalDemo: sub?.internalDemo === true,
      subscription: {
        activated: sub?.activated === true,
        lifetime: sub?.lifetime === true,
        startsAt: ms(sub?.startsAt),
        endsAt: ms(sub?.endsAt),
        trial: sub?.trial === true,
        status: typeof sub?.status === 'string' ? sub.status : null,
      },
    };
  });
  return { accounts };
});

const uidField = z.string().min(1).max(128);
const daysField = z.number().int().min(1).max(3650);

const setSubscriptionSchema = z.discriminatedUnion('action', [
  z.object({ uid: uidField, action: z.literal('activate'), days: daysField }),
  z.object({ uid: uidField, action: z.literal('extend'), days: daysField }),
  z.object({ uid: uidField, action: z.literal('lifetime') }),
  z.object({ uid: uidField, action: z.literal('deactivate') }),
]);

async function requireOwnerAccount(uid: string): Promise<DocumentData> {
  const snap = await db.doc(`users/${uid}`).get();
  const d = snap.data();
  if (!d || d.role !== 'owner') fail('not-found', 'error.fn.userNotFound');
  return d;
}

export const adminSetSubscription = onCall({ region: REGION }, async (request) => {
  const c = caller(request);
  requireSuperAdmin(c);
  const input = parse(setSubscriptionSchema, request.data);
  const owner = await requireOwnerAccount(input.uid);
  const tenantId = String(owner.tenantId ?? input.uid);

  const ref = db.doc(`subscriptions/${tenantId}`);
  const outcome = await db.runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data() ?? {};
    const now = Date.now();
    const planned = planSubscriptionUpdate({
      activated: current.activated === true,
      lifetime: current.lifetime === true,
      status: typeof current.status === 'string' ? current.status : null,
      endsAtMs: ms(current.endsAt),
    }, input.action, now, 'days' in input ? input.days : 0);
    const base = { updatedAt: FieldValue.serverTimestamp(), updatedBy: c.uid, trial: false };
    if (input.action === 'deactivate') {
      tx.set(ref, { ...base, activated: false, lifetime: false }, { merge: true });
    } else if (input.action === 'lifetime') {
      tx.set(ref, {
        ...base,
        activated: true,
        lifetime: true,
        startsAt: current.startsAt ?? Timestamp.fromMillis(now),
      }, { merge: true });
    } else {
      tx.set(ref, {
        ...base,
        activated: true,
        lifetime: false,
        startsAt: input.action === 'activate' ? Timestamp.fromMillis(now) : (current.startsAt ?? Timestamp.fromMillis(now)),
        endsAt: Timestamp.fromMillis(planned.endsAtMs ?? now),
      }, { merge: true });
    }
    return { ok: true as const, writesEnabled: planned.writesEnabled, closed: planned.closed };
  });

  await syncTenantClaims(tenantId);
  if (input.action === 'deactivate') await revokeTenantSessions(tenantId);
  return outcome;
});

const deleteSchema = z.object({ uid: uidField, confirm: z.string().trim().min(1).max(64) });
const retrySchema = z.object({ tenantId: uidField });
const MEMBER_ID = /^[A-Za-z0-9_-]{1,128}$/;
const STORED_SUBDOMAIN = /^[A-Za-z0-9-]{1,64}$/;

interface CleanupReply {
  ok: true;
  accountDeleted: boolean;
  storageCleanup: 'complete' | 'pending';
  outcome: CleanupOutcome;
}

function cleanupRef(tenantId: string) {
  return db.doc(`platformStorageCleanup/${tenantId}`);
}

function authUserMissing(error: unknown): boolean {
  const code = (error as { code?: string; errorInfo?: { code?: string } }).code
    ?? (error as { errorInfo?: { code?: string } }).errorInfo?.code;
  return code === 'auth/user-not-found';
}

/** Removes one proven tenant prefix. Emulator tests can force a single failure without changing production. */
async function removeTenantPrefix(prefix: string): Promise<void> {
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    const hook = db.doc('platformTestHooks/storageCleanup');
    const snap = await hook.get();
    if (snap.exists && snap.get('failPrefix') === prefix) {
      await hook.delete();
      throw new Error('storage cleanup failed');
    }
  }
  await storage().deleteFiles({ prefix });
}

/** Emulator-only interruption after the account records are gone and before the cleanup flag is set. */
async function crashBeforeAccountDeletedFlag(tenantId: string): Promise<void> {
  if (process.env.FUNCTIONS_EMULATOR !== 'true') return;
  const hook = db.doc('platformTestHooks/storageCleanup');
  const snap = await hook.get();
  if (!snap.exists || snap.get('crashTenant') !== tenantId) return;
  await hook.set({ crashTenant: FieldValue.delete() }, { merge: true });
  fail('internal', 'error.unexpected');
}

async function collectAbsence(tenantId: string, record: CleanupRecord): Promise<AbsenceEvidence | null> {
  const members = describedMembers(record);
  if (!members) return null;
  try {
    const userIds = requiredUserDocs(tenantId, members.memberUids);
    const [tenantSnap, storeSnap, subscriptionSnap, subdomainSnap, usersSnap, userSnaps, collections] = await Promise.all([
      db.doc(`tenants/${tenantId}`).get(),
      db.doc(`stores/${tenantId}`).get(),
      db.doc(`subscriptions/${tenantId}`).get(),
      members.subdomain ? db.doc(`storeSubdomains/${members.subdomain}`).get() : Promise.resolve(null),
      db.collection('users').where('tenantId', '==', tenantId).limit(5).get(),
      db.getAll(...userIds.map((uid) => db.doc(`users/${uid}`))),
      db.doc(`tenants/${tenantId}`).listCollections(),
    ]);
    const authUserExists: Record<string, boolean | null> = {};
    for (const uid of members.memberUids) {
      try {
        await auth.getUser(uid);
        authUserExists[uid] = true;
      } catch (error) {
        authUserExists[uid] = authUserMissing(error) ? false : null;
      }
    }
    const userDocExists: Record<string, boolean> = {};
    userSnaps.forEach((snap, index) => {
      const uid = userIds[index];
      if (uid) userDocExists[uid] = snap.exists;
    });
    return {
      tenantDocExists: tenantSnap.exists,
      tenantSubcollectionCount: collections.length,
      storeDocExists: storeSnap.exists,
      subscriptionDocExists: subscriptionSnap.exists,
      subdomainDocExists: subdomainSnap?.exists === true,
      usersWithTenant: usersSnap.size,
      userDocExists,
      authUserExists,
    };
  } catch (error) {
    console.error('[storageCleanup] verification failed', tenantId, error);
    return null;
  }
}

async function noteCleanup(tenantId: string, outcome: CleanupOutcome, extra: Record<string, unknown> = {}): Promise<void> {
  await cleanupRef(tenantId).set({
    lastOutcome: outcome,
    lastAttemptAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    ...extra,
  }, { merge: true });
}

async function finishStorageCleanup(tenantId: string): Promise<CleanupReply> {
  const ref = cleanupRef(tenantId);
  const snap = await ref.get();
  const record = snap.data() as CleanupRecord | undefined;
  if (!record) fail('not-found', 'error.fn.userNotFound');
  if (record.storageCleanup === 'complete') {
    return { ok: true, accountDeleted: record.accountDeleted === true, storageCleanup: 'complete', outcome: 'complete' };
  }
  const prefix = provenTenantPrefix(tenantId, record);
  if (!prefix) fail('failed-precondition', 'error.fn.notAllowed');

  const evidence = await collectAbsence(tenantId, record);
  const verdict = evidence ? judgeAccountAbsence(tenantId, record, evidence) : 'ambiguous';
  if (verdict !== 'absent') {
    const outcome = verdict === 'present' ? 'account-remains' : 'unverified';
    await noteCleanup(tenantId, outcome, verdict === 'present' ? { accountDeleted: false } : {});
    return {
      ok: true,
      accountDeleted: verdict === 'present' ? false : record.accountDeleted === true,
      storageCleanup: 'pending',
      outcome,
    };
  }

  if (record.accountDeleted !== true) {
    await ref.set({ accountDeleted: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    const fresh = (await ref.get()).data() as CleanupRecord | undefined;
    const againEvidence = fresh ? await collectAbsence(tenantId, fresh) : null;
    const again = againEvidence && fresh ? judgeAccountAbsence(tenantId, fresh, againEvidence) : 'ambiguous';
    if (again !== 'absent') {
      const outcome = again === 'present' ? 'account-remains' : 'unverified';
      await noteCleanup(tenantId, outcome, { accountDeleted: false });
      return { ok: true, accountDeleted: false, storageCleanup: 'pending', outcome };
    }
  }

  const finalRecord = (await ref.get()).data() as CleanupRecord | undefined;
  const finalEvidence = finalRecord ? await collectAbsence(tenantId, finalRecord) : null;
  const finalVerdict = finalEvidence && finalRecord ? judgeAccountAbsence(tenantId, finalRecord, finalEvidence) : 'ambiguous';
  if (finalVerdict !== 'absent') {
    const outcome = finalVerdict === 'present' ? 'account-remains' : 'unverified';
    await noteCleanup(tenantId, outcome, finalVerdict === 'present' ? { accountDeleted: false } : {});
    return {
      ok: true,
      accountDeleted: finalVerdict === 'present' ? false : finalRecord?.accountDeleted === true,
      storageCleanup: 'pending',
      outcome,
    };
  }

  try {
    await removeTenantPrefix(prefix);
  } catch (error) {
    console.warn('[storageCleanup] pending', tenantId);
    console.error(error);
    await noteCleanup(tenantId, 'storage-failed');
    return { ok: true, accountDeleted: true, storageCleanup: 'pending', outcome: 'storage-failed' };
  }
  await ref.set({
    storageCleanup: 'complete',
    tenantReserved: true,
    lastOutcome: 'complete',
    updatedAt: FieldValue.serverTimestamp(),
    lastAttemptAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { ok: true, accountDeleted: true, storageCleanup: 'complete', outcome: 'complete' };
}

/** Permanently deletes a store: all staff accounts, tenant data, files and the owner account. */
export const adminDeleteAccount = onCall({ region: REGION, timeoutSeconds: 540, memory: '512MiB' }, async (request) => {
  const c = caller(request);
  requireSuperAdmin(c);
  const input = parse(deleteSchema, request.data);
  if (input.uid === c.uid) fail('failed-precondition', 'error.fn.notAllowed');
  const owner = await requireOwnerAccount(input.uid);
  const subdomain = String(owner.subdomain ?? '');
  if (input.confirm.toLowerCase() !== subdomain.toLowerCase()) fail('invalid-argument', 'error.fn.confirmMismatch');

  const tenantId = String(owner.tenantId ?? input.uid);
  const prefix = tenantStoragePrefix(tenantId);
  if (!prefix) fail('failed-precondition', 'error.fn.notAllowed');
  if (subdomain && !STORED_SUBDOMAIN.test(subdomain)) fail('failed-precondition', 'error.fn.notAllowed');
  const members = await db.collection('users').where('tenantId', '==', tenantId).get();
  const memberUids = [...new Set([input.uid, ...members.docs.map((doc) => doc.id)])];
  if (memberUids.length === 0 || memberUids.length > 1000 || memberUids.some((uid) => !MEMBER_ID.test(uid))) {
    fail('failed-precondition', 'error.fn.notAllowed');
  }
  await cleanupRef(tenantId).set({
    tenantId,
    prefix,
    ownerUid: input.uid,
    memberUids,
    subdomain,
    accountDeleted: false,
    storageCleanup: 'pending',
    tenantReserved: true,
    updatedAt: FieldValue.serverTimestamp(),
  });

  for (const uid of memberUids) {
    try {
      await auth.deleteUser(uid);
    } catch (e) {
      if (!authUserMissing(e)) throw e;
    }
    await db.doc(`users/${uid}`).delete();
  }

  await db.recursiveDelete(db.doc(`tenants/${tenantId}`));
  const batch = db.batch();
  batch.delete(db.doc(`stores/${tenantId}`));
  batch.delete(db.doc(`subscriptions/${tenantId}`));
  if (subdomain) batch.delete(db.doc(`storeSubdomains/${subdomain}`));
  batch.delete(db.doc(`users/${tenantId}`));
  await batch.commit();

  await crashBeforeAccountDeletedFlag(tenantId);
  await cleanupRef(tenantId).set({ accountDeleted: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  const result = await finishStorageCleanup(tenantId);
  console.info('[adminDeleteAccount] deleted tenant', tenantId, 'by', c.uid, result.storageCleanup);
  return { ...result, tenantId };
});

/** Retries file removal after verifying the recorded account is gone. Does not recreate it. */
export const adminRetryStorageCleanup = onCall({ region: REGION, timeoutSeconds: 300 }, async (request) => {
  requireSuperAdmin(caller(request));
  const input = parse(retrySchema, request.data);
  const snap = await cleanupRef(input.tenantId).get();
  if (!snap.exists) fail('not-found', 'error.fn.userNotFound');
  return finishStorageCleanup(input.tenantId);
});

/** Pending file-cleanup records. The list does not include storage prefixes or member ids. */
export const adminListStorageCleanup = onCall({ region: REGION, timeoutSeconds: 60 }, async (request) => {
  requireSuperAdmin(caller(request));
  const snap = await db.collection('platformStorageCleanup').where('storageCleanup', '==', 'pending').get();
  const records = snap.docs.flatMap((doc) => {
    const row = cleanupAttention(doc.id, doc.data() as CleanupRecord);
    return row ? [row] : [];
  });
  return { records };
});
