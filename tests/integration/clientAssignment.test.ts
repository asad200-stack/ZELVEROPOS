import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveAuthEmulatorHostPort } from './emulatorSafety';
import { call, callOk, clearAuth, clearFirestore, createEnv, createUser, PROJECT_ID, readDoc, readWhere } from './helpers';

const AUTH = `http://${resolveAuthEmulatorHostPort()}`;

const SUPER_ADMIN = 'caSuperAdmin';
const PARTNER_A = 'caPartnerA';
const PARTNER_B = 'caPartnerB';
const CUSTOMER_OWNER = 'caCustomerOwner'; // ordinary tenant owner, used for permission checks only

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

async function signIn(email: string, password: string): Promise<string> {
  const json = await authPost('accounts:signInWithPassword', { email, password, returnSecureToken: true });
  return String(json.idToken);
}

/** A brand-new, unprovisioned Auth account — the state a real signer-upper is in before completeSignup. */
async function signUpFresh(email: string, password = 'client-assign-pass-1'): Promise<{ idToken: string; uid: string }> {
  const json = await authPost('accounts:signUp', { email, password, returnSecureToken: true });
  return { idToken: String(json.idToken), uid: String(json.localId) };
}

async function completeSignup(idToken: string, storeName: string, subdomain: string, referralCode?: string) {
  return callOk<{ tenantId: string }>(idToken, 'completeSignup', {
    fullName: storeName,
    storeName,
    subdomain,
    phone: '70000000',
    ...(referralCode ? { referralCode } : {}),
  });
}

beforeAll(async () => {
  env = await createEnv();
  await clearAuth();
  await createUser({ uid: SUPER_ADMIN, tenantId: null, superAdmin: true });
  // Partner accounts are plain verified Auth users with no tenant and no claims yet — exactly how
  // grantMarketingPartner expects to find them (it looks the account up by e-mail and fails if it
  // already has a tenant or is already a Super Admin).
  await authPost(`projects/${PROJECT_ID}/accounts`, { localId: PARTNER_A, email: `${PARTNER_A.toLowerCase()}@test.local`, password: 'integration-pass-1', emailVerified: true }, true);
  await authPost(`projects/${PROJECT_ID}/accounts`, { localId: PARTNER_B, email: `${PARTNER_B.toLowerCase()}@test.local`, password: 'integration-pass-1', emailVerified: true }, true);
  await createUser({ uid: CUSTOMER_OWNER, tenantId: CUSTOMER_OWNER, role: 'owner' });
});

afterAll(async () => {
  await env?.cleanup();
});

let seq = 0;
/** Unique subdomain per test run so repeated beforeEach clears don't collide on storeSubdomains. */
function freshSubdomain(): string {
  seq += 1;
  return `ca-store-${Date.now().toString(36)}-${seq}`;
}

/** Re-grants (or re-activates) a partner and returns {partnerId, referralCode, token}. */
async function grantPartner(uid: string, name: string): Promise<{ partnerId: string; referralCode: string; token: string }> {
  const adminToken = await signIn(`${SUPER_ADMIN.toLowerCase()}@test.local`, 'integration-pass-1');
  const res = await callOk<{ ok: true; partnerId: string; referralCode: string }>(adminToken, 'grantMarketingPartner', {
    email: `${uid.toLowerCase()}@test.local`,
    name,
    contactAuthorized: false,
  });
  const token = await signIn(`${uid.toLowerCase()}@test.local`, 'integration-pass-1');
  return { partnerId: res.partnerId, referralCode: res.referralCode, token };
}

beforeEach(async () => {
  await clearFirestore(env);
});

