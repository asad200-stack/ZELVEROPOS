import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveAuthEmulatorHostPort } from './emulatorSafety';
import { asAdmin, call, callOk, clearAuth, clearFirestore, createEnv, createUser, PROJECT_ID, RATE, readDoc, seedTenant, tp } from './helpers';

const AUTH = `http://${resolveAuthEmulatorHostPort()}`;
const PASSWORD = 'integration-pass-1';
const CUSTOMER = 'customerOwner';
const ADMIN = 'platformAdmin';

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
  const json = await authPost('accounts:signInWithPassword', {
    email: `${uid.toLowerCase()}@test.local`,
    password: PASSWORD,
    returnSecureToken: true,
  });
  return String(json.idToken);
}

async function createPureSuperAdmin(uid: string): Promise<void> {
  const email = `${uid.toLowerCase()}@test.local`;
  await authPost(`projects/${PROJECT_ID}/accounts`, { localId: uid, email, password: PASSWORD, emailVerified: true }, true);
  await authPost(
    `projects/${PROJECT_ID}/accounts:update`,
    { localId: uid, customAttributes: JSON.stringify({ superAdmin: true }), emailVerified: true },
    true,
  );
}

/** A modified token that names a customer tenant. The preview credential must ignore it. */
async function poisonTenantClaim(uid: string, tenantId: string): Promise<string> {
  await authPost(
    `projects/${PROJECT_ID}/accounts:update`,
    {
      localId: uid,
      customAttributes: JSON.stringify({ superAdmin: true, tenantId, role: 'owner', active: true }),
      emailVerified: true,
    },
    true,
  );
  return signIn(uid);
}

function cashSale(saleId: string, extra: Record<string, unknown> = {}) {
  return {
    saleId,
    kind: 'cash',
    currency: 'USD',
    rate: RATE,
    customerId: null,
    debtLineUsdCents: null,
    lines: [{ productId: 'p1', tier: 'retail', quantity: 2, customUsdCents: null, imei: null }],
    expectedTotalUsdCents: 1_000,
    cash: { receivedUsdCents: 1_000, receivedLbp: 0 },
    ...extra,
  };
}

async function stock(tenantId: string): Promise<number> {
  return Number((await readDoc(env, tp(tenantId, 'products', 'p1')))?.stock);
}

async function addDemoProduct(tenantId: string): Promise<void> {
  const now = Timestamp.now();
  await asAdmin(env, async (fs) => {
    await setDoc(
      doc(fs, tp(tenantId, 'products', 'p1')),
      {
        name: 'Phone case',
        status: 'active',
        category: 'Accessories',
        barcode: '',
        prices: { retail: { usdCents: 500, lbp: null }, wholesale: { usdCents: 0, lbp: null }, vip: { usdCents: 0, lbp: null } },
        costUsdCents: 200,
        stock: 10,
        minStock: null,
        imeiTracking: false,
        imeis: [],
        createdAt: now,
        createdAtMs: Date.now(),
        createdBy: tenantId,
      },
      { merge: true },
    );
    await setDoc(doc(fs, tp(tenantId, 'settings', 'main')), { exchangeRate: RATE }, { merge: true });
  });
}

beforeAll(async () => {
  env = await createEnv();
  await clearAuth();
  await createUser({ uid: CUSTOMER, tenantId: CUSTOMER, role: 'owner' });
  await createPureSuperAdmin(ADMIN);
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await clearFirestore(env);
  await seedTenant(env, CUSTOMER, [{ uid: CUSTOMER, role: 'owner' }]);
});

describe('preview credential boundary', () => {
  it('keeps an ordinary customer checkout on the customer tenant', async () => {
    const token = await signIn(CUSTOMER);
    const sale = await callOk<{ sale: { totalUsdCents: number } }>(token, 'posCheckout', cashSale('customer-sale'));
    expect(sale.sale.totalUsdCents).toBe(1_000);
    expect(await stock(CUSTOMER)).toBe(8);
    expect(await readDoc(env, tp(ADMIN, 'products', 'p1'))).toBeUndefined();
  });

  it('refuses a customer owner and a super admin who has no internal demo', async () => {
    const customer = await signIn(CUSTOMER);
    expect((await call(customer, 'issuePreviewCredential', {})).error?.status).toBe('PERMISSION_DENIED');
    expect((await call(customer, 'previewPos', { credentialId: 'a'.repeat(32), secret: 'b'.repeat(64), operation: 'posCheckout', payload: {} })).error?.status).toBe('PERMISSION_DENIED');
    expect(await stock(CUSTOMER)).toBe(10);

    const admin = await signIn(ADMIN);
    expect((await call(admin, 'issuePreviewCredential', { tenantId: CUSTOMER })).error?.status).toBe('PERMISSION_DENIED');
    expect(await stock(CUSTOMER)).toBe(10);
  });

  it('checks out only the server-resolved demo tenant when the token and body name a customer', async () => {
    const admin = await signIn(ADMIN);
    const created = await callOk<{ tenantId: string }>(admin, 'adminProvisionInternalDemo', { tenantId: CUSTOMER });
    expect(created.tenantId).toBe(ADMIN);
    await addDemoProduct(ADMIN);
    const poisoned = await poisonTenantClaim(ADMIN, CUSTOMER);
    const credential = await callOk<{ credentialId: string; secret: string; tenantId: string }>(poisoned, 'issuePreviewCredential', {
      tenantId: CUSTOMER,
    });
    expect(credential.tenantId).toBe(ADMIN);

    const result = await callOk<{ sale: { totalUsdCents: number } }>(poisoned, 'previewPos', {
      credentialId: credential.credentialId,
      secret: credential.secret,
      operation: 'posCheckout',
      payload: cashSale('preview-sale', { tenantId: CUSTOMER }),
    });
    expect(result.sale.totalUsdCents).toBe(1_000);
    expect(await stock(ADMIN)).toBe(8);
    expect(await stock(CUSTOMER)).toBe(10);
  });

  it('rejects a wrong secret and a release cutover operation without touching the customer', async () => {
    const admin = await signIn(ADMIN);
    await callOk(admin, 'adminProvisionInternalDemo', {});
    await addDemoProduct(ADMIN);
    const credential = await callOk<{ credentialId: string; secret: string }>(admin, 'issuePreviewCredential', {});
    const wrong = await call(admin, 'previewPos', {
      credentialId: credential.credentialId,
      secret: 'c'.repeat(64),
      operation: 'posCheckout',
      payload: cashSale('rejected-sale'),
    });
    expect(wrong.error?.status).toBe('PERMISSION_DENIED');
    const cutover = await call(admin, 'previewPos', {
      credentialId: credential.credentialId,
      secret: credential.secret,
      operation: 'assignReleaseTenants',
      payload: { tenantIds: [CUSTOMER], version: '0.9.1-admin.1', confirm: 'RELEASE 0.9.1-admin.1 TO SELECTED STORES' },
    });
    expect(cutover.error?.status).toBe('INVALID_ARGUMENT');
    const everyone = await call(admin, 'previewPos', {
      credentialId: credential.credentialId,
      secret: credential.secret,
      operation: 'releaseToEveryone',
      payload: { version: '0.9.1-admin.1', confirm: 'RELEASE 0.9.1-admin.1 TO EVERYONE' },
    });
    expect(everyone.error?.status).toBe('INVALID_ARGUMENT');
    expect(await stock(CUSTOMER)).toBe(10);
    expect(await stock(ADMIN)).toBe(10);
    expect(await readDoc(env, 'platformReleaseAssignments/' + CUSTOMER)).toBeUndefined();
  });
});
