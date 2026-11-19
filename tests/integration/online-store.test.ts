import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp, doc, getDoc, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defaultBranding } from '@/domain/onlineStore';
import { resolveAuthEmulatorHostPort } from './emulatorSafety';
import { asAdmin, call, callOk, clearAuth, clearFirestore, createEnv, createUser, functionsCallableUrl, PROJECT_ID, seedTenant, tp } from './helpers';

const AUTH = `http://${resolveAuthEmulatorHostPort()}`;
const PASSWORD = 'integration-pass-1';
const CUSTOMER = 'osCustomerOwner';
const OTHER_OWNER = 'osOtherOwner';
const SUB = 'osCustomerSub';
const ADMIN = 'osPlatformAdmin';

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

/** Unauthenticated public call, exactly as a website visitor's browser would make it. */
async function publicCatalog(slug: string): Promise<{ result?: { store: Record<string, unknown>; products: Array<Record<string, unknown>> }; status?: string; key?: string }> {
  const res = await fetch(functionsCallableUrl('publicStoreCatalog'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { slug } }),
  });
  const json = (await res.json()) as {
    result?: { store: Record<string, unknown>; products: Array<Record<string, unknown>> };
    error?: { status: string; message: string; details?: { key?: string } };
  };
  if (json.error) return { status: json.error.status, key: json.error.details?.key ?? json.error.message };
  return { result: json.result };
}

async function entitle(tenantId: string, status = 'active'): Promise<void> {
  await asAdmin(env, (fs) => setDoc(doc(fs, `platformFeatureEntitlements/${tenantId}__online_store`), { tenantId, featureId: 'online_store', status }));
}

async function addProduct(tenantId: string, id: string, name: string): Promise<void> {
  await asAdmin(env, (fs) =>
    setDoc(doc(fs, tp(tenantId, 'products', id)), {
      name,
      nameNormalized: name.toLowerCase(),
      status: 'active',
      category: 'Demo',
      barcode: '999',
      prices: { retail: { usdCents: 300, lbp: null }, wholesale: { usdCents: 0, lbp: null }, vip: { usdCents: 0, lbp: null } },
      costUsdCents: 120,
      stock: 5,
      supplierId: 'sup1',
      supplierName: 'Secret supplier',
      imageUrl: null,
      imagePath: null,
      createdAt: Timestamp.now(),
      createdAtMs: Date.now(),
      createdBy: tenantId,
    }),
  );
}

/** Enabled + slugged + one visible product + published. */
async function publishStore(token: string, slug: string, productIds: string[]): Promise<void> {
  await callOk(token, 'onlineStoreSaveDraft', { enabled: true, draft: defaultBranding('Demo Shop') });
  await callOk(token, 'onlineStoreSetSlug', { slug });
  await callOk(token, 'onlineStoreSetProductVisibility', { productIds });
  await callOk(token, 'onlineStorePublish', {});
}

beforeAll(async () => {
  env = await createEnv();
  await clearAuth();
  await createUser({ uid: CUSTOMER, tenantId: CUSTOMER, role: 'owner' });
  await createUser({ uid: OTHER_OWNER, tenantId: OTHER_OWNER, role: 'owner' });
  await createUser({ uid: SUB, tenantId: CUSTOMER, role: 'subUser', perms: { settings: true } });
  await createPureSuperAdmin(ADMIN);
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await clearFirestore(env);
  await seedTenant(env, CUSTOMER, [
    { uid: CUSTOMER, role: 'owner' },
    { uid: SUB, role: 'subUser', permissions: { settings: true } },
  ]);
  await seedTenant(env, OTHER_OWNER, [{ uid: OTHER_OWNER, role: 'owner' }]);
});