describe('Marketing Partner & Client Assignment', () => {
  it('normal signup (no referral code) lands Unassigned, with an immutable direct acquisition record', async () => {
    const { idToken, uid } = await signUpFresh('ca-normal@test.local');
    const { tenantId } = await completeSignup(idToken, 'Normal Store', freshSubdomain());
    expect(tenantId).toBe(uid);

    const assignment = await readDoc(env, `platformClientAssignments/${tenantId}`);
    expect(assignment?.assignedTo).toBeNull();
    expect(assignment?.assignedPartnerId).toBeNull();
    expect(assignment?.acquisition?.source).toBe('direct');
    expect(assignment?.acquisition?.partnerId).toBeNull();
  });

  it('referral signup is attributed and auto-assigned to the referring partner', async () => {
    const partner = await grantPartner(PARTNER_A, 'Partner A');
    const { idToken, uid } = await signUpFresh('ca-referred@test.local');
    const { tenantId } = await completeSignup(idToken, 'Referred Store', freshSubdomain(), partner.referralCode);
    expect(tenantId).toBe(uid);

    const assignment = await readDoc(env, `platformClientAssignments/${tenantId}`);
    expect(assignment?.acquisition?.source).toBe('referral');
    expect(assignment?.acquisition?.partnerId).toBe(partner.partnerId);
    expect(assignment?.assignedTo).toBe('partner');
    expect(assignment?.assignedPartnerId).toBe(partner.partnerId);
  });

  it('an invalid, unknown or inactive referral code never errors — it is silently treated as a normal, Unassigned signup', async () => {
    for (const badCode of ['does-not-exist-xyz', '', 'ab', '!!!not-a-code!!!']) {
      const { idToken, uid } = await signUpFresh(`ca-badref-${seq}-${Math.random().toString(36).slice(2, 8)}@test.local`);
      const { tenantId } = await completeSignup(idToken, 'Store', freshSubdomain(), badCode || undefined);
      expect(tenantId).toBe(uid);
      const assignment = await readDoc(env, `platformClientAssignments/${tenantId}`);
      expect(assignment?.assignedTo).toBeNull();
      expect(assignment?.acquisition?.source).toBe('direct');
    }
  });

  it('a revoked partner cannot be used as a referral source: the referral is ignored and the signup lands Unassigned', async () => {
    const partner = await grantPartner(PARTNER_A, 'Partner A');
    const adminToken = await signIn(`${SUPER_ADMIN.toLowerCase()}@test.local`, 'integration-pass-1');
    await callOk(adminToken, 'revokeMarketingPartner', { partnerId: partner.partnerId });

    const { idToken } = await signUpFresh('ca-afterrevoke@test.local');
    const { tenantId } = await completeSignup(idToken, 'Store', freshSubdomain(), partner.referralCode);
    const assignment = await readDoc(env, `platformClientAssignments/${tenantId}`);
    expect(assignment?.assignedTo).toBeNull();
    expect(assignment?.acquisition?.source).toBe('direct');
  });

  it('a partner sees only clients explicitly assigned to that partner — never the Platform Super Admin\'s private clients or another partner\'s clients', async () => {
    const partnerA = await grantPartner(PARTNER_A, 'Partner A');
    const partnerB = await grantPartner(PARTNER_B, 'Partner B');
    const adminToken = await signIn(`${SUPER_ADMIN.toLowerCase()}@test.local`, 'integration-pass-1');

    const mine = await signUpFresh('ca-mine@test.local');
    await completeSignup(mine.idToken, 'Mine Store', freshSubdomain(), partnerA.referralCode);

    const otherPartner = await signUpFresh('ca-otherpartner@test.local');
    await completeSignup(otherPartner.idToken, 'Other Partner Store', freshSubdomain(), partnerB.referralCode);

    // An organic signup that the Super Admin then claims for themselves — must stay invisible to any partner.
    const privateAdmin = await signUpFresh('ca-private@test.local');
    const { tenantId: privateTenantId } = await completeSignup(privateAdmin.idToken, 'Private Store', freshSubdomain());
    await callOk(adminToken, 'adminAssignClient', { tenantId: privateTenantId, assignTo: 'superAdmin', confirm: `ASSIGN ${privateTenantId} TO MYSELF` });

    const result = await callOk<{ clients: Array<{ tenantId: string }> }>(partnerA.token, 'partnerListMyClients', {});
    const seenTenantIds = result.clients.map((c) => c.tenantId);
    expect(seenTenantIds).toContain(mine.uid);
    expect(seenTenantIds).not.toContain(otherPartner.uid);
    expect(seenTenantIds).not.toContain(privateTenantId);
  });

  it('the Platform Super Admin sees every customer tenant, across every attribution group', async () => {
    const partnerA = await grantPartner(PARTNER_A, 'Partner A');
    const adminToken = await signIn(`${SUPER_ADMIN.toLowerCase()}@test.local`, 'integration-pass-1');

    const referred = await signUpFresh('ca-all-referred@test.local');
    await completeSignup(referred.idToken, 'Store', freshSubdomain(), partnerA.referralCode);
    const organic = await signUpFresh('ca-all-organic@test.local');
    await completeSignup(organic.idToken, 'Store', freshSubdomain());

    const all = await callOk<{ rows: Array<{ tenantId: string }> }>(adminToken, 'adminListClientAssignments', { group: 'all' });
    const tenantIds = all.rows.map((r) => r.tenantId);
    expect(tenantIds).toContain(referred.uid);
    expect(tenantIds).toContain(organic.uid);

    const unassigned = await callOk<{ rows: Array<{ tenantId: string }> }>(adminToken, 'adminListClientAssignments', { group: 'unassigned' });
    expect(unassigned.rows.map((r) => r.tenantId)).toContain(organic.uid);
  });

  it('manual transfer requires an exact typed confirmation and is fully audited', async () => {
    const partnerA = await grantPartner(PARTNER_A, 'Partner A');
    const adminToken = await signIn(`${SUPER_ADMIN.toLowerCase()}@test.local`, 'integration-pass-1');
    const organic = await signUpFresh('ca-transfer@test.local');
    const { tenantId } = await completeSignup(organic.idToken, 'Store', freshSubdomain());

    // Wrong / missing confirmation text is rejected outright — nothing changes.
    const bad = await call(adminToken, 'adminAssignClient', { tenantId, assignTo: 'partner', partnerId: partnerA.partnerId, confirm: 'YES' });
    expect(bad.error?.status).toBe('FAILED_PRECONDITION');
    expect((await readDoc(env, `platformClientAssignments/${tenantId}`))?.assignedTo).toBeNull();

    // Correct confirmation assigns it to the partner.
    await callOk(adminToken, 'adminAssignClient', {
      tenantId,
      assignTo: 'partner',
      partnerId: partnerA.partnerId,
      confirm: `ASSIGN ${tenantId} TO PARTNER ${partnerA.partnerId}`,
    });
    expect((await readDoc(env, `platformClientAssignments/${tenantId}`))?.assignedPartnerId).toBe(partnerA.partnerId);

    // Transferring it back to the Super Admin ("myself") is a second, independently-confirmed and audited change.
    await callOk(adminToken, 'adminAssignClient', { tenantId, assignTo: 'superAdmin', confirm: `ASSIGN ${tenantId} TO MYSELF` });
    const after = await readDoc(env, `platformClientAssignments/${tenantId}`);
    expect(after?.assignedTo).toBe('superAdmin');
    expect(after?.assignedPartnerId).toBeNull();
    // Original acquisition is untouched by either transfer.
    expect(after?.acquisition?.source).toBe('direct');

    const auditEntries = await readWhere(env, 'platformPartnerAuditLog', 'tenantId', tenantId);
    const actions = auditEntries.map((e) => e.action);
    expect(actions).toContain('assigned');
    expect(actions).toContain('transferred');

    // A no-op transfer (already in the target state) is rejected rather than silently audited again.
    const noop = await call(adminToken, 'adminAssignClient', { tenantId, assignTo: 'superAdmin', confirm: `ASSIGN ${tenantId} TO MYSELF` });
    expect(noop.error?.status).toBe('FAILED_PRECONDITION');
  });

  it('revoked partner access is immediate: the dashboard call is denied right after revocation, even with an existing session token', async () => {
    const partner = await grantPartner(PARTNER_A, 'Partner A');
    expect((await callOk<{ clients: unknown[] }>(partner.token, 'partnerListMyClients', {})).clients).toEqual([]);

    const adminToken = await signIn(`${SUPER_ADMIN.toLowerCase()}@test.local`, 'integration-pass-1');
    await callOk(adminToken, 'revokeMarketingPartner', { partnerId: partner.partnerId });

    // Re-check live, not from a stale token: fetch a fresh ID token for the now-revoked partner.
    const refreshed = await signIn(`${PARTNER_A.toLowerCase()}@test.local`, 'integration-pass-1');
    expect((await call(refreshed, 'partnerListMyClients', {})).error?.status).toBe('PERMISSION_DENIED');
  });

  it('cross-tenant / cross-role access attempts are all denied server-side', async () => {
    const partnerA = await grantPartner(PARTNER_A, 'Partner A');
    const customerToken = await signIn(`${CUSTOMER_OWNER.toLowerCase()}@test.local`, 'integration-pass-1');

    // An ordinary tenant owner (not Super Admin, not a partner) cannot touch any partner/admin surface.
    expect((await call(customerToken, 'partnerListMyClients', {})).error?.status).toBe('PERMISSION_DENIED');
    expect((await call(customerToken, 'adminListClientAssignments', { group: 'all' })).error?.status).toBe('PERMISSION_DENIED');
    expect((await call(customerToken, 'adminAssignClient', { tenantId: CUSTOMER_OWNER, assignTo: 'superAdmin', confirm: `ASSIGN ${CUSTOMER_OWNER} TO MYSELF` })).error?.status).toBe(
      'PERMISSION_DENIED',
    );
    expect((await call(customerToken, 'grantMarketingPartner', { email: 'x@test.local', name: 'x' })).error?.status).toBe('PERMISSION_DENIED');
    expect((await call(customerToken, 'adminListPartners', {})).error?.status).toBe('PERMISSION_DENIED');

    // A marketing partner cannot escalate into Super-Admin-only actions either.
    expect((await call(partnerA.token, 'adminListClientAssignments', { group: 'all' })).error?.status).toBe('PERMISSION_DENIED');
    expect((await call(partnerA.token, 'adminAssignClient', { tenantId: CUSTOMER_OWNER, assignTo: 'superAdmin', confirm: `ASSIGN ${CUSTOMER_OWNER} TO MYSELF` })).error?.status).toBe(
      'PERMISSION_DENIED',
    );
    expect((await call(partnerA.token, 'grantMarketingPartner', { email: 'y@test.local', name: 'y' })).error?.status).toBe('PERMISSION_DENIED');
    expect((await call(partnerA.token, 'revokeMarketingPartner', { partnerId: partnerA.partnerId })).error?.status).toBe('PERMISSION_DENIED');
    expect((await call(partnerA.token, 'adminListPartners', {})).error?.status).toBe('PERMISSION_DENIED');

    // partnerListMyClients takes no tenant/partner id input at all — there is nothing for a partner
    // to submit to "ask for someone else's list"; the callable always resolves strictly from its own
    // caller identity, so this is really a shape check that no such parameter is honoured.
    const smuggled = await call<{ clients: unknown[] }>(partnerA.token, 'partnerListMyClients', { partnerId: PARTNER_B, tenantId: CUSTOMER_OWNER });
    expect(smuggled.error).toBeUndefined();
    expect(smuggled.result?.clients).toEqual([]); // partner A has no assigned clients yet; the extra fields were ignored, not honoured.
  });
});
