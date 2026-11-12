import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAdmin, call, callOk, clearAuth, clearFirestore, createEnv, createUser, functionsCallableUrl, readDoc, readWhere } from './helpers';

const requireFromFunctions = createRequire(resolve(process.cwd(), 'functions/package.json'));
const BUCKET = 'demo-zelvero.appspot.com';
const ADMIN = 'cleanup-admin';
const OTHER = 'cleanup-other';

let env: RulesTestEnvironment;
let adminToken: string;

type StorageFile = { save: (data: string) => Promise<unknown>; exists: () => Promise<[boolean]> };

function bucket() {
  const host = process.env.STORAGE_EMULATOR_HOST || process.env.FIREBASE_STORAGE_EMULATOR_HOST || '';
  if (!/^(https?:\/\/)?(127\.0\.0\.1|localhost):\d+\/?$/.test(host)) {
    throw new Error(`Refusing storage cleanup test because the storage host is "${host || 'unset'}".`);
  }
  const { initializeApp, getApps } = requireFromFunctions('firebase-admin/app') as {
    initializeApp: (options: { projectId: string; storageBucket: string }) => unknown;
    getApps: () => unknown[];
  };
  const { getStorage } = requireFromFunctions('firebase-admin/storage') as {
    getStorage: () => { bucket: (name: string) => { file: (path: string) => StorageFile } };
  };
  if (!getApps().length) initializeApp({ projectId: 'demo-zelvero', storageBucket: BUCKET });
  return getStorage().bucket(BUCKET);
}

async function seedOwner(uid: string, tenantId: string, subdomain: string) {
  await asAdmin(env, (fs) => setDoc(doc(fs, `users/${uid}`), {
    uid,
    role: 'owner',
    tenantId,
    isActive: true,
    email: `${uid}@test.local`,
    fullName: uid,
    storeName: tenantId,
    subdomain,
    phone: '',
    claimsVersion: 1,
    createdAt: Timestamp.now(),
  }));
  await asAdmin(env, (fs) => setDoc(doc(fs, `tenants/${tenantId}/settings/main`), { sentinel: tenantId }));
  await createUser({ uid, tenantId, role: 'owner' });
}

