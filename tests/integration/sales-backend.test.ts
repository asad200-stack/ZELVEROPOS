import { doc, setDoc, Timestamp } from 'firebase/firestore';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAdmin, call, callOk, clearAuth, clearFirestore, createEnv, createUser, DAY, FUNCTIONS_ORIGIN, PROJECT_ID, readDoc, readWhere, seedTenant, T } from './helpers';

const FUNCTIONS = `${FUNCTIONS_ORIGIN}/${PROJECT_ID}/europe-west1`;
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099'}`;
const RATE = 89_500;

let env: RulesTestEnvironment;
let adminToken: string;
let cashierToken: string;

async function publicCall(name: string, data: unknown, token?: string) {
  const res = await fetch(`${FUNCTIONS}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ data }),
  });
  return (await res.json()) as { result?: Record<string, unknown>; error?: { status: string; message: string; details?: { key?: string } } };
}

function baseContact(over: Record<string, unknown> = {}) {
  return {
    name: 'Rami',
    businessName: 'Rami Phones',
    email: 'rami@zelvero.test',
    phone: '70123456',
    businessType: 'mobile-electronics',
    country: 'Lebanon',
    clientOperationId: `op${Math.random().toString(36).slice(2, 12)}`,
    formStartedAt: Date.now() - 2_000,
    website: '',
    ...over,
  };
}

beforeAll(async () => {
  env = await createEnv();
  await clearFirestore(env);
  await clearAuth();
  await seedTenant(env, T, [
    { uid: T, role: 'owner' },
    { uid: 'sales-cashier', role: 'subUser', permissions: { canSell: true } },
  ]);
  adminToken = await createUser({ uid: 'sales-admin', tenantId: T, role: 'owner', superAdmin: true });
  cashierToken = await createUser({ uid: 'sales-cashier', tenantId: T, role: 'subUser', perms: { canSell: true } });
  await createUser({ uid: T, tenantId: T, role: 'owner' });
  await asAdmin(env, (fs) => setDoc(doc(fs, 'platformReferrals/TESTPARTNER'), { active: true, partnerName: 'Test' }));
});
afterAll(async () => {
  await env?.cleanup();
});

describe('website leads', () => {
  it('stores a quote request with a reference and a lead, without a fake price', async () => {
    const res = await publicCall('submitWebsiteLead', {
      ...baseContact({ email: 'quote@zelvero.test', clientOperationId: 'quoteop00123456' }),
      source: 'quote',
      branches: 2,
      users: 5,
      posDevices: 3,
      features: ['POS', 'Inventory'],
    });
    expect(res.error).toBeUndefined();
    expect(String(res.result?.reference)).toMatch(/^ZV-Q-/);
    expect(JSON.stringify(res.result)).not.toMatch(/\$\d/);
    const leads = await readWhere(env, 'platformLeads', 'email', 'quote@zelvero.test');
    expect(leads).toHaveLength(1);
    expect(leads[0]?.status).toBe('QUOTE');
    expect(leads[0]?.source).toBe('quote');
  });

  it('replays the same quote operation id', async () => {
    const first = await publicCall('submitWebsiteLead', {
      ...baseContact({ email: 'dupquote@zelvero.test', clientOperationId: 'quoteopDUP000001' }),
      source: 'quote',
      branches: 1,
      users: 1,
    });
    const second = await publicCall('submitWebsiteLead', {
      ...baseContact({ email: 'dupquote@zelvero.test', clientOperationId: 'quoteopDUP000001', name: 'Changed' }),
      source: 'quote',
      branches: 9,
      users: 9,
    });
    expect(second.result).toEqual(first.result);
    expect(await readWhere(env, 'platformLeads', 'email', 'dupquote@zelvero.test')).toHaveLength(1);
  });

  it('creates demo and contact leads and dedupes the same email', async () => {
    await publicCall('submitWebsiteLead', { ...baseContact({ email: 'same@zelvero.test', source: 'demo_request', clientOperationId: 'demooo00000001' }) });
    await publicCall('submitWebsiteLead', { ...baseContact({ email: 'same@zelvero.test', source: 'contact', clientOperationId: 'contact0000001', phone: '70999999' }) });
    const leads = await readWhere(env, 'platformLeads', 'email', 'same@zelvero.test');
    expect(leads).toHaveLength(1);
  });

  it('credits a valid referral and ignores an invalid one', async () => {
    const ok = await publicCall('submitWebsiteLead', {
      ...baseContact({ email: 'refok@zelvero.test', phone: '71111111', source: 'contact', referralCode: 'TESTPARTNER', clientOperationId: 'refok000000001' }),
    });
    const bad = await publicCall('submitWebsiteLead', {
      ...baseContact({ email: 'refbad@zelvero.test', phone: '72222222', source: 'contact', referralCode: 'NOTREAL', clientOperationId: 'refbad00000001' }),
    });
    expect(ok.result?.referralAccepted).toBe(true);
    expect(bad.result?.referralAccepted).toBe(false);
    expect((await readWhere(env, 'platformLeads', 'email', 'refbad@zelvero.test'))[0]?.referralCode ?? null).toBeFalsy();
  });

  it('rejects malformed contact input', async () => {
    const res = await publicCall('submitWebsiteLead', { source: 'contact', email: 'nope', clientOperationId: 'bad00000000001', formStartedAt: Date.now() - 2_000 });
    expect(res.error?.status).toBe('INVALID_ARGUMENT');
  });
});

async function trialIndex(email: string) {
  return readDoc(env, `platformTrialIndex/email_${email.toLowerCase()}`);
}

describe('website trial provisioning', () => {
  it('creates an inactive store without returning auth or tenant ids', async () => {
    const res = await publicCall('provisionWebsiteTrial', {
      ...baseContact({
        email: 'owner1@zelvero.test',
        ownerName: 'Owner One',
        name: 'Owner One',
        password: 'trial-pass-1',
        primaryCurrency: 'USD / LBP',
        clientOperationId: 'trialop00000001',
        referralCode: 'TESTPARTNER',
      }),
    });
    expect(res.error, JSON.stringify(res.error)).toBeUndefined();
    expect(res.result).toEqual({ ok: true, referralAccepted: true, resumable: false });
    const tenantId = String((await trialIndex('owner1@zelvero.test'))?.tenantId);
    expect(tenantId).toMatch(/^t[a-f0-9]{24}$/);
    const sub = await readDoc(env, `subscriptions/${tenantId}`);
    expect(sub?.status).toBe('pending_activation');
    expect(sub?.activated).toBe(false);
    expect(sub?.plan).toBeNull();
    expect(sub?.source).toBe('website');
    expect(sub?.referralCode).toBe('TESTPARTNER');
    expect(sub?.endsAt ?? null).toBeNull();
    expect((await readWhere(env, 'platformLeads', 'email', 'owner1@zelvero.test'))[0]?.status).toBe('TRIAL');
    expect(await readDoc(env, `tenants/${tenantId}/onboarding/main`)).toMatchObject({ skipped: false });
  });

  it('replays duplicate trial submits and refuses a second tenant for the same email', async () => {
    const payload = {
      ...baseContact({
        email: 'owner2@zelvero.test',
        ownerName: 'Owner Two',
        name: 'Owner Two',
        password: 'trial-pass-2',
        primaryCurrency: 'USD',
        clientOperationId: 'trialop00000002',
      }),
    };
    const first = await publicCall('provisionWebsiteTrial', payload);
    const replay = await publicCall('provisionWebsiteTrial', payload);
    expect(replay.result).toEqual(first.result);
    expect(replay.result).not.toHaveProperty('tenantId');
    expect(replay.result).not.toHaveProperty('uid');
    const second = await publicCall('provisionWebsiteTrial', { ...payload, clientOperationId: 'trialop00000003' });
    expect(second.error?.details?.key || second.error?.message).toMatch(/trialUnavailable/);
    expect(await trialIndex('owner2@zelvero.test')).toMatchObject({ tenantId: expect.stringMatching(/^t[a-f0-9]{24}$/) });
  });

  it('does not open a new trial for an existing store owner', async () => {
    const res = await publicCall('provisionWebsiteTrial', {
      ...baseContact({
        email: `${T.toLowerCase()}@test.local`,
        ownerName: 'Existing',
        name: 'Existing',
        password: 'integration-pass-1',
        primaryCurrency: 'USD',
        clientOperationId: 'trialopEXIST0001',
      }),
    });
    const key = res.error?.details?.key || res.error?.message || JSON.stringify(res);
    expect(key).toMatch(/trialUnavailable|trialNotOpen/);
  });
});

describe('trial expiry', () => {
  it('blocks writes while inactive or expired, including before the lifecycle sweep', async () => {
    const provisioned = await publicCall('provisionWebsiteTrial', {
      ...baseContact({
        email: 'expire@zelvero.test',
        ownerName: 'Expire',
        name: 'Expire',
        password: 'trial-pass-9',
        primaryCurrency: 'USD',
        clientOperationId: 'trialopEXPIRE001',
      }),
    });
    expect(provisioned.result).not.toHaveProperty('tenantId');
    const indexed = await trialIndex('expire@zelvero.test');
    const tenantId = String(indexed?.tenantId);
    const uid = String(indexed?.uid);
    await asAdmin(env, async (fs) => {
      await setDoc(doc(fs, `tenants/${tenantId}/products/p1`), {
        name: 'Case',
        nameNormalized: 'case',
        status: 'active',
        category: '',
        barcode: '',
        prices: { retail: { usdCents: 500, lbp: null }, wholesale: { usdCents: 0, lbp: null }, vip: { usdCents: 0, lbp: null } },
        costUsdCents: 200,
        stock: 10,
        minStock: null,
        supplierId: null,
        supplierName: '',
        expiryDate: null,
        imeiTracking: false,
        imeis: [],
        imageUrl: null,
        imagePath: null,
        lastMovementId: null,
      });
    });
    const signIn = async () => {
      const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'expire@zelvero.test', password: 'trial-pass-9', returnSecureToken: true }),
      });
      return String(((await res.json()) as { idToken: string }).idToken);
    };
    const checkout = (token: string, saleId: string) => call(token, 'posCheckout', {
      saleId,
      kind: 'cash',
      currency: 'USD',
      rate: RATE,
      customerId: null,
      debtLineUsdCents: null,
      lines: [{ productId: 'p1', tier: 'retail', quantity: 1, customUsdCents: null, imei: null }],
      expectedTotalUsdCents: 500,
      cash: { receivedUsdCents: 500, receivedLbp: 0 },
    });
    const unverified = await checkout(await signIn(), `sale-exp-unverified-${Date.now()}`);
    expect(unverified.error?.key).toBe('error.permissionDenied');
    await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:update`, {
      method: 'POST',
      headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
      body: JSON.stringify({ localId: uid, emailVerified: true }),
    });
    const inactive = await checkout(await signIn(), `sale-exp-inactive-${Date.now()}`);
    expect(inactive.error?.key).toBe('error.fn.subscriptionInactive');
    await callOk(adminToken, 'adminSetSubscription', { uid, action: 'activate', days: 15 });
    const sold = await callOk<{ sale: { id?: string } }>(await signIn(), 'posCheckout', {
      saleId: `sale-exp-${Date.now()}`,
      kind: 'cash',
      currency: 'USD',
      rate: RATE,
      customerId: null,
      debtLineUsdCents: null,
      lines: [{ productId: 'p1', tier: 'retail', quantity: 1, customUsdCents: null, imei: null }],
      expectedTotalUsdCents: 500,
      cash: { receivedUsdCents: 500, receivedLbp: 0 },
    });
    expect(sold.sale).toBeTruthy();
    await asAdmin(env, (fs) =>
      setDoc(
        doc(fs, `subscriptions/${tenantId}`),
        {
          activated: true,
          trial: true,
          status: 'trial',
          source: 'website',
          startsAt: Timestamp.fromMillis(Date.now() - 16 * DAY),
          endsAt: Timestamp.fromMillis(Date.now() - 60_000),
          trialStartedAt: Timestamp.fromMillis(Date.now() - 16 * DAY),
          trialEndsAt: Timestamp.fromMillis(Date.now() - 60_000),
          notificationsSent: { day0: true },
        },
        { merge: true },
      ),
    );
    const blocked = await checkout(await signIn(), `sale-exp-block-${Date.now()}`);
    expect(blocked.error?.key).toBe('error.fn.subscriptionInactive');
    expect((await readDoc(env, `subscriptions/${tenantId}`))?.status).toBe('trial');
    await callOk(adminToken, 'adminRunTrialLifecycle', {});
    expect((await readDoc(env, `subscriptions/${tenantId}`))?.status).toBe('trial_expired');
    expect(await readDoc(env, `tenants/${tenantId}/notifications/day15`)).toMatchObject({ day: 15 });
    expect(await readDoc(env, `tenants/${tenantId}/products/p1`)).toBeTruthy();
    const sales = await readWhere(env, `tenants/${tenantId}/sales`, 'createdBy', uid);
    expect(sales.length).toBeGreaterThan(0);
  });
});

describe('CRM authorization', () => {
  it('lets Super Admin list leads and refuses cashiers', async () => {
    const admin = await call(adminToken, 'adminListLeads', {});
    expect(admin.error).toBeUndefined();
    expect(Array.isArray(admin.result?.leads)).toBe(true);
    const cashier = await call(cashierToken, 'adminListLeads', {});
    expect(cashier.error?.status).toBe('PERMISSION_DENIED');
    const anon = await publicCall('adminListLeads', {});
    expect(anon.error?.status).toBe('UNAUTHENTICATED');
  });
});
