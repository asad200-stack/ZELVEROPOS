import { FieldValue } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { auth, db } from './admin.js';
import { subUntilOf, syncUserClaims } from './claims.js';
import { fail } from './errors.js';
import { REGION } from './config.js';
import { requireLiveOwner } from './liveUser.js';
import { normalizePermissions } from './permissions.js';
import { caller, parse, trimmed, type Caller } from './validate.js';

const MAX_SUB_USERS = 50;

const permissionsField = z.record(z.string(), z.boolean());
const passwordField = z.string().min(8).max(128);

function authErrorKey(e: unknown): string | null {
  const code = (e as { code?: string }).code ?? '';
  if (code === 'auth/email-already-exists') return 'error.auth.emailInUse';
  if (code === 'auth/invalid-password') return 'error.auth.weakPassword';
  if (code === 'auth/invalid-email') return 'error.auth.invalidEmail';
  return null;
}

async function requireActiveOwner(c: Caller): Promise<string> {
  const tenantId = await requireLiveOwner(c);
  const sub = (await db.doc(`subscriptions/${tenantId}`).get()).data();
  if (subUntilOf(sub) <= Date.now()) fail('failed-precondition', 'error.fn.subscriptionInactive');
  return tenantId;
}

/** Loads a sub-user profile and checks it belongs to the caller's tenant. */
async function ownedSubUser(tenantId: string, uid: string) {
  const ref = db.doc(`users/${uid}`);
  const snap = await ref.get();
  const d = snap.data();
  if (!d || d.role !== 'subUser' || d.tenantId !== tenantId) fail('not-found', 'error.fn.userNotFound');
  return { ref, data: d };
}

const createSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: passwordField,
  fullName: trimmed(80),
  permissions: permissionsField,
});

/**
 * Creates a staff account. Always creates a NEW Auth user: an existing e-mail is rejected so an
 * owner can never take over someone else's account (CATCH POS re-used existing accounts).
 */
export const createSubUser = onCall({ region: REGION }, async (request) => {
  const c = caller(request);
  const tenantId = await requireActiveOwner(c);
  const input = parse(createSchema, request.data);

  const count = await db.collection('users').where('tenantId', '==', tenantId).where('role', '==', 'subUser').count().get();
  if (count.data().count >= MAX_SUB_USERS) fail('resource-exhausted', 'error.fn.notAllowed');

  const owner = (await db.doc(`users/${c.uid}`).get()).data() ?? {};
  let uid: string;
  try {
    const record = await auth.createUser({
      email: input.email,
      password: input.password,
      displayName: input.fullName,
      emailVerified: true,
    });
    uid = record.uid;
  } catch (e) {
    const key = authErrorKey(e);
    if (key) fail(key === 'error.auth.emailInUse' ? 'already-exists' : 'invalid-argument', key);
    throw e;
  }

  try {
    await db.doc(`users/${uid}`).set({
      uid,
      email: input.email,
      fullName: input.fullName,
      role: 'subUser',
      tenantId,
      parentUid: c.uid,
      isActive: true,
      permissions: normalizePermissions(input.permissions),
      storeName: owner.storeName ?? '',
      subdomain: owner.subdomain ?? '',
      phone: '',
      claimsVersion: 0,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: c.uid,
    });
    await syncUserClaims(uid);
  } catch (e) {
    await Promise.allSettled([auth.deleteUser(uid), db.doc(`users/${uid}`).delete()]);
    throw e;
  }
  return { uid };
});

const updateSchema = z.object({
  uid: z.string().min(1).max(128),
  fullName: trimmed(80).optional(),
  permissions: permissionsField.optional(),
  isActive: z.boolean().optional(),
  password: passwordField.optional(),
});

export const updateSubUser = onCall({ region: REGION }, async (request) => {
  const c = caller(request);
  const tenantId = await requireActiveOwner(c);
  const input = parse(updateSchema, request.data);
  const { ref } = await ownedSubUser(tenantId, input.uid);

  const authUpdate: { displayName?: string; password?: string; disabled?: boolean } = {};
  if (input.fullName !== undefined) authUpdate.displayName = input.fullName;
  if (input.password !== undefined) authUpdate.password = input.password;
  if (input.isActive !== undefined) authUpdate.disabled = !input.isActive;
  if (Object.keys(authUpdate).length) {
    try {
      await auth.updateUser(input.uid, authUpdate);
    } catch (e) {
      const key = authErrorKey(e);
      if (key) fail('invalid-argument', key);
      throw e;
    }
  }

  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (input.fullName !== undefined) patch.fullName = input.fullName;
  if (input.permissions !== undefined) patch.permissions = normalizePermissions(input.permissions);
  if (input.isActive !== undefined) patch.isActive = input.isActive;
  await ref.update(patch);
  await syncUserClaims(input.uid);
  if (input.isActive === false || input.password !== undefined) await auth.revokeRefreshTokens(input.uid);
  return { ok: true as const };
});

export const deleteSubUser = onCall({ region: REGION }, async (request) => {
  const c = caller(request);
  const tenantId = await requireActiveOwner(c);
  const { uid } = parse(z.object({ uid: z.string().min(1).max(128) }), request.data);
  const { ref } = await ownedSubUser(tenantId, uid);
  try {
    await auth.deleteUser(uid);
  } catch (e) {
    if ((e as { code?: string }).code !== 'auth/user-not-found') throw e;
  }
  await ref.delete();
  return { ok: true as const };
});