describe('online store: owner config authorization (feature OFF by default)', () => {
  it('denies a customer owner without an active online_store entitlement', async () => {
    const token = await signIn(CUSTOMER);
    expect((await call(token, 'onlineStoreGetConfig', {})).error?.status).toBe('PERMISSION_DENIED');
    expect((await call(token, 'onlineStoreSetSlug', { slug: 'my-shop' })).error?.status).toBe('PERMISSION_DENIED');
    await entitle(CUSTOMER, 'scheduled');
    expect((await call(token, 'onlineStoreGetConfig', {})).error?.status).toBe('PERMISSION_DENIED');
  });

  it('allows an entitled owner and starts disabled, unpublished, with no slug', async () => {
    await entitle(CUSTOMER);
    const token = await signIn(CUSTOMER);
    const res = await callOk<{ config: { enabled: boolean; publication: string; slug: string | null; published: unknown } }>(token, 'onlineStoreGetConfig', {});
    expect(res.config.enabled).toBe(false);
    expect(res.config.publication).toBe('draft');
    expect(res.config.slug).toBeNull();
    expect(res.config.published).toBeNull();
  });

  it('denies sub-users even with settings permission', async () => {
    await entitle(CUSTOMER);
    const token = await signIn(SUB);
    expect((await call(token, 'onlineStoreGetConfig', {})).error?.status).toBe('PERMISSION_DENIED');
  });

  it('denies an entitled owner while the platform kill switch is on', async () => {
    await entitle(CUSTOMER);
    await asAdmin(env, (fs) => setDoc(doc(fs, 'platformFeatureControl/global'), { killed: true }));
    const token = await signIn(CUSTOMER);
    expect((await call(token, 'onlineStoreGetConfig', {})).error?.status).toBe('PERMISSION_DENIED');
  });

  it('rejects client-supplied tenant fields', async () => {
    await entitle(CUSTOMER);
    const token = await signIn(CUSTOMER);
    for (const extra of [{ tenantId: OTHER_OWNER }, { storeId: OTHER_OWNER }, { uid: OTHER_OWNER }]) {
      expect((await call(token, 'onlineStoreSetSlug', { slug: 'my-shop', ...extra })).error?.status).toBe('INVALID_ARGUMENT');
    }
  });

  it('validates slugs and keeps them unique across tenants', async () => {
    await entitle(CUSTOMER);
    await entitle(OTHER_OWNER);
    const a = await signIn(CUSTOMER);
    const b = await signIn(OTHER_OWNER);
    const bad = await call(a, 'onlineStoreSetSlug', { slug: 'sh--op' });
    expect(bad.error).toMatchObject({ status: 'INVALID_ARGUMENT', key: 'error.onlineStore.slugInvalid' });
    const reserved = await call(a, 'onlineStoreSetSlug', { slug: 'admin' });
    expect(reserved.error).toMatchObject({ status: 'INVALID_ARGUMENT', key: 'error.onlineStore.slugReserved' });
    await callOk(a, 'onlineStoreSetSlug', { slug: 'abu-ali-market' });
    const taken = await call(b, 'onlineStoreSetSlug', { slug: 'abu-ali-market' });
    expect(taken.error).toMatchObject({ status: 'ALREADY_EXISTS', key: 'error.onlineStore.slugTaken' });
    // Moving to a new slug frees the old one.
    await callOk(a, 'onlineStoreSetSlug', { slug: 'abu-ali-two' });
    await callOk(b, 'onlineStoreSetSlug', { slug: 'abu-ali-market' });
  });

  it('refuses to publish an unready store and unknown products', async () => {
    await entitle(CUSTOMER);
    const token = await signIn(CUSTOMER);
    const res = await call(token, 'onlineStorePublish', {});
    expect(res.error).toMatchObject({ status: 'FAILED_PRECONDITION', key: 'error.onlineStore.notReady' });
    const unknown = await call(token, 'onlineStoreSetProductVisibility', { productIds: ['p1', 'nope'] });
    expect(unknown.error).toMatchObject({ status: 'INVALID_ARGUMENT', key: 'error.onlineStore.unknownProduct' });
  });
});

