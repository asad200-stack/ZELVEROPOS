import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, clearAuth, createEnv, createUser, PROJECT_ID, seedTenant, T } from './helpers';

const FUNCTIONS = `http://127.0.0.1:5001/${PROJECT_ID}/europe-west1`;

let env: RulesTestEnvironment;
let ownerToken: string;
let cashierToken: string;

async function rawCall(name: string, data: unknown, token?: string) {
  const res = await fetch(`${FUNCTIONS}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ data }),
  });
  return { status: res.status, json: (await res.json()) as { result?: unknown; error?: { status: string; message: string } } };
}

beforeAll(async () => {
  env = await createEnv();
  await env.clearFirestore();
  await clearAuth();
  await seedTenant(env, T, [
    { uid: T, role: 'owner' },
    { uid: 'sec-cashier', role: 'subUser', permissions: { canSell: true } },
  ]);
  ownerToken = await createUser({ uid: T, tenantId: T, role: 'owner' });
  cashierToken = await createUser({ uid: 'sec-cashier', tenantId: T, role: 'subUser', perms: { canSell: true } });
});
afterAll(async () => {
  await env?.cleanup();
});

describe('callable exposure (public invoker ≠ public business access)', () => {
  it('rejects unauthenticated money and admin callables', async () => {
    for (const name of ['posCheckout', 'posCashMove', 'refreshMyClaims', 'adminListAccounts', 'clearTenantData', 'completeSignup']) {
      const res = await rawCall(name, {});
      expect(res.json.error?.status, name).toBe('UNAUTHENTICATED');
    }
  });

  it('still allows the public signup-availability probe without an App Check token', async () => {
    const res = await rawCall('checkSignupAvailability', { subdomain: 'phase-f-store' });
    expect(res.json.result).toEqual({ subdomainAvailable: true });
  });
});

describe('authorization', () => {
  it('cashiers cannot run owner/admin operations', async () => {
    expect((await call(cashierToken, 'clearTenantData', { confirm: 'DELETE' })).error?.status).toBe('PERMISSION_DENIED');
    expect((await call(cashierToken, 'adminListAccounts', {})).error?.status).toBe('PERMISSION_DENIED');
    expect((await call(cashierToken, 'createSubUser', { email: 'x@test.local', password: 'password1', fullName: 'X', permissions: {} })).error?.status).toBe(
      'PERMISSION_DENIED',
    );
  });

  it('rejects oversized notes on checkout', async () => {
    const { error } = await call(cashierToken, 'posCheckout', {
      saleId: 'saleOversize1',
      kind: 'cash',
      currency: 'USD',
      rate: 89500,
      customerId: null,
      debtLineUsdCents: null,
      lines: [{ productId: 'p1', tier: 'retail', quantity: 1, customUsdCents: null, imei: null }],
      expectedTotalUsdCents: 500,
      note: 'n'.repeat(5000),
      cash: { receivedUsdCents: 500, receivedLbp: 0 },
    });
    expect(error?.status).toBe('INVALID_ARGUMENT');
  });
});

describe('App Check monitoring (not enforced)', () => {
  it('emulator callables succeed without an App Check header', async () => {
    const res = await rawCall('refreshMyClaims', {}, ownerToken);
    expect(res.json.error).toBeUndefined();
    expect(res.json.result).toEqual({ ok: true });
  });
});
