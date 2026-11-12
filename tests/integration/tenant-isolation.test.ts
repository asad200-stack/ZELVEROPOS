import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAdmin, call, callOk, clearAuth, clearFirestore, createEnv, createUser, DAY, readDoc, sleep } from './helpers';

const requireFromFunctions = createRequire(resolve(process.cwd(), 'functions/package.json'));

const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099'}`;
const OWNER = 'iso-owner';
const STAFF = 'iso-staff';
const TENANT = 'iso-store-tenant';
const OTHER_OWNER = 'iso-other-owner';
const OTHER_STAFF = 'iso-other-staff';
const OTHER = 'iso-other-tenant';
const ADMIN = 'iso-admin';
const LIFETIME_UNTIL = 4_102_444_800_000;
const STORAGE_BUCKET = 'demo-zelvero.appspot.com';

let env: RulesTestEnvironment;
let adminToken: string;
let ownerToken: string;
const claimsBefore = new Map<string, string>();

type AuthRecord = { validSince?: string; customAttributes?: string } | null;

async function lookup(uid: string): Promise<AuthRecord> {
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:lookup`, {
    method: 'POST',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: [uid] }),
  });
  const json = (await res.json()) as { users?: Array<{ validSince?: string; customAttributes?: string }> };
  return json.users?.[0] ?? null;
}

function claims(user: AuthRecord): { tenantId?: string; subUntil?: number; cv?: number } {
  return JSON.parse(user?.customAttributes ?? '{}') as { tenantId?: string; subUntil?: number; cv?: number };
}

function localStorageHost(raw: string): boolean {
  const host = raw.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  return /^(127\.0\.0\.1|localhost):\d+$/.test(host);
}

function endsOf(data: Record<string, unknown> | undefined): number {
  const endsAt = data?.endsAt as { toMillis?: () => number } | undefined;
  if (typeof endsAt?.toMillis !== 'function') throw new Error('subscription endsAt is missing');
  return endsAt.toMillis();
}

type StorageFile = { save: (data: string) => Promise<unknown>; exists: () => Promise<[boolean]> };
type StorageBucket = { file: (path: string) => StorageFile };

/** Account deletion removes `tenants/{tenantId}/` through the Admin SDK. The local emulator is required. */
function emulatorBucket(): StorageBucket {
  const host = process.env.STORAGE_EMULATOR_HOST || process.env.FIREBASE_STORAGE_EMULATOR_HOST || '';
  if (!localStorageHost(host)) {
    throw new Error(
      `Refusing account-deletion storage check because the storage host is "${host || 'unset'}". ` +
        'Cleanup must use the local Storage emulator and must not fall back to Google Cloud Storage.',
    );
  }
  const { initializeApp, getApps } = requireFromFunctions('firebase-admin/app') as {
    initializeApp: (options: { projectId: string; storageBucket: string }) => unknown;
    getApps: () => unknown[];
  };
  const { getStorage } = requireFromFunctions('firebase-admin/storage') as {
    getStorage: () => { bucket: (name: string) => StorageBucket };
  };
  if (!getApps().length) initializeApp({ projectId: 'demo-zelvero', storageBucket: STORAGE_BUCKET });
  return getStorage().bucket(STORAGE_BUCKET);
}

async function snapshotClaims(uid: string): Promise<void> {
  const user = await lookup(uid);
  claimsBefore.set(uid, user?.customAttributes ?? '');
}

describe('super admin uses owner.tenantId when it differs from the Auth uid', () => {
  beforeAll(async () => {
    env = await createEnv();
    await clearFirestore(env);
    await clearAuth();
    const future = Timestamp.fromMillis(Date.now() + 40 * DAY);
    await asAdmin(env, async (fs) => {
      const profile = (uid: string, tenantId: string, role: 'owner' | 'subUser', subdomain = '') => setDoc(doc(fs, `users/${uid}`), {
        uid,
        role,
        tenantId,
        isActive: true,
        email: `${uid}@test.local`,
        fullName: uid,
        storeName: tenantId,
        subdomain,
        phone: '',
        permissions: {},
        claimsVersion: 1,
        createdAt: Timestamp.now(),
      });
      await profile(OWNER, TENANT, 'owner', 'isostore');
      await profile(STAFF, TENANT, 'subUser');
      await profile(OTHER_OWNER, OTHER, 'owner', 'isoother');
      await profile(OTHER_STAFF, OTHER, 'subUser');
      await setDoc(doc(fs, `subscriptions/${TENANT}`), {
        activated: false,
        lifetime: false,
        trial: true,
        status: 'pending_activation',
        sentinel: 'real',
      });
      await setDoc(doc(fs, `subscriptions/${OWNER}`), {
        activated: true,
        lifetime: true,
        trial: false,
        status: 'decoy',
        endsAt: future,
        sentinel: 'uid',
      });
      await setDoc(doc(fs, `subscriptions/${OTHER}`), {
        activated: true,
        lifetime: false,
        trial: false,
        status: 'active',
        endsAt: future,
        sentinel: 'other',
      });
      await setDoc(doc(fs, `tenants/${TENANT}/settings/main`), { sentinel: 'real' });
      await setDoc(doc(fs, `tenants/${OWNER}/settings/main`), { sentinel: 'uid' });
      await setDoc(doc(fs, `tenants/${OTHER}/settings/main`), { sentinel: 'other' });
      await setDoc(doc(fs, `stores/${TENANT}`), { sentinel: 'real' });
      await setDoc(doc(fs, `stores/${OWNER}`), { sentinel: 'uid' });
      await setDoc(doc(fs, `stores/${OTHER}`), { sentinel: 'other' });
      await setDoc(doc(fs, `storeSubdomains/isostore`), { tenantId: TENANT });
      await setDoc(doc(fs, `storeSubdomains/isoother`), { tenantId: OTHER });
    });
    ownerToken = await createUser({ uid: OWNER, tenantId: TENANT, role: 'owner' });
    await createUser({ uid: STAFF, tenantId: TENANT, role: 'subUser' });
    await createUser({ uid: OTHER_OWNER, tenantId: OTHER, role: 'owner' });
    await createUser({ uid: OTHER_STAFF, tenantId: OTHER, role: 'subUser' });
    adminToken = await createUser({ uid: ADMIN, tenantId: ADMIN, role: 'owner', superAdmin: true });
    for (const uid of [OWNER, STAFF, OTHER_OWNER, OTHER_STAFF]) await snapshotClaims(uid);
  });

  afterAll(async () => {
    await env?.cleanup();
  });

  it('rejects a store owner who is not a super admin and leaves both tenants unchanged', async () => {
    for (const [name, data] of [
      ['adminListAccounts', {}],
      ['adminSetSubscription', { uid: OWNER, action: 'activate', days: 30 }],
      ['adminSetSubscription', { uid: OWNER, action: 'extend', days: 30 }],
      ['adminSetSubscription', { uid: OWNER, action: 'lifetime' }],
      ['adminDeleteAccount', { uid: OWNER, confirm: 'isostore' }],
    ] as const) {
      const denied = await call(ownerToken, name, data);
      expect(denied.error?.status, name).toBe('PERMISSION_DENIED');
    }
    expect((await readDoc(env, `subscriptions/${TENANT}`))?.sentinel).toBe('real');
    expect((await readDoc(env, `subscriptions/${OWNER}`))?.sentinel).toBe('uid');
    expect((await readDoc(env, `subscriptions/${OTHER}`))?.sentinel).toBe('other');
  });

  it('lists the subscription and staff count for the profile tenant, not the Auth uid', async () => {
    const { accounts } = await callOk<{ accounts: Array<{
      uid: string;
      tenantId: string;
      subUserCount: number;
      subscription: { activated: boolean; lifetime: boolean; trial: boolean; status: string | null; endsAt: number | null };
    }> }>(adminToken, 'adminListAccounts', {});
    const account = accounts.find((row) => row.uid === OWNER);
    const other = accounts.find((row) => row.uid === OTHER_OWNER);
    expect(account).toMatchObject({
      uid: OWNER,
      tenantId: TENANT,
      subUserCount: 1,
      subscription: { activated: false, lifetime: false, trial: true, status: 'pending_activation', endsAt: null },
    });
    expect(other).toMatchObject({
      uid: OTHER_OWNER,
      tenantId: OTHER,
      subUserCount: 1,
      subscription: { activated: true, lifetime: false, status: 'active' },
    });
    expect(accounts.some((row) => row.tenantId === OWNER)).toBe(false);
  });

  it('updates, resyncs, and later revokes only the authorized tenant', async () => {
    const started = Date.now();
    await callOk(adminToken, 'adminSetSubscription', { uid: OWNER, action: 'activate', days: 30 });
    const real = await readDoc(env, `subscriptions/${TENANT}`);
    const ends = (real?.endsAt as { toMillis: () => number }).toMillis();
    expect(real).toMatchObject({ activated: true, lifetime: false, trial: false, sentinel: 'real' });
    expect(ends).toBeGreaterThan(started + 29 * DAY);
    expect(ends).toBeLessThan(started + 31 * DAY);
    expect(await readDoc(env, `subscriptions/${OWNER}`)).toMatchObject({ activated: true, lifetime: true, status: 'decoy', sentinel: 'uid' });
    expect(await readDoc(env, `subscriptions/${OTHER}`)).toMatchObject({ status: 'active', sentinel: 'other' });

    for (const uid of [OWNER, STAFF]) {
      const next = claims(await lookup(uid));
      expect(next.tenantId).toBe(TENANT);
      expect(next.subUntil).toBe(ends);
      expect(next.cv).toBe(2);
      expect((await readDoc(env, `users/${uid}`))?.claimsVersion).toBe(2);
    }
    for (const uid of [OTHER_OWNER, OTHER_STAFF]) {
      expect((await lookup(uid))?.customAttributes).toBe(claimsBefore.get(uid));
      expect((await readDoc(env, `users/${uid}`))?.claimsVersion).toBe(1);
    }

    const staffDenied = await call(adminToken, 'adminSetSubscription', { uid: STAFF, action: 'extend', days: 5 });
    expect(staffDenied.error?.status).toBe('NOT_FOUND');
    const staffLifetime = await call(adminToken, 'adminSetSubscription', { uid: STAFF, action: 'lifetime' });
    expect(staffLifetime.error?.status).toBe('NOT_FOUND');
    expect(await readDoc(env, `subscriptions/${OTHER}`)).toMatchObject({ sentinel: 'other' });

    const decoyEnds = endsOf(await readDoc(env, `subscriptions/${OWNER}`));
    const otherEnds = endsOf(await readDoc(env, `subscriptions/${OTHER}`));
    const extendedResult = await callOk<{ ok: true; writesEnabled: boolean; closed: boolean }>(adminToken, 'adminSetSubscription', { uid: OWNER, action: 'extend', days: 10 });
    expect(extendedResult).toEqual({ ok: true, writesEnabled: true, closed: false });
    const extended = await readDoc(env, `subscriptions/${TENANT}`);
    const extendedEnds = endsOf(extended);
    expect(extendedEnds).toBe(ends + 10 * DAY);
    expect(extended).toMatchObject({ activated: true, lifetime: false, trial: false, sentinel: 'real' });
    expect(endsOf(await readDoc(env, `subscriptions/${OWNER}`))).toBe(decoyEnds);
    expect(endsOf(await readDoc(env, `subscriptions/${OTHER}`))).toBe(otherEnds);
    for (const uid of [OWNER, STAFF]) {
      const next = claims(await lookup(uid));
      expect(next.tenantId).toBe(TENANT);
      expect(next.subUntil).toBe(extendedEnds);
      expect(next.cv).toBe(3);
    }

    const lifetimeResult = await callOk<{ ok: true; writesEnabled: boolean; closed: boolean }>(adminToken, 'adminSetSubscription', { uid: OWNER, action: 'lifetime' });
    expect(lifetimeResult).toEqual({ ok: true, writesEnabled: true, closed: false });
    const lifetime = await readDoc(env, `subscriptions/${TENANT}`);
    expect(endsOf(lifetime)).toBe(extendedEnds);
    expect(lifetime).toMatchObject({ activated: true, lifetime: true, trial: false, sentinel: 'real' });
    expect(await readDoc(env, `subscriptions/${OWNER}`)).toMatchObject({ sentinel: 'uid', lifetime: true, status: 'decoy' });
    expect(await readDoc(env, `subscriptions/${OTHER}`)).toMatchObject({ sentinel: 'other', status: 'active', lifetime: false });
    for (const uid of [OWNER, STAFF]) {
      const next = claims(await lookup(uid));
      expect(next.tenantId).toBe(TENANT);
      expect(next.subUntil).toBe(LIFETIME_UNTIL);
      expect(next.cv).toBe(4);
    }
    for (const uid of [OTHER_OWNER, OTHER_STAFF]) {
      expect((await lookup(uid))?.customAttributes).toBe(claimsBefore.get(uid));
    }

    let claimVersion = 4;
    for (const status of ['trial_expired', 'expired', 'inactive', 'canceled', 'cancelled']) {
      await asAdmin(env, (fs) => setDoc(doc(fs, `subscriptions/${TENANT}`), { status }, { merge: true }));
      const closedResult = await callOk<{ ok: true; writesEnabled: boolean; closed: boolean }>(adminToken, 'adminSetSubscription', { uid: OWNER, action: 'extend', days: 1 });
      expect(closedResult).toEqual({ ok: true, writesEnabled: false, closed: true });
      claimVersion += 1;
      const closed = await readDoc(env, `subscriptions/${TENANT}`);
      expect(closed?.status, status).toBe(status);
      expect(endsOf(closed)).toBeGreaterThan(Date.now());
      expect(await readDoc(env, `subscriptions/${OWNER}`)).toMatchObject({ sentinel: 'uid', status: 'decoy' });
      expect(await readDoc(env, `subscriptions/${OTHER}`)).toMatchObject({ sentinel: 'other', status: 'active' });
      for (const uid of [OWNER, STAFF]) {
        const next = claims(await lookup(uid));
        expect(next.subUntil, status).toBe(0);
        expect(next.tenantId).toBe(TENANT);
        expect(next.cv).toBe(claimVersion);
      }
    }

    const beforeRevoke = new Map<string, string | undefined>();
    for (const uid of [OWNER, STAFF, OTHER_OWNER, OTHER_STAFF]) beforeRevoke.set(uid, (await lookup(uid))?.validSince);
    await sleep(1100);
    const deactivated = await callOk<{ ok: true; writesEnabled: boolean; closed: boolean }>(adminToken, 'adminSetSubscription', { uid: OWNER, action: 'deactivate' });
    expect(deactivated).toEqual({ ok: true, writesEnabled: false, closed: true });
    expect(await readDoc(env, `subscriptions/${TENANT}`)).toMatchObject({ activated: false, lifetime: false, sentinel: 'real' });
    expect(await readDoc(env, `subscriptions/${OWNER}`)).toMatchObject({ sentinel: 'uid', lifetime: true });
    expect(await readDoc(env, `subscriptions/${OTHER}`)).toMatchObject({ sentinel: 'other', status: 'active' });
    for (const uid of [OWNER, STAFF]) {
      const next = await lookup(uid);
      expect(Number(next?.validSince)).toBeGreaterThan(Number(beforeRevoke.get(uid)));
      expect(claims(next).tenantId).toBe(TENANT);
      expect(claims(next).subUntil).toBe(0);
      expect((await readDoc(env, `users/${uid}`))?.claimsVersion).toBe(claimVersion + 1);
    }
    for (const uid of [OTHER_OWNER, OTHER_STAFF]) {
      expect((await lookup(uid))?.validSince).toBe(beforeRevoke.get(uid));
      expect((await lookup(uid))?.customAttributes).toBe(claimsBefore.get(uid));
    }
  });

  it('deletes the authorized tenant and leaves the uid-keyed decoy and the other tenant', async () => {
    const mismatch = await call(adminToken, 'adminDeleteAccount', { uid: OWNER, confirm: 'isoother' });
    expect(mismatch.error?.key).toBe('error.fn.confirmMismatch');
    const self = await call(adminToken, 'adminDeleteAccount', { uid: ADMIN, confirm: 'isostore' });
    expect(self.error?.key).toBe('error.fn.notAllowed');
    expect(await readDoc(env, `tenants/${TENANT}/settings/main`)).toMatchObject({ sentinel: 'real' });
    expect(await readDoc(env, `tenants/${OTHER}/settings/main`)).toMatchObject({ sentinel: 'other' });

    const bucket = emulatorBucket();
    const realFile = bucket.file(`tenants/${TENANT}/logo/marker.txt`);
    const uidFile = bucket.file(`tenants/${OWNER}/logo/marker.txt`);
    const otherFile = bucket.file(`tenants/${OTHER}/logo/marker.txt`);
    await realFile.save('real-tenant');
    await uidFile.save('uid-decoy');
    await otherFile.save('other-tenant');
    expect((await realFile.exists())[0]).toBe(true);

    const deleted = await callOk<{ ok: true; accountDeleted: true; tenantId: string; storageCleanup: string }>(adminToken, 'adminDeleteAccount', { uid: OWNER, confirm: 'isostore' });
    expect(deleted).toEqual({ ok: true, accountDeleted: true, tenantId: TENANT, storageCleanup: 'complete', outcome: 'complete' });
    expect(await readDoc(env, `platformStorageCleanup/${TENANT}`)).toMatchObject({ tenantId: TENANT, prefix: `tenants/${TENANT}/`, accountDeleted: true, storageCleanup: 'complete' });

    const [realLeft] = await realFile.exists();
    expect(realLeft, 'account deletion reported success but left the tenant storage object').toBe(false);
    expect((await uidFile.exists())[0], 'uid-keyed storage object').toBe(true);
    expect((await otherFile.exists())[0], 'other tenant storage object').toBe(true);

    expect(await readDoc(env, `users/${OWNER}`)).toBeUndefined();
    expect(await readDoc(env, `users/${STAFF}`)).toBeUndefined();
    expect(await readDoc(env, `subscriptions/${TENANT}`)).toBeUndefined();
    expect(await readDoc(env, `tenants/${TENANT}/settings/main`)).toBeUndefined();
    expect(await readDoc(env, `stores/${TENANT}`)).toBeUndefined();
    expect(await readDoc(env, `storeSubdomains/isostore`)).toBeUndefined();
    expect(await lookup(OWNER)).toBeNull();
    expect(await lookup(STAFF)).toBeNull();

    expect(await readDoc(env, `users/${OTHER_OWNER}`)).toMatchObject({ tenantId: OTHER });
    expect(await readDoc(env, `users/${OTHER_STAFF}`)).toMatchObject({ tenantId: OTHER });
    expect(await readDoc(env, `subscriptions/${OWNER}`)).toMatchObject({ sentinel: 'uid', lifetime: true });
    expect(await readDoc(env, `subscriptions/${OTHER}`)).toMatchObject({ sentinel: 'other', status: 'active' });
    expect(await readDoc(env, `tenants/${OWNER}/settings/main`)).toMatchObject({ sentinel: 'uid' });
    expect(await readDoc(env, `tenants/${OTHER}/settings/main`)).toMatchObject({ sentinel: 'other' });
    expect(await readDoc(env, `stores/${OWNER}`)).toMatchObject({ sentinel: 'uid' });
    expect(await readDoc(env, `stores/${OTHER}`)).toMatchObject({ sentinel: 'other' });
    expect(await readDoc(env, `storeSubdomains/isoother`)).toMatchObject({ tenantId: OTHER });
    expect(await lookup(OTHER_OWNER)).not.toBeNull();
    expect(await lookup(OTHER_STAFF)).not.toBeNull();
    expect(await lookup(ADMIN)).not.toBeNull();
  });
});