describe('online store: public catalog', () => {
  it('serves only published data, without cost, supplier, barcode or exact stock', async () => {
    await entitle(CUSTOMER);
    const token = await signIn(CUSTOMER);
    await publishStore(token, 'phone-corner', ['p1']);
    const res = await publicCatalog('phone-corner');
    expect(res.status).toBeUndefined();
    expect(res.result?.store.slug).toBe('phone-corner');
    expect(res.result?.store.storeName).toBe('Demo Shop');
    expect(res.result?.products).toHaveLength(1);
    const p = res.result?.products[0] ?? {};
    expect(Object.keys(p).sort()).toEqual(['category', 'id', 'imageUrl', 'inStock', 'name', 'priceLbp', 'priceUsdCents']);
    expect(p).toMatchObject({ id: 'p1', name: 'Phone case', priceUsdCents: 500, inStock: true });
    expect(JSON.stringify(res.result)).not.toMatch(/costUsdCents|supplier|barcode|"stock"/);
  });

  it('keeps draft edits private until published again', async () => {
    await entitle(CUSTOMER);
    const token = await signIn(CUSTOMER);
    await publishStore(token, 'phone-corner', ['p1']);
    await callOk(token, 'onlineStoreSaveDraft', { enabled: true, draft: { ...defaultBranding('Draft Name'), tagline: 'secret draft' } });
    const res = await publicCatalog('phone-corner');
    expect(res.result?.store.storeName).toBe('Demo Shop');
    expect(res.result?.store.tagline).toBe('');
  });

  it('returns NOT_FOUND for unknown, invalid or unpublished slugs', async () => {
    await entitle(CUSTOMER);
    const token = await signIn(CUSTOMER);
    expect((await publicCatalog('no-such-store')).status).toBe('NOT_FOUND');
    expect((await publicCatalog('BAD SLUG')).status).toBe('NOT_FOUND');
    await callOk(token, 'onlineStoreSaveDraft', { enabled: true, draft: defaultBranding('Demo Shop') });
    await callOk(token, 'onlineStoreSetSlug', { slug: 'not-live-yet' });
    expect((await publicCatalog('not-live-yet')).status).toBe('NOT_FOUND');
  });

  it('goes offline after unpublish, disable, entitlement loss or kill switch', async () => {
    await entitle(CUSTOMER);
    const token = await signIn(CUSTOMER);
    await publishStore(token, 'phone-corner', ['p1']);
    await callOk(token, 'onlineStoreUnpublish', {});
    expect((await publicCatalog('phone-corner')).status).toBe('NOT_FOUND');

    await callOk(token, 'onlineStorePublish', {});
    expect((await publicCatalog('phone-corner')).result).toBeDefined();
    await callOk(token, 'onlineStoreSaveDraft', { enabled: false, draft: defaultBranding('Demo Shop') });
    expect((await publicCatalog('phone-corner')).status).toBe('NOT_FOUND');

    await publishStore(token, 'phone-corner', ['p1']);
    await entitle(CUSTOMER, 'paused');
    expect((await publicCatalog('phone-corner')).status).toBe('NOT_FOUND');

    await entitle(CUSTOMER);
    expect((await publicCatalog('phone-corner')).result).toBeDefined();
    await asAdmin(env, (fs) => setDoc(doc(fs, 'platformFeatureControl/global'), { killed: true }));
    expect((await publicCatalog('phone-corner')).status).toBe('NOT_FOUND');
  });
});

describe('online store: internal demo tenant', () => {
  it('lets a verified Super Admin run the full flow on their internal demo store without an entitlement', async () => {
    const first = await signIn(ADMIN);
    await callOk(first, 'adminProvisionInternalDemo', {});
    const token = await signIn(ADMIN);
    await addProduct(ADMIN, 'demo-tea', 'Demo tea');
    await publishStore(token, 'zv-demo-shop', ['demo-tea']);
    const res = await publicCatalog('zv-demo-shop');
    expect(res.result?.products.map((p) => p.id)).toEqual(['demo-tea']);
    expect(JSON.stringify(res.result)).not.toMatch(/Secret supplier|costUsdCents|"999"/);
  });
});

