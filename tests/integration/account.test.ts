import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAdmin, call, clearAuth, createEnv, createUser, PROJECT_ID, readDoc, readWhere } from './helpers';

const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099'}`;
const FUNCTIONS = `http://127.0.0.1:5001/${PROJECT_ID}/europe-west1`;
const EXISTING = 'existing-owner';
const EXISTING_EMAIL = `${EXISTING}@test.local`;
const TAKEN = 'taken-store';

let env: RulesTestEnvironment;

/** The raw HTTP exchange an anonymous caller sees (status, headers that matter, exact body). */
async function publicCheck(data: unknown) {
  const res = await fetch(`${FUNCTIONS}/checkSignupAvailability`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  return { status: res.status, contentType: res.headers.get('content-type'), body: await res.text() };
}

async function signUp(email: string, password: string) {
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  return { ok: res.ok, json: (await res.json()) as { idToken?: string; localId?: string; error?: { message: string } } };
}

beforeAll(async () => {
  env = await createEnv();
  await env.clearFirestore();
  await clearAuth();
  await createUser({ uid: EXISTING, tenantId: EXISTING, role: 'owner' });
  await asAdmin(env, (fs) => setDoc(doc(fs, `storeSubdomains/${TAKEN}`), { tenantId: EXISTING }));
});
afterAll(async () => {
  await env?.cleanup();
});

describe('checkSignupAvailability (public)', () => {
  it('answers an existing and an unknown e-mail identically (status, headers, body)', async () => {
    const existing = await publicCheck({ subdomain: 'fresh-store', email: EXISTING_EMAIL });
    const unknown = await publicCheck({ subdomain: 'fresh-store', email: 'nobody-here@test.local' });
    const none = await publicCheck({ subdomain: 'fresh-store' });
    expect(existing).toEqual(unknown);
    expect(existing).toEqual(none);
    expect(JSON.parse(existing.body)).toEqual({ result: { subdomainAvailable: true } });
  });

  it('reports subdomain availability only', async () => {
    expect(JSON.parse((await publicCheck({ subdomain: TAKEN })).body)).toEqual({ result: { subdomainAvailable: false } });
    expect(JSON.parse((await publicCheck({ subdomain: 'fresh-store' })).body)).toEqual({ result: { subdomainAvailable: true } });
  });

  it('an invalid e-mail cannot be used as an oracle either (it is ignored, not validated)', async () => {
    const odd = await publicCheck({ subdomain: TAKEN, email: 'not-an-email' });
    const real = await publicCheck({ subdomain: TAKEN, email: EXISTING_EMAIL });
    expect(odd).toEqual(real);
  });

  it('a burst of probes yields one response per subdomain, whatever the e-mails', async () => {
    const emails = Array.from({ length: 15 }, (_, i) => (i % 3 === 0 ? EXISTING_EMAIL : `probe${i}@test.local`));
    const free = await Promise.all(emails.map((email) => publicCheck({ subdomain: 'fresh-store', email })));
    const taken = await Promise.all(emails.map((email) => publicCheck({ subdomain: TAKEN, email })));
    expect(new Set(free.map((r) => JSON.stringify(r))).size).toBe(1);
    expect(new Set(taken.map((r) => JSON.stringify(r))).size).toBe(1);
  });
});

describe('signup still rejects duplicates', () => {
  it('a second Auth account with the same e-mail is refused and creates nothing', async () => {
    const dup = await signUp(EXISTING_EMAIL, 'another-pass-1');
    expect(dup.ok).toBe(false);
    expect(dup.json.error?.message).toMatch(/EMAIL_EXISTS/);
    expect(await readWhere(env, 'users', 'email', EXISTING_EMAIL)).toHaveLength(0);
  });

  it('a new account cannot take an existing store subdomain', async () => {
    const fresh = await signUp('newcomer@test.local', 'newcomer-pass-1');
    expect(fresh.ok).toBe(true);
    const res = await call(fresh.json.idToken!, 'completeSignup', { fullName: 'New', storeName: 'New', subdomain: TAKEN, phone: '123456' });
    expect(res.error).toEqual({ status: 'ALREADY_EXISTS', key: 'error.subdomainTaken', params: {} });
    expect(await readDoc(env, `users/${fresh.json.localId}`)).toBeUndefined();
    expect((await readDoc(env, `storeSubdomains/${TAKEN}`))?.tenantId).toBe(EXISTING);
  });
});
