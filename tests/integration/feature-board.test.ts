import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveAuthEmulatorHostPort } from './emulatorSafety';
import { asAdmin, call, callOk, clearAuth, clearFirestore, createEnv, createUser, readDoc, seedTenant, T } from './helpers';

// Super Admin feature board + base features for new accounts.
const AUTH = `http://${resolveAuthEmulatorHostPort()}`;
let env: RulesTestEnvironment;
let admin = '';
let owner = '';

async function signUpFresh(email: string): Promise<string> {
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'board-pass-12345', returnSecureToken: true }),
  });
  return String(((await res.json()) as { idToken: string }).idToken);
}

async function publish(id: string, version: string) {
  await asAdmin(env, (fs) =>
    setDoc(doc(fs, `platformFeatures/${id}`), { version, publication: 'published', audience: { allEligible: false, tenantIds: [] }, testingStatus: 'passed', history: [] }),
  );
}
const entitlement = (tenantId: string, id: string) => readDoc(env, `platformFeatureEntitlements/${tenantId}__${id}`);

beforeAll(async () => {
  env = await createEnv();
  await clearAuth();
  admin = await createUser({ uid: 'boardAdmin', tenantId: null, superAdmin: true });
  owner = await createUser({ uid: T, tenantId: T, role: 'owner' });
});
afterAll(async () => {
  await env?.cleanup();
});
beforeEach(async () => {
  await clearFirestore(env);
  await seedTenant(env, T, [{ uid: T, role: 'owner' }]);
  await publish('online_store', '1.0.0');
  await publish('zelvero_ai', '2.0.0');
});

describe('base features at signup', () => {
  it('a new account gets the online store and Zelvero AI switched on, with no click', async () => {
    const token = await signUpFresh(`board${Date.now()}@test.local`);
    const { tenantId } = await callOk<{ tenantId: string }>(token, 'completeSignup', {
      fullName: 'Board Shop',
      storeName: 'Board Shop',
      subdomain: `board${Date.now()}`,
      phone: '70000000',
    });
    expect((await entitlement(tenantId, 'online_store'))?.status).toBe('active');
    expect((await entitlement(tenantId, 'zelvero_ai'))?.status).toBe('active');
  });
});

describe('feature board', () => {
  it('is Super Admin only', async () => {
    expect((await call(owner, 'adminFeatureBoard', {})).error?.status).toBe('PERMISSION_DENIED');
    expect((await call(owner, 'adminSetTenantFeatures', { tenantId: T, grant: ['online_store'], revoke: [], confirm: true })).error?.status).toBe(
      'PERMISSION_DENIED',
    );
  });

  it('lists features (with what can be sent) and customers (with what they have)', async () => {
    const board = await callOk<{ features: { id: string; available: boolean; base: boolean }[]; tenants: { tenantId: string; features: Record<string, string> }[] }>(
      admin,
      'adminFeatureBoard',
      {},
    );
    const byId = Object.fromEntries(board.features.map((f) => [f.id, f]));
    expect(byId.online_store).toMatchObject({ available: true, base: true });
    expect(byId.stock_links?.available).toBe(false);
    expect(board.tenants.find((x) => x.tenantId === T)?.features).toEqual({});
  });

  it('deploy switches a feature on for that customer at once, and off again', async () => {
    await callOk(admin, 'adminSetTenantFeatures', { tenantId: T, grant: ['online_store'], revoke: [], confirm: true });
    expect((await entitlement(T, 'online_store'))?.status).toBe('active');
    const mine = await callOk<{ updates: { featureId: string; status: string }[] }>(owner, 'listMyFeatureUpdates', {});
    expect(mine.updates.find((u) => u.featureId === 'online_store')?.status).toBe('active');

    await callOk(admin, 'adminSetTenantFeatures', { tenantId: T, grant: [], revoke: ['online_store'], confirm: true });
    expect((await entitlement(T, 'online_store'))?.status).toBe('revoked');
  });

  it('refuses a feature that is still in testing, and an unknown customer', async () => {
    const testing = await call(admin, 'adminSetTenantFeatures', { tenantId: T, grant: ['stock_links'], revoke: [], confirm: true });
    expect(testing.error?.key).toBe('feature.board.customerPath');
    expect(await entitlement(T, 'stock_links')).toBeUndefined();
    const ghost = await call(admin, 'adminSetTenantFeatures', { tenantId: 'nobodyHere', grant: ['online_store'], revoke: [], confirm: true });
    expect(ghost.error?.key).toBe('feature.board.noCustomer');
  });
});