/** Unauthenticated website checkout, exactly as a visitor's browser would send it. */
async function publicOrder(data: Record<string, unknown>): Promise<{ result?: { ref: string; status: string; totalUsdCents: number; totalLbp: number }; status?: string; key?: string }> {
  const res = await fetch(functionsCallableUrl('publicPlaceOrder'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  const json = (await res.json()) as {
    result?: { ref: string; status: string; totalUsdCents: number; totalLbp: number };
    error?: { status: string; message: string; details?: { key?: string } };
  };
  if (json.error) return { status: json.error.status, key: json.error.details?.key ?? json.error.message };
  return { result: json.result };
}

const order = (lines: Array<{ productId: string; qty: number }>, extra: Record<string, unknown> = {}) => ({
  slug: 'phone-corner',
  lines,
  name: 'Test Buyer',
  phone: '70 123 456',
  address: 'Hamra, Beirut',
  note: '',
  fulfillment: 'delivery',
  payment: 'cod',
  ...extra,
});

async function stockOf(tenantId: string, productId: string): Promise<number> {
  let stock = -1;
  await asAdmin(env, async (fs) => {
    stock = Number((await getDoc(doc(fs, tp(tenantId, 'products', productId)))).get('stock'));
  });
  return stock;
}

async function onlyOrderId(token: string): Promise<string> {
  const list = await callOk<{ orders: Array<{ id: string }> }>(token, 'onlineOrdersList', {});
  expect(list.orders).toHaveLength(1);
  return list.orders[0].id;
}

describe('online store: website orders', () => {
  it('prices on the server, reserves stock and returns a reference', async () => {
    await entitle(CUSTOMER);
    const token = await signIn(CUSTOMER);
    await publishStore(token, 'phone-corner', ['p1']);
    const res = await publicOrder(order([{ productId: 'p1', qty: 2 }]));
    expect(res.status).toBeUndefined();
    expect(res.result?.ref).toMatch(/^ZV-\d{6}$/);
    expect(res.result?.status).toBe('pending');
    expect(res.result?.totalUsdCents).toBe(1000);
    expect(await stockOf(CUSTOMER, 'p1')).toBe(8);
    const list = await callOk<{ orders: Array<{ ref: string; customerPhone: string; status: string }> }>(token, 'onlineOrdersList', {});
    expect(list.orders).toMatchObject([{ ref: res.result?.ref, customerPhone: '70123456', status: 'pending' }]);
  });

  it('refuses hidden, IMEI-tracked and out-of-stock products, and client price fields', async () => {
    await entitle(CUSTOMER);
    const token = await signIn(CUSTOMER);
    await publishStore(token, 'phone-corner', ['p1']);
    expect((await publicOrder(order([{ productId: 'ph', qty: 1 }]))).key).toBe('error.onlineOrders.unavailable');
    expect((await publicOrder(order([{ productId: 'p1', qty: 11 }]))).key).toBe('error.onlineOrders.outOfStock');
    expect((await publicOrder(order([{ productId: 'p1', qty: 1 }], { totalUsdCents: 1 }))).status).toBe('INVALID_ARGUMENT');
    expect((await publicOrder(order([{ productId: 'p1', qty: 1 }], { tenantId: OTHER_OWNER }))).status).toBe('INVALID_ARGUMENT');
    expect((await publicOrder(order([{ productId: 'p1', qty: 1 }], { slug: 'no-such-store' }))).status).toBe('NOT_FOUND');
    expect(await stockOf(CUSTOMER, 'p1')).toBe(10);
  });

  it('keeps IMEI-tracked products out of the public catalog', async () => {
    await entitle(CUSTOMER);
    const token = await signIn(CUSTOMER);
    await publishStore(token, 'phone-corner', ['p1', 'ph']);
    expect((await publicCatalog('phone-corner')).result?.products.map((p) => p.id)).toEqual(['p1']);
  });

  it('follows the status machine and rejects skipped steps', async () => {
    await entitle(CUSTOMER);
    const token = await signIn(CUSTOMER);
    await publishStore(token, 'phone-corner', ['p1']);
    await publicOrder(order([{ productId: 'p1', qty: 1 }]));
    const orderId = await onlyOrderId(token);
    const skip = await call(token, 'onlineOrdersSetStatus', { orderId, status: 'delivered' });
    expect(skip.error).toMatchObject({ status: 'FAILED_PRECONDITION', key: 'error.onlineOrders.badTransition' });
    for (const status of ['accepted', 'preparing', 'ready', 'delivered']) {
      await callOk(token, 'onlineOrdersSetStatus', { orderId, status });
    }
    const after = await call(token, 'onlineOrdersSetStatus', { orderId, status: 'cancelled' });
    expect(after.error?.status).toBe('FAILED_PRECONDITION');
    expect(await stockOf(CUSTOMER, 'p1')).toBe(9);
  });

  it('gives stock back exactly once on cancel', async () => {
    await entitle(CUSTOMER);
    const token = await signIn(CUSTOMER);
    await publishStore(token, 'phone-corner', ['p1']);
    await publicOrder(order([{ productId: 'p1', qty: 3 }]));
    expect(await stockOf(CUSTOMER, 'p1')).toBe(7);
    const orderId = await onlyOrderId(token);
    await callOk(token, 'onlineOrdersSetStatus', { orderId, status: 'cancelled' });
    expect(await stockOf(CUSTOMER, 'p1')).toBe(10);
    expect((await call(token, 'onlineOrdersSetStatus', { orderId, status: 'rejected' })).error?.status).toBe('FAILED_PRECONDITION');
    expect((await call(token, 'onlineOrdersSetStatus', { orderId, status: 'cancelled' })).error?.status).toBe('FAILED_PRECONDITION');
    expect(await stockOf(CUSTOMER, 'p1')).toBe(10);
  });

  it('keeps the inbox to the owning tenant owner', async () => {
    await entitle(CUSTOMER);
    await entitle(OTHER_OWNER);
    const token = await signIn(CUSTOMER);
    await publishStore(token, 'phone-corner', ['p1']);
    await publicOrder(order([{ productId: 'p1', qty: 1 }]));
    const orderId = await onlyOrderId(token);
    const other = await signIn(OTHER_OWNER);
    expect((await callOk<{ orders: unknown[] }>(other, 'onlineOrdersList', {})).orders).toHaveLength(0);
    expect((await call(other, 'onlineOrdersSetStatus', { orderId, status: 'rejected' })).error?.status).toBe('NOT_FOUND');
    const sub = await signIn(SUB);
    expect((await call(sub, 'onlineOrdersList', {})).error?.status).toBe('PERMISSION_DENIED');
    expect((await call(token, 'onlineOrdersList', { tenantId: OTHER_OWNER })).error?.status).toBe('INVALID_ARGUMENT');
    expect(await stockOf(CUSTOMER, 'p1')).toBe(9);
  });
});
