import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveAuthEmulatorHostPort } from './emulatorSafety';
import { asAdmin, call, callOk, clearAuth, clearFirestore, createEnv, createUser, PROJECT_ID, seedTenant, tp } from './helpers';

const AUTH = `http://${resolveAuthEmulatorHostPort()}`;
const PASSWORD = 'integration-pass-1';
const CUSTOMER = 'aiCustomerOwner';
const ADMIN = 'aiPlatformAdmin';
const ADMIN_NO_DEMO = 'aiAdminWithoutDemo';

let env: RulesTestEnvironment;

async function authPost(path: string, body: unknown, admin = false) {
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/${path}${admin ? '' : '?key=demo'}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(admin ? { Authorization: 'Bearer owner' } : {}) },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`auth emulator ${path}: ${JSON.stringify(json)}`);
  return json;
}

async function signIn(uid: string): Promise<string> {
  const json = await authPost('accounts:signInWithPassword', { email: `${uid.toLowerCase()}@test.local`, password: PASSWORD, returnSecureToken: true });
  return String(json.idToken);
}

async function createPureSuperAdmin(uid: string): Promise<void> {
  await authPost(`projects/${PROJECT_ID}/accounts`, { localId: uid, email: `${uid.toLowerCase()}@test.local`, password: PASSWORD, emailVerified: true }, true);
  await authPost(`projects/${PROJECT_ID}/accounts:update`, { localId: uid, customAttributes: JSON.stringify({ superAdmin: true }), emailVerified: true }, true);
}

async function setClaims(uid: string, claims: Record<string, unknown>, emailVerified = true): Promise<void> {
  await authPost(`projects/${PROJECT_ID}/accounts:update`, { localId: uid, customAttributes: JSON.stringify(claims), emailVerified }, true);
}

async function addDaily(tenantId: string, date: string, revenueUsdCents: number): Promise<void> {
  await asAdmin(env, (fs) => setDoc(doc(fs, tp(tenantId, 'dailyStats', date)), { date, salesCount: 3, revenueUsdCents, costUsdCents: 100, returnsCostUsdCents: 0 }));
}

const RANGE = { from: '2026-10-01', to: '2026-10-31' };

beforeAll(async () => {
  env = await createEnv();
  await clearAuth();
  await createUser({ uid: CUSTOMER, tenantId: CUSTOMER, role: 'owner' });
  await createPureSuperAdmin(ADMIN);
  await createPureSuperAdmin(ADMIN_NO_DEMO);
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await clearFirestore(env);
  await seedTenant(env, CUSTOMER, [{ uid: CUSTOMER, role: 'owner' }]);
  await addDaily(CUSTOMER, '2026-10-10', 99_999);
  await setClaims(ADMIN, { superAdmin: true });
});

async function provisionedAdminToken(): Promise<string> {
  const token = await signIn(ADMIN);
  await callOk(token, 'adminProvisionInternalDemo', {});
  await addDaily(ADMIN, '2026-10-10', 1_234);
  return signIn(ADMIN); // refreshed claims after provisioning
}

describe('Zelvero AI server authorization (internal-only rollout)', () => {
  it('denies a customer owner, even for their own store', async () => {
    const token = await signIn(CUSTOMER);
    expect((await call(token, 'aiCopilotAccess', {})).error?.status).toBe('PERMISSION_DENIED');
    expect((await call(token, 'aiCopilotRead', { op: 'dailyStats', range: RANGE })).error?.status).toBe('PERMISSION_DENIED');
  });

  it('denies a Super Admin who has no internal demo store', async () => {
    const token = await signIn(ADMIN_NO_DEMO);
    expect((await call(token, 'aiCopilotAccess', {})).error?.status).toBe('PERMISSION_DENIED');
    expect((await call(token, 'aiCopilotRead', { op: 'catalog' })).error?.status).toBe('PERMISSION_DENIED');
  });

  it('allows a verified Super Admin on their own internal demo store, and reads only that store', async () => {
    const token = await provisionedAdminToken();
    const access = await callOk<{ allowed: boolean; tenantId: string }>(token, 'aiCopilotAccess', {});
    expect(access).toEqual({ allowed: true, tenantId: ADMIN });
    const read = await callOk<{ days: Array<{ revenueUsdCents: number }> }>(token, 'aiCopilotRead', { op: 'dailyStats', range: RANGE });
    expect(read.days.map((d) => d.revenueUsdCents)).toEqual([1_234]);
  });

  it('rejects any client-supplied tenant, store or uid field instead of using it', async () => {
    const token = await provisionedAdminToken();
    for (const extra of [{ tenantId: CUSTOMER }, { storeId: CUSTOMER }, { uid: CUSTOMER }]) {
      const res = await call(token, 'aiCopilotRead', { op: 'dailyStats', range: RANGE, ...extra });
      expect(res.error?.status).toBe('INVALID_ARGUMENT');
    }
  });

  it('ignores a token whose tenant claim names a customer store', async () => {
    await provisionedAdminToken();
    await setClaims(ADMIN, { superAdmin: true, tenantId: CUSTOMER, role: 'owner', active: true });
    const poisoned = await signIn(ADMIN);
    const read = await callOk<{ days: Array<{ revenueUsdCents: number }> }>(poisoned, 'aiCopilotRead', { op: 'dailyStats', range: RANGE });
    expect(read.days.map((d) => d.revenueUsdCents)).toEqual([1_234]);
  });

  it('re-checks live: a revoked Super Admin claim or a demo marker removed denies immediately', async () => {
    const token = await provisionedAdminToken();
    await asAdmin(env, (fs) => updateDoc(doc(fs, `subscriptions/${ADMIN}`), { internalDemo: false }));
    expect((await call(token, 'aiCopilotRead', { op: 'catalog' })).error?.status).toBe('PERMISSION_DENIED');
    await asAdmin(env, (fs) => updateDoc(doc(fs, `subscriptions/${ADMIN}`), { internalDemo: true }));
    await setClaims(ADMIN, {});
    expect((await call(token, 'aiCopilotRead', { op: 'catalog' })).error?.status).toBe('PERMISSION_DENIED');
  });

  it('rejects write-like operations and oversized ranges', async () => {
    const token = await provisionedAdminToken();
    expect((await call(token, 'aiCopilotRead', { op: 'adjustStock', productId: 'p1', delta: -1 })).error?.status).toBe('INVALID_ARGUMENT');
    expect((await call(token, 'aiCopilotRead', { op: 'saleLines', range: { from: '2025-01-01', to: '2026-10-31' } })).error?.status).toBe('INVALID_ARGUMENT');
  });

  it('never writes: customer data is unchanged after admin AI reads', async () => {
    const token = await provisionedAdminToken();
    await callOk(token, 'aiCopilotRead', { op: 'dailyStats', range: RANGE });
    await callOk(token, 'aiCopilotRead', { op: 'catalog' });
    const [daily] = await asAdmin(env, async (fs) => {
      const { getDoc } = await import('firebase/firestore');
      return [(await getDoc(doc(fs, tp(CUSTOMER, 'dailyStats', '2026-10-10')))).data()];
    });
    expect(daily?.revenueUsdCents).toBe(99_999);
  });
});
