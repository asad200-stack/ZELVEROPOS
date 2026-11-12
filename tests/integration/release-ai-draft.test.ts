import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, getDocs } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveAuthEmulatorHostPort } from './emulatorSafety';
import { asAdmin, call, callOk, clearAuth, clearFirestore, createEnv, createUser, PROJECT_ID, seedTenant } from './helpers';

const AUTH = `http://${resolveAuthEmulatorHostPort()}`;
const PASSWORD = 'integration-pass-1';
const ADMIN = 'releaseAdmin';
const CUSTOMER = 'releaseCustomer';

const def = JSON.parse(readFileSync(new URL('../../releases/ai-1.0.json', import.meta.url), 'utf8')) as {
  label: string;
  version: string;
  title: string;
  releaseType: 'patch' | 'minor' | 'major';
  buildId: string;
  notes: string;
};

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
  return String((await authPost('accounts:signInWithPassword', { email: `${uid.toLowerCase()}@test.local`, password: PASSWORD, returnSecureToken: true })).idToken);
}

beforeAll(async () => {
  env = await createEnv();
  await clearAuth();
  await authPost(`projects/${PROJECT_ID}/accounts`, { localId: ADMIN, email: `${ADMIN.toLowerCase()}@test.local`, password: PASSWORD, emailVerified: true }, true);
  await authPost(`projects/${PROJECT_ID}/accounts:update`, { localId: ADMIN, customAttributes: JSON.stringify({ superAdmin: true }), emailVerified: true }, true);
  await createUser({ uid: CUSTOMER, tenantId: CUSTOMER, role: 'owner' });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await clearFirestore(env);
  await seedTenant(env, CUSTOMER, [{ uid: CUSTOMER, role: 'owner' }]);
});

describe('AI-1.0 draft release definition', () => {
  it('is accepted by createRelease as a draft and listed by its title, with no store assigned', async () => {
    expect(def.label).toBe('AI-1.0');
    expect(def.title).toBe('Zelvero AI — Intelligent Business Copilot');
    const admin = await signIn(ADMIN);
    await callOk(admin, 'createRelease', { version: def.version, title: def.title, notes: def.notes, releaseType: def.releaseType, buildId: def.buildId });
    const listed = await callOk<{ releases: Array<{ version: string; title: string; status: string; targetType: string; targetTenantIds: string[] }> }>(admin, 'listReleases', {});
    const release = listed.releases.find((r) => r.title === def.title);
    expect(release).toMatchObject({ version: def.version, status: 'draft' });
    expect(release?.targetTenantIds ?? []).toEqual([]);
    const assignments = await asAdmin(env, async (fs) => (await getDocs(collection(fs, 'platformReleaseAssignments'))).size);
    expect(assignments).toBe(0);
  });

  it('cannot be created by a customer account', async () => {
    const customer = await signIn(CUSTOMER);
    const res = await call(customer, 'createRelease', { version: def.version, title: def.title, notes: def.notes, releaseType: def.releaseType, buildId: def.buildId });
    expect(res.error?.status).toBe('PERMISSION_DENIED');
  });
});
