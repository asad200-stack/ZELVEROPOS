import { assertFails } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, Timestamp } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAdmin, call, callOk, clearAuth, clearFirestore, createEnv, createUser, DAY, FUNCTIONS_ORIGIN, OTHER, PROJECT_ID, readDoc, seedTenant, T } from './helpers';

const FUNCTIONS = `${FUNCTIONS_ORIGIN}/${PROJECT_ID}/europe-west1`;
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099'}`;

let env: RulesTestEnvironment;
let adminToken: string;

async function publicCall(name: string, data: unknown) {
  const res = await fetch(`${FUNCTIONS}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  return (await res.json()) as { result?: Record<string, unknown>; error?: { status: string; message: string; details?: { key?: string } } };
}

function trialBody(over: Record<string, unknown> = {}) {
  return {
    name: 'Nora',
    ownerName: 'Nora',
    businessName: 'Nora Phones',
    email: 'nora@zelvero.test',
    phone: '70111222',
    businessType: 'mobile-electronics',
    country: 'Lebanon',
    primaryCurrency: 'USD',
    password: 'trial-pass-1',
    clientOperationId: `op${Math.random().toString(36).slice(2, 12)}`,
    formStartedAt: Date.now() - 2_000,
    website: '',
    ...over,
  };
}

async function usersWithEmail(email: string) {
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:query`, {
    method: 'POST',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: [email] }),
  });
  const json = (await res.json()) as {
    userInfo?: Array<{ localId?: string; email?: string }>;
    users?: Array<{ localId?: string; email?: string }>;
  };
  if (!res.ok) throw new Error(`auth query failed ${res.status}`);
  return (json.userInfo ?? json.users ?? []).filter((user) => user.email === email);
}

async function clearTrialRateLimits() {
  await asAdmin(env, async (fs) => {
    const snap = await getDocs(collection(fs, 'platformRateLimits'));
    await Promise.all(snap.docs.map((item) => deleteDoc(item.ref)));
  });
}

beforeAll(async () => {
  env = await createEnv();
  await clearFirestore(env);
  await clearAuth();
  await seedTenant(env, T, [{ uid: T, role: 'owner' }]);
  await seedTenant(env, OTHER, [{ uid: 'owner-b', role: 'owner' }]);
  adminToken = await createUser({ uid: 'trial-admin', tenantId: T, role: 'owner', superAdmin: true });
  await asAdmin(env, (fs) => setDoc(doc(fs, 'platform/salesConfig'), { mode: 'staging' }));
});

afterAll(async () => {
  await env?.cleanup();
});

