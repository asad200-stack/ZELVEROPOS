import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveAuthEmulatorHostPort } from './emulatorSafety';
import { asAdmin, call, callOk, clearAuth, clearFirestore, createEnv, createUser, PROJECT_ID, readDoc, seedTenant } from './helpers';

const AUTH = `http://${resolveAuthEmulatorHostPort()}`;
const PASSWORD = 'integration-pass-1';
const CUSTOMER = 'customerOwner';
const DEMO_SUBDOMAIN = 'zelvero-internal-demo';

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

/** A platform admin exactly as bootstrapSuperAdmin leaves it: only the superAdmin claim, no profile. */
async function createPureSuperAdmin(uid: string): Promise<string> {
  const email = `${uid.toLowerCase()}@test.local`;
  await authPost(`projects/${PROJECT_ID}/accounts`, { localId: uid, email, password: PASSWORD, emailVerified: true }, true);
  await authPost(`projects/${PROJECT_ID}/accounts:update`, { localId: uid, customAttributes: JSON.stringify({ superAdmin: true }), emailVerified: true }, true);
  return signIn(uid);
}

async function signIn(uid: string): Promise<string> {
  const json = await authPost('accounts:signInWithPassword', { email: `${uid.toLowerCase()}@test.local`, password: PASSWORD, returnSecureToken: true });
  return String(json.idToken);
}

function claimsOf(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
}

async function customerSnapshot() {
  return {
    user: await readDoc(env, `users/${CUSTOMER}`),
    subscription: await readDoc(env, `subscriptions/${CUSTOMER}`),
    product: await readDoc(env, `tenants/${CUSTOMER}/products/p1`),
    cashbox: await readDoc(env, `tenants/${CUSTOMER}/cashbox/summary`),
  };
}

beforeAll(async () => {
  env = await createEnv();
  await clearFirestore(env);
  await clearAuth();
  await createUser({ uid: CUSTOMER, tenantId: CUSTOMER, role: 'owner' });
  await seedTenant(env, CUSTOMER, [{ uid: CUSTOMER, role: 'owner' }]);
});
afterAll(async () => {
  await env?.cleanup();
});

describe('adminProvisionInternalDemo', () => {
  it('a customer owner cannot create a demo store', async () => {
    const token = await signIn(CUSTOMER);
    const res = await call(token, 'adminProvisionInternalDemo', {});
    expect(res.error?.status).toBe('PERMISSION_DENIED');
  });

  it('gives a pure super admin one isolated demo store and keeps the superAdmin claim', async () => {
    const before = await customerSnapshot();
    const token = await createPureSuperAdmin('platformAdmin');
    const result = await callOk<{ tenantId: string; created: boolean }>(token, 'adminProvisionInternalDemo', {});
    expect(result).toMatchObject({ tenantId: 'platformAdmin', created: true });

    expect(await readDoc(env, 'users/platformAdmin')).toMatchObject({ role: 'owner', tenantId: 'platformAdmin', internalDemo: true, isActive: true });
    expect(await readDoc(env, 'subscriptions/platformAdmin')).toMatchObject({ activated: true, lifetime: true, trial: false, internalDemo: true });
    expect(await readDoc(env, 'stores/platformAdmin')).toMatchObject({ subdomain: DEMO_SUBDOMAIN, internalDemo: true });
    expect(await readDoc(env, `storeSubdomains/${DEMO_SUBDOMAIN}`)).toMatchObject({ tenantId: 'platformAdmin' });

    const claims = claimsOf(await signIn('platformAdmin'));
    expect(claims).toMatchObject({ superAdmin: true, tenantId: 'platformAdmin', role: 'owner', active: true });
    expect(await customerSnapshot()).toEqual(before);
  });

  it('is idempotent for the demo store it created', async () => {
    const token = await signIn('platformAdmin');
    expect(await callOk(token, 'adminProvisionInternalDemo', {})).toMatchObject({ created: false });
  });

  it('demo POS operations stay in the demo tenant', async () => {
    const before = await customerSnapshot();
    const token = await signIn('platformAdmin');
    await callOk(token, 'posCashMove', { type: 'deposit', usdCents: 1_000, lbp: 0, category: '', note: 'demo' });
    expect((await readDoc(env, 'tenants/platformAdmin/cashbox/summary'))?.usdCents).toBe(1_000);
    expect(await customerSnapshot()).toEqual(before);
  });

  it('never attaches a super admin that already has a store profile', async () => {
    const token = await createPureSuperAdmin('attachedAdmin');
    await asAdmin(env, (fs) => setDoc(doc(fs, 'users/attachedAdmin'), { uid: 'attachedAdmin', role: 'owner', tenantId: CUSTOMER, isActive: true }));
    const res = await call(token, 'adminProvisionInternalDemo', {});
    expect(res.error).toMatchObject({ status: 'ALREADY_EXISTS', key: 'error.fn.alreadySetUp' });
    expect(await readDoc(env, 'users/attachedAdmin')).toMatchObject({ tenantId: CUSTOMER });
    expect(await readDoc(env, 'subscriptions/attachedAdmin')).toBeUndefined();
  });

  it('never adopts leftover store data keyed by the super admin uid', async () => {
    const token = await createPureSuperAdmin('leftoverAdmin');
    await asAdmin(env, (fs) => setDoc(doc(fs, 'stores/leftoverAdmin'), { ownerUid: 'leftoverAdmin', storeName: 'Old' }));
    const res = await call(token, 'adminProvisionInternalDemo', {});
    expect(res.error).toMatchObject({ status: 'FAILED_PRECONDITION', key: 'error.fn.notAllowed' });
    expect(await readDoc(env, 'users/leftoverAdmin')).toBeUndefined();
  });
});