describe('storage cleanup stays tied to the deleted tenant', () => {
  beforeAll(async () => {
    env = await createEnv();
    await clearFirestore(env);
    await clearAuth();
    await seedOwner('cleanup-success-owner', 'cleanup-success', 'successstore');
    await seedOwner('cleanup-fail-owner', 'cleanup-fail', 'failstore');
    await seedOwner(OTHER, OTHER, 'otherstore');
    adminToken = await createUser({ uid: ADMIN, tenantId: ADMIN, role: 'owner', superAdmin: true });
    const files = bucket();
    await files.file(`tenants/${OTHER}/logo/marker.txt`).save('other');
    await files.file('tenants/cleanup-success-owner/logo/marker.txt').save('uid');
    await files.file('tenants/cleanup-fail-owner/logo/marker.txt').save('uid');
  });

  afterAll(async () => {
    await env?.cleanup();
  });

  it('removes only the profile tenant prefix when cleanup succeeds', async () => {
    const files = bucket();
    const tenantFile = files.file('tenants/cleanup-success/logo/marker.txt');
    await tenantFile.save('success');
    const deleted = await callOk<{ storageCleanup: string; tenantId: string }>(adminToken, 'adminDeleteAccount', {
      uid: 'cleanup-success-owner',
      confirm: 'successstore',
    });
    expect(deleted).toMatchObject({ accountDeleted: true, tenantId: 'cleanup-success', storageCleanup: 'complete' });
    expect((await tenantFile.exists())[0]).toBe(false);
    expect((await files.file('tenants/cleanup-success-owner/logo/marker.txt').exists())[0]).toBe(true);
    expect((await files.file(`tenants/${OTHER}/logo/marker.txt`).exists())[0]).toBe(true);
    expect(await readDoc(env, 'users/cleanup-success-owner')).toBeUndefined();
    expect(await readDoc(env, `platformStorageCleanup/cleanup-success`)).toMatchObject({ storageCleanup: 'complete', accountDeleted: true });
  });

  it('keeps a failed cleanup pending, then retries only that prefix', async () => {
    const files = bucket();
    const tenantFile = files.file('tenants/cleanup-fail/logo/marker.txt');
    const uidFile = files.file('tenants/cleanup-fail-owner/logo/marker.txt');
    const otherFile = files.file(`tenants/${OTHER}/logo/marker.txt`);
    await tenantFile.save('fail');
    await asAdmin(env, (fs) => setDoc(doc(fs, 'platformTestHooks/storageCleanup'), { failPrefix: 'tenants/cleanup-fail/' }));

    const deleted = await callOk<{ storageCleanup: string; tenantId: string }>(adminToken, 'adminDeleteAccount', {
      uid: 'cleanup-fail-owner',
      confirm: 'failstore',
    });
    expect(deleted).toMatchObject({ accountDeleted: true, tenantId: 'cleanup-fail', storageCleanup: 'pending', outcome: 'storage-failed' });
    expect((await tenantFile.exists())[0]).toBe(true);
    expect((await uidFile.exists())[0]).toBe(true);
    expect((await otherFile.exists())[0]).toBe(true);
    expect(await readDoc(env, 'users/cleanup-fail-owner')).toBeUndefined();
    expect(await readDoc(env, 'tenants/cleanup-fail/settings/main')).toBeUndefined();
    expect(await readDoc(env, 'platformStorageCleanup/cleanup-fail')).toMatchObject({
      tenantId: 'cleanup-fail',
      prefix: 'tenants/cleanup-fail/',
      accountDeleted: true,
      storageCleanup: 'pending',
    });

    const reservedSignup = await createUser({ uid: 'cleanup-fail', tenantId: 'cleanup-fail', role: 'owner' });
    const blocked = await call(reservedSignup, 'completeSignup', {
      fullName: 'Retry Owner',
      storeName: 'Retry Store',
      subdomain: 'retrystore',
      phone: '70111222',
    });
    expect(blocked.error?.status).toBe('FAILED_PRECONDITION');
    expect(blocked.error?.key).toBe('error.fn.notAllowed');
    expect(await readDoc(env, 'users/cleanup-fail')).toBeUndefined();
    expect(await readDoc(env, 'tenants/cleanup-fail/settings/main')).toBeUndefined();
    expect((await tenantFile.exists())[0]).toBe(true);

    const otherSignup = await createUser({ uid: 'cleanup-open-owner', tenantId: 'cleanup-open-owner', role: 'owner' });
    const opened = await callOk<{ tenantId: string }>(otherSignup, 'completeSignup', {
      fullName: 'Open Owner',
      storeName: 'Open Store',
      subdomain: 'openstore',
      phone: '70111223',
    });
    expect(opened.tenantId).toBe('cleanup-open-owner');
    expect(await readDoc(env, 'tenants/cleanup-open-owner/settings/main')).toMatchObject({ storeName: 'Open Store' });
    expect((await tenantFile.exists())[0]).toBe(true);
    expect((await uidFile.exists())[0]).toBe(true);

    const wrong = await call(adminToken, 'adminRetryStorageCleanup', { tenantId: 'cleanup-fail-owner' });
    expect(wrong.error?.status).toBe('NOT_FOUND');
    expect((await uidFile.exists())[0]).toBe(true);

    const denied = await call(await createUser({ uid: 'cleanup-stranger', tenantId: 'cleanup-stranger', role: 'owner' }), 'adminRetryStorageCleanup', {
      tenantId: 'cleanup-fail',
    });
    expect(denied.error?.status).toBe('PERMISSION_DENIED');

    const retried = await callOk<{ storageCleanup: string; accountDeleted: boolean }>(adminToken, 'adminRetryStorageCleanup', { tenantId: 'cleanup-fail' });
    expect(retried).toEqual({ ok: true, accountDeleted: true, storageCleanup: 'complete', outcome: 'complete' });
    expect((await tenantFile.exists())[0]).toBe(false);
    expect((await uidFile.exists())[0]).toBe(true);
    expect((await otherFile.exists())[0]).toBe(true);
    expect(await readDoc(env, 'users/cleanup-fail-owner')).toBeUndefined();

    await tenantFile.save('after-complete');
    const again = await callOk<{ storageCleanup: string }>(adminToken, 'adminRetryStorageCleanup', { tenantId: 'cleanup-fail' });
    expect(again.storageCleanup).toBe('complete');
    expect((await tenantFile.exists())[0]).toBe(true);
    expect((await uidFile.exists())[0]).toBe(true);
    expect((await otherFile.exists())[0]).toBe(true);
    const stillReserved = await call(reservedSignup, 'completeSignup', {
      fullName: 'Retry Owner',
      storeName: 'Retry Store',
      subdomain: 'retrystore',
      phone: '70111222',
    });
    expect(stillReserved.error?.key).toBe('error.fn.notAllowed');
    expect(await readDoc(env, 'platformStorageCleanup/cleanup-fail')).toMatchObject({ storageCleanup: 'complete', tenantReserved: true });
    expect(await readDoc(env, 'users/cleanup-fail')).toBeUndefined();
  });

  it('completes a retry when the proven prefix is already empty and leaves every other prefix', async () => {
    const files = bucket();
    const uidFile = files.file('tenants/cleanup-empty-owner/logo/marker.txt');
    const otherFile = files.file(`tenants/${OTHER}/logo/marker.txt`);
    await uidFile.save('uid');
    await asAdmin(env, (fs) => setDoc(doc(fs, 'platformStorageCleanup/cleanup-empty'), {
      tenantId: 'cleanup-empty',
      prefix: 'tenants/cleanup-empty/',
      ownerUid: 'cleanup-empty-owner',
      memberUids: ['cleanup-empty-owner'],
      subdomain: '',
      accountDeleted: true,
      storageCleanup: 'pending',
    }));
    const first = await callOk<{ storageCleanup: string; accountDeleted: boolean; outcome: string }>(adminToken, 'adminRetryStorageCleanup', { tenantId: 'cleanup-empty' });
    const second = await callOk<{ storageCleanup: string }>(adminToken, 'adminRetryStorageCleanup', { tenantId: 'cleanup-empty' });
    expect(first).toEqual({ ok: true, accountDeleted: true, storageCleanup: 'complete', outcome: 'complete' });
    expect(second.storageCleanup).toBe('complete');
    expect((await uidFile.exists())[0]).toBe(true);
    expect((await otherFile.exists())[0]).toBe(true);
    expect(await readDoc(env, 'users/cleanup-empty-owner')).toBeUndefined();
  });

  it('recovers a crash before the deleted flag, then retries without touching other prefixes', async () => {
    await seedOwner('cleanup-crash-owner', 'cleanup-crash', 'crashstore');
    const files = bucket();
    const tenantFile = files.file('tenants/cleanup-crash/logo/marker.txt');
    const uidFile = files.file('tenants/cleanup-crash-owner/logo/marker.txt');
    const otherFile = files.file(`tenants/${OTHER}/logo/marker.txt`);
    await tenantFile.save('crash');
    await uidFile.save('uid');
    await asAdmin(env, (fs) => setDoc(doc(fs, 'platformTestHooks/storageCleanup'), { crashTenant: 'cleanup-crash' }));

    const crashed = await call(adminToken, 'adminDeleteAccount', { uid: 'cleanup-crash-owner', confirm: 'crashstore' });
    expect(crashed.error?.status).toBe('INTERNAL');
    expect(crashed.error?.key).toBe('error.unexpected');
    expect(await readDoc(env, 'users/cleanup-crash-owner')).toBeUndefined();
    expect(await readDoc(env, 'tenants/cleanup-crash/settings/main')).toBeUndefined();
    expect(await readDoc(env, 'platformStorageCleanup/cleanup-crash')).toMatchObject({
      tenantId: 'cleanup-crash',
      prefix: 'tenants/cleanup-crash/',
      ownerUid: 'cleanup-crash-owner',
      memberUids: ['cleanup-crash-owner'],
      accountDeleted: false,
      storageCleanup: 'pending',
    });
    expect((await tenantFile.exists())[0]).toBe(true);

    const accounts = await callOk<{ accounts: { uid: string }[] }>(adminToken, 'adminListAccounts', {});
    expect(accounts.accounts.some((account) => account.uid === 'cleanup-crash-owner')).toBe(false);
    const listed = await callOk<{ records: { tenantId: string; storageCleanup: string; lastOutcome: string | null }[] }>(adminToken, 'adminListStorageCleanup', {});
    expect(listed.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ tenantId: 'cleanup-crash', storageCleanup: 'pending' }),
    ]));
    expect(listed.records.every((row) => !('prefix' in row) && !('memberUids' in row))).toBe(true);
    expect(listed.records.some((row) => row.tenantId === 'cleanup-success' || row.tenantId === 'cleanup-empty')).toBe(false);

    const stranger = await createUser({ uid: 'cleanup-staff-admin', tenantId: 'cleanup-staff-admin', role: 'owner' });
    expect((await call(stranger, 'adminListStorageCleanup', {})).error?.status).toBe('PERMISSION_DENIED');
    expect((await call(stranger, 'adminRetryStorageCleanup', { tenantId: 'cleanup-crash' })).error?.status).toBe('PERMISSION_DENIED');

    const recovered = await callOk<{ outcome: string; storageCleanup: string }>(adminToken, 'adminRetryStorageCleanup', { tenantId: 'cleanup-crash' });
    expect(recovered).toMatchObject({ outcome: 'complete', storageCleanup: 'complete', accountDeleted: true });
    expect((await tenantFile.exists())[0]).toBe(false);
    expect((await uidFile.exists())[0]).toBe(true);
    expect((await otherFile.exists())[0]).toBe(true);
    expect(await readDoc(env, 'users/cleanup-crash-owner')).toBeUndefined();
    expect(await readDoc(env, 'subscriptions/cleanup-crash')).toBeUndefined();

    await tenantFile.save('after-recovery');
    const again = await callOk<{ storageCleanup: string }>(adminToken, 'adminRetryStorageCleanup', { tenantId: 'cleanup-crash' });
    expect(again.storageCleanup).toBe('complete');
    expect((await tenantFile.exists())[0]).toBe(true);
    expect((await uidFile.exists())[0]).toBe(true);
    const after = await callOk<{ records: { tenantId: string }[] }>(adminToken, 'adminListStorageCleanup', {});
    expect(after.records.some((row) => row.tenantId === 'cleanup-crash')).toBe(false);
  });

  it('refuses recovery while the account or its auth user still exists', async () => {
    await seedOwner('cleanup-live-owner', 'cleanup-live', 'livestore');
    const files = bucket();
    const tenantFile = files.file('tenants/cleanup-live/logo/marker.txt');
    await tenantFile.save('live');
    await asAdmin(env, (fs) => setDoc(doc(fs, 'platformStorageCleanup/cleanup-live'), {
      tenantId: 'cleanup-live',
      prefix: 'tenants/cleanup-live/',
      ownerUid: 'cleanup-live-owner',
      memberUids: ['cleanup-live-owner'],
      subdomain: 'livestore',
      accountDeleted: false,
      storageCleanup: 'pending',
    }));
    const live = await callOk<{ outcome: string; accountDeleted: boolean }>(adminToken, 'adminRetryStorageCleanup', { tenantId: 'cleanup-live' });
    expect(live).toMatchObject({ outcome: 'account-remains', accountDeleted: false, storageCleanup: 'pending' });
    expect((await tenantFile.exists())[0]).toBe(true);
    expect(await readDoc(env, 'users/cleanup-live-owner')).toMatchObject({ tenantId: 'cleanup-live' });
    const repeated = await callOk<{ outcome: string }>(adminToken, 'adminRetryStorageCleanup', { tenantId: 'cleanup-live' });
    expect(repeated.outcome).toBe('account-remains');
    expect((await tenantFile.exists())[0]).toBe(true);

    await createUser({ uid: 'cleanup-auth-owner', tenantId: 'cleanup-auth', role: 'owner' });
    await files.file('tenants/cleanup-auth/logo/marker.txt').save('auth');
    await files.file('tenants/cleanup-auth-owner/logo/marker.txt').save('uid');
    await asAdmin(env, (fs) => setDoc(doc(fs, 'platformStorageCleanup/cleanup-auth'), {
      tenantId: 'cleanup-auth',
      prefix: 'tenants/cleanup-auth/',
      ownerUid: 'cleanup-auth-owner',
      memberUids: ['cleanup-auth-owner'],
      subdomain: '',
      accountDeleted: false,
      storageCleanup: 'pending',
    }));
    const authOnly = await callOk<{ outcome: string }>(adminToken, 'adminRetryStorageCleanup', { tenantId: 'cleanup-auth' });
    expect(authOnly.outcome).toBe('account-remains');
    expect((await files.file('tenants/cleanup-auth/logo/marker.txt').exists())[0]).toBe(true);
    expect((await files.file('tenants/cleanup-auth-owner/logo/marker.txt').exists())[0]).toBe(true);
  });

  it('refuses recovery when the deleted identities were not recorded', async () => {
    const files = bucket();
    const tenantFile = files.file('tenants/cleanup-unknown/logo/marker.txt');
    const uidFile = files.file('tenants/cleanup-unknown-owner/logo/marker.txt');
    await tenantFile.save('unknown');
    await uidFile.save('uid');
    await asAdmin(env, (fs) => setDoc(doc(fs, 'platformStorageCleanup/cleanup-unknown'), {
      tenantId: 'cleanup-unknown',
      prefix: 'tenants/cleanup-unknown/',
      accountDeleted: false,
      storageCleanup: 'pending',
    }));
    const unverified = await callOk<{ outcome: string; accountDeleted: boolean }>(adminToken, 'adminRetryStorageCleanup', { tenantId: 'cleanup-unknown' });
    expect(unverified).toMatchObject({ outcome: 'unverified', accountDeleted: false, storageCleanup: 'pending' });
    expect((await tenantFile.exists())[0]).toBe(true);
    expect((await uidFile.exists())[0]).toBe(true);
    const again = await callOk<{ outcome: string }>(adminToken, 'adminRetryStorageCleanup', { tenantId: 'cleanup-unknown' });
    expect(again.outcome).toBe('unverified');
    expect((await tenantFile.exists())[0]).toBe(true);

    await asAdmin(env, (fs) => setDoc(doc(fs, 'platformStorageCleanup/cleanup-bad'), {
      tenantId: 'cleanup-bad',
      prefix: 'tenants/cleanup-bad-owner/',
      ownerUid: 'cleanup-bad-owner',
      memberUids: ['cleanup-bad-owner'],
      subdomain: '',
      accountDeleted: true,
      storageCleanup: 'pending',
    }));
    await files.file('tenants/cleanup-bad-owner/logo/marker.txt').save('uid');
    await files.file('tenants/cleanup-bad/logo/marker.txt').save('tenant');
    const rejected = await call(adminToken, 'adminRetryStorageCleanup', { tenantId: 'cleanup-bad' });
    expect(rejected.error?.status).toBe('FAILED_PRECONDITION');
    expect((await files.file('tenants/cleanup-bad-owner/logo/marker.txt').exists())[0]).toBe(true);
    expect((await files.file('tenants/cleanup-bad/logo/marker.txt').exists())[0]).toBe(true);
  });

  it('allocates an unrelated tenant when pending and completed ids are reserved', async () => {
    const reserved = 'treserved000000000000000001';
    const finished = 'tdone0000000000000000000001';
    const fresh = 'tfresh000000000000000000001';
    const files = bucket();
    await files.file(`tenants/${reserved}/logo/marker.txt`).save('reserved');
    await files.file(`tenants/${finished}/logo/marker.txt`).save('done');
    await files.file('tenants/treserved-owner/logo/marker.txt').save('uid');
    await asAdmin(env, async (fs) => {
      await setDoc(doc(fs, `platformStorageCleanup/${reserved}`), {
        tenantId: reserved,
        prefix: `tenants/${reserved}/`,
        storageCleanup: 'pending',
        accountDeleted: true,
        tenantReserved: true,
      });
      await setDoc(doc(fs, `platformStorageCleanup/${finished}`), {
        tenantId: finished,
        prefix: `tenants/${finished}/`,
        storageCleanup: 'complete',
        accountDeleted: true,
        tenantReserved: true,
      });
      await setDoc(doc(fs, 'platformTestHooks/tenantAllocation'), { ids: [reserved, finished, fresh] });
    });

    const res = await fetch(functionsCallableUrl('provisionWebsiteTrial'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          name: 'Cleanup Nora',
          ownerName: 'Cleanup Nora',
          businessName: 'Cleanup Phones',
          email: 'cleanup.trial@zelvero.test',
          phone: '70111224',
          businessType: 'mobile-electronics',
          country: 'Lebanon',
          primaryCurrency: 'USD',
          password: 'trial-pass-1',
          clientOperationId: 'cleanuptrial0001',
          formStartedAt: Date.now() - 2_000,
          website: '',
        },
      }),
    });
    const json = await res.json() as { result?: { ok?: boolean }; error?: { status?: string; message?: string; details?: { key?: string } } };
    expect(json.error, JSON.stringify(json.error)).toBeUndefined();
    expect(json.result?.ok).toBe(true);
    const profiles = await readWhere(env, 'users', 'email', 'cleanup.trial@zelvero.test');
    expect(profiles.map((profile) => profile.tenantId)).toEqual([fresh]);
    expect(await readDoc(env, `tenants/${fresh}/settings/main`)).toMatchObject({ storeName: 'Cleanup Phones' });
    expect(await readDoc(env, `tenants/${reserved}/settings/main`)).toBeUndefined();
    expect(await readDoc(env, `tenants/${finished}/settings/main`)).toBeUndefined();
    expect(await readDoc(env, `platformStorageCleanup/${reserved}`)).toMatchObject({ storageCleanup: 'pending' });
    expect(await readDoc(env, `platformStorageCleanup/${finished}`)).toMatchObject({ storageCleanup: 'complete' });
    expect((await files.file(`tenants/${reserved}/logo/marker.txt`).exists())[0]).toBe(true);
    expect((await files.file(`tenants/${finished}/logo/marker.txt`).exists())[0]).toBe(true);
    expect((await files.file('tenants/treserved-owner/logo/marker.txt').exists())[0]).toBe(true);

    const stranger = await createUser({ uid: 'cleanup-plain-admin', tenantId: 'cleanup-plain-admin', role: 'owner' });
    expect((await call(stranger, 'adminListStorageCleanup', {})).error?.status).toBe('PERMISSION_DENIED');
    expect((await call(stranger, 'adminRetryStorageCleanup', { tenantId: reserved })).error?.status).toBe('PERMISSION_DENIED');
    expect((await files.file(`tenants/${reserved}/logo/marker.txt`).exists())[0]).toBe(true);
  });
});