describe('trial provisioning hardening', () => {
  it('rejects a public trial in staging and creates no auth user or tenant', async () => {
    const email = 'public.owner@example.com';
    const res = await publicCall('provisionWebsiteTrial', trialBody({
      email,
      clientOperationId: 'publictrial0001',
    }));
    expect(res.error?.details?.key || res.error?.message).toMatch(/trialNotOpen/);
    expect(await usersWithEmail(email)).toHaveLength(0);
    expect(await readDoc(env, `platformTrialIndex/email_${email}`)).toBeUndefined();
    expect(await readDoc(env, 'platformSalesOps/publictrial0001')).toBeUndefined();
  });

  it('stays closed for a public address even when sales mode is on', async () => {
    await asAdmin(env, (fs) => setDoc(doc(fs, 'platform/salesConfig'), { mode: 'on' }, { merge: true }));
    const email = 'public.on@example.com';
    const res = await publicCall('provisionWebsiteTrial', trialBody({
      email,
      clientOperationId: 'publicon0000001',
    }));
    expect(res.error?.details?.key || res.error?.message).toMatch(/trialNotOpen/);
    expect(await usersWithEmail(email)).toHaveLength(0);
    await asAdmin(env, (fs) => setDoc(doc(fs, 'platform/salesConfig'), { mode: 'staging' }, { merge: true }));
  });

  it('keeps one tenant when the same operation id is submitted twice', async () => {
    const payload = trialBody({ email: 'sameop@zelvero.test', clientOperationId: 'sameop000000001' });
    const first = await publicCall('provisionWebsiteTrial', payload);
    const second = await publicCall('provisionWebsiteTrial', payload);
    expect(first.error, JSON.stringify(first.error)).toBeUndefined();
    expect(second.result).toEqual(first.result);
    expect(Object.keys(first.result ?? {}).sort()).toEqual(['ok', 'referralAccepted', 'resumable']);
    expect(await usersWithEmail('sameop@zelvero.test')).toHaveLength(1);
    const indexed = await readDoc(env, 'platformTrialIndex/email_sameop@zelvero.test');
    expect(String(indexed?.tenantId)).toMatch(/^t[a-f0-9]{24}$/);
  });

  it('does not create a second tenant for the same email', async () => {
    const first = trialBody({ email: 'repeat@zelvero.test', clientOperationId: 'repeat000000001' });
    expect((await publicCall('provisionWebsiteTrial', first)).error).toBeUndefined();
    const second = await publicCall('provisionWebsiteTrial', { ...first, clientOperationId: 'repeat000000002' });
    expect(second.error?.details?.key || second.error?.message).toMatch(/trialUnavailable/);
    expect(await usersWithEmail('repeat@zelvero.test')).toHaveLength(1);
  });

  it('removes only the auth user created by a failed attempt, then retries cleanly', async () => {
    const email = 'fault@zelvero.test';
    const failed = await publicCall('provisionWebsiteTrial', trialBody({
      email,
      clientOperationId: 'fault0000000001',
      provisionFault: 'after-auth',
    }));
    expect(failed.error?.status).toBe('INTERNAL');
    expect(failed.error?.message).toBe('error.unexpected');
    expect(JSON.stringify(failed)).not.toContain(email);
    expect(await usersWithEmail(email)).toHaveLength(0);
    expect(await readDoc(env, `platformTrialIndex/email_${email}`)).toBeUndefined();
    expect(await readDoc(env, 'platformSalesOps/fault0000000001')).toBeUndefined();

    const retried = await publicCall('provisionWebsiteTrial', trialBody({
      email,
      clientOperationId: 'fault0000000002',
    }));
    expect(retried.error, JSON.stringify(retried.error)).toBeUndefined();
    expect(await usersWithEmail(email)).toHaveLength(1);
    const indexed = await readDoc(env, `platformTrialIndex/email_${email}`);
    expect(String(indexed?.tenantId)).toMatch(/^t[a-f0-9]{24}$/);
    const state = await readDoc(env, `platformProvisionState/${String(indexed?.uid)}`);
    expect(state?.status).toBe('ready');
  });

  it('lets one of two concurrent signups win and leaves a single tenant', async () => {
    await clearTrialRateLimits();
    const email = 'race@zelvero.test';
    const [left, right] = await Promise.all([
      publicCall('provisionWebsiteTrial', trialBody({ email, clientOperationId: 'race00000000001' })),
      publicCall('provisionWebsiteTrial', trialBody({ email, clientOperationId: 'race00000000002' })),
    ]);
    const outcomes = [left, right];
    expect(outcomes.filter((item) => item.result?.ok === true)).toHaveLength(1);
    expect(outcomes.filter((item) => String(item.error?.details?.key || item.error?.message || '').includes('trialUnavailable'))).toHaveLength(1);
    expect(await usersWithEmail(email)).toHaveLength(1);
    expect(String((await readDoc(env, `platformTrialIndex/email_${email}`))?.tenantId)).toMatch(/^t[a-f0-9]{24}$/);
    const winner = outcomes.find((item) => item.result?.ok === true);
    expect(winner?.result).not.toHaveProperty('uid');
    expect(winner?.result).not.toHaveProperty('tenantId');
  });

  it('does not let an unverified owner read tenant data or another tenant read theirs', async () => {
    const indexed = await readDoc(env, 'platformTrialIndex/email_sameop@zelvero.test');
    const tenantId = String(indexed?.tenantId);
    const uid = String(indexed?.uid);
    const unverified = env.authenticatedContext(uid, {
      tenantId,
      role: 'owner',
      active: true,
      subUntil: Date.now() + 15 * DAY,
    });
    await assertFails(getDoc(doc(unverified.firestore(), `tenants/${tenantId}/settings/main`)));

    const outsider = env.authenticatedContext('owner-b', {
      tenantId: OTHER,
      role: 'owner',
      active: true,
      email_verified: true,
      subUntil: Date.now() + 15 * DAY,
    });
    await assertFails(getDoc(doc(outsider.firestore(), `tenants/${tenantId}/settings/main`)));
    await assertFails(setDoc(doc(outsider.firestore(), `subscriptions/${tenantId}`), { activated: true }));
  });

  it('refuses a client request to activate or extend a subscription', async () => {
    const owner = await createUser({ uid: 'client-owner', tenantId: T, role: 'owner' });
    const activate = await call(owner, 'adminSetSubscription', { uid: T, action: 'activate', days: 30 });
    const extend = await call(owner, 'adminSetSubscription', { uid: T, action: 'extend', days: 30 });
    expect(activate.error?.status).toBe('PERMISSION_DENIED');
    expect(extend.error?.status).toBe('PERMISSION_DENIED');
  });

  it('sends the day-7 notice without granting a write to an inactive subscription', async () => {
    const tenantId = 'notice-tenant';
    const uid = 'notice-owner';
    await asAdmin(env, async (fs) => {
      await setDoc(doc(fs, `users/${uid}`), { uid, role: 'owner', tenantId, isActive: true, fullName: 'Notice' });
      await setDoc(doc(fs, `subscriptions/${tenantId}`), {
        activated: false,
        trial: true,
        status: 'trial',
        startsAt: Timestamp.fromMillis(Date.now() - 8 * DAY),
        endsAt: Timestamp.fromMillis(Date.now() + 7 * DAY),
        trialStartedAt: Timestamp.fromMillis(Date.now() - 8 * DAY),
        trialEndsAt: Timestamp.fromMillis(Date.now() + 7 * DAY),
        notificationsSent: {},
      });
    });
    await callOk(adminToken, 'adminRunTrialLifecycle', {});
    expect(await readDoc(env, `tenants/${tenantId}/notifications/day7`)).toMatchObject({ day: 7 });
    expect((await readDoc(env, `subscriptions/${tenantId}`))?.activated).toBe(false);
    const token = await createUser({ uid, tenantId, role: 'owner' });
    const write = await call(token, 'posCheckout', {
      saleId: 'notice-sale-1',
      kind: 'cash',
      currency: 'USD',
      rate: 89_500,
      customerId: null,
      debtLineUsdCents: null,
      lines: [],
      expectedTotalUsdCents: 0,
      cash: { receivedUsdCents: 0, receivedLbp: 0 },
    });
    expect(write.error?.key).toBe('error.fn.subscriptionInactive');
  });
});
