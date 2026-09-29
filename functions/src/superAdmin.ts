import { FieldValue, Timestamp, type DocumentData } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { auth, db, storage } from './admin.js';
import { revokeTenantSessions, syncTenantClaims } from './claims.js';
import { DAY_MS, REGION, SUPER_ADMIN_EMAILS } from './config.js';
import { fail } from './errors.js';
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
  const subscriptions = new Map<string, DocumentData | undefined>();
  for (const group of chunk(owners, 300)) {
    const snaps = await db.getAll(...group.map((d) => db.doc(`subscriptions/${d.id}`)));
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
    const sub = subscriptions.get(d.id);
    return {
      uid: d.id,
      email: String(p.email ?? ''),
      fullName: String(p.fullName ?? ''),
      storeName: String(p.storeName ?? ''),
      subdomain: String(p.subdomain ?? ''),
      phone: String(p.phone ?? ''),
      createdAt: ms(p.createdAt),
      lastSignInAt: lastSignIn.get(d.id) ?? null,
      subUserCount: subCounts.get(d.id) ?? 0,
      subscription: {
        activated: sub?.activated === true,
        lifetime: sub?.lifetime === true,
        startsAt: ms(sub?.startsAt),
        endsAt: ms(sub?.endsAt),
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
  await requireOwnerAccount(input.uid);

  const ref = db.doc(`subscriptions/${input.uid}`);
  await db.runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data() ?? {};
    const now = Date.now();
    const base = { updatedAt: FieldValue.serverTimestamp(), updatedBy: c.uid, trial: false };
    switch (input.action) {
      case 'activate':
        tx.set(ref, {
          ...base,
          activated: true,
          lifetime: false,
          startsAt: Timestamp.fromMillis(now),
          endsAt: Timestamp.fromMillis(now + input.days * DAY_MS),
        }, { merge: true });
        break;
      case 'extend': {
        const currentEnd = ms(current.endsAt) ?? 0;
        const from = Math.max(now, currentEnd);
        tx.set(ref, {
          ...base,
          activated: true,
          lifetime: false,
          startsAt: current.startsAt ?? Timestamp.fromMillis(now),
          endsAt: Timestamp.fromMillis(from + input.days * DAY_MS),
        }, { merge: true });
        break;
      }
      case 'lifetime':
        tx.set(ref, { ...base, activated: true, lifetime: true, startsAt: current.startsAt ?? Timestamp.fromMillis(now) }, { merge: true });
        break;
      case 'deactivate':
        tx.set(ref, { ...base, activated: false, lifetime: false }, { merge: true });
        break;
    }
  });

  await syncTenantClaims(input.uid);
  if (input.action === 'deactivate') await revokeTenantSessions(input.uid);
  return { ok: true as const };
});

const deleteSchema = z.object({ uid: uidField, confirm: z.string().trim().min(1).max(64) });

/** Permanently deletes a store: all staff accounts, tenant data, files and the owner account. */
export const adminDeleteAccount = onCall({ region: REGION, timeoutSeconds: 540, memory: '512MiB' }, async (request) => {
  const c = caller(request);
  requireSuperAdmin(c);
  const input = parse(deleteSchema, request.data);
  if (input.uid === c.uid) fail('failed-precondition', 'error.fn.notAllowed');
  const owner = await requireOwnerAccount(input.uid);
  const subdomain = String(owner.subdomain ?? '');
  if (input.confirm.toLowerCase() !== subdomain.toLowerCase()) fail('invalid-argument', 'error.fn.confirmMismatch');

  const tenantId = input.uid;
  const members = await db.collection('users').where('tenantId', '==', tenantId).get();
  for (const m of members.docs) {
    try {
      await auth.deleteUser(m.id);
    } catch (e) {
      if ((e as { code?: string }).code !== 'auth/user-not-found') throw e;
    }
    await m.ref.delete();
  }

  await db.recursiveDelete(db.doc(`tenants/${tenantId}`));
  const batch = db.batch();
  batch.delete(db.doc(`stores/${tenantId}`));
  batch.delete(db.doc(`subscriptions/${tenantId}`));
  if (subdomain) batch.delete(db.doc(`storeSubdomains/${subdomain}`));
  batch.delete(db.doc(`users/${tenantId}`));
  await batch.commit();

  try {
    await storage().deleteFiles({ prefix: `tenants/${tenantId}/` });
  } catch (e) {
    console.warn('[adminDeleteAccount] storage cleanup failed', tenantId, e);
  }
  console.info('[adminDeleteAccount] deleted tenant', tenantId, 'by', c.uid);
  return { ok: true as const };
});
