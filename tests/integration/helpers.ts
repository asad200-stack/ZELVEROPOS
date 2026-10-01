import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, collection, query, where, setDoc, Timestamp, type Firestore } from 'firebase/firestore';

export const PROJECT_ID = 'demo-zelvero';
export const T = 'tenantA';
export const OTHER = 'tenantB';
export const DAY = 86_400_000;
export const RATE = 89_500;

const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099'}`;
const FUNCTIONS = 'http://127.0.0.1:5001';
const PASSWORD = 'integration-pass-1';

export async function createEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8') },
  });
}

/** Reads and writes with rules disabled (the test's "admin" view of the database). */
export async function asAdmin<R>(env: RulesTestEnvironment, fn: (fs: Firestore) => Promise<R>): Promise<R> {
  let out!: R;
  await env.withSecurityRulesDisabled(async (ctx) => {
    out = await fn(ctx.firestore() as unknown as Firestore);
  });
  return out;
}

export const tp = (t: string, ...segments: string[]) => ['tenants', t, ...segments].join('/');

export async function readDoc(env: RulesTestEnvironment, path: string) {
  return asAdmin(env, async (fs) => (await getDoc(doc(fs, path))).data());
}

export async function readWhere(env: RulesTestEnvironment, col: string, field: string, value: unknown) {
  return asAdmin(env, async (fs) => (await getDocs(query(collection(fs, col), where(field, '==', value)))).docs.map((d) => d.data()));
}

/* ------------------------------------------------------------------ auth */

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

export interface TestUser {
  uid: string;
  tenantId: string;
  role: 'owner' | 'subUser';
  perms?: Record<string, boolean>;
  active?: boolean;
}

/** Creates an Auth emulator user with custom claims (as syncUserClaims would) and returns an ID token. */
export async function createUser(u: TestUser): Promise<string> {
  const email = `${u.uid.toLowerCase()}@test.local`;
  await authPost(`projects/${PROJECT_ID}/accounts`, { localId: u.uid, email, password: PASSWORD, emailVerified: true }, true);
  const claims = {
    tenantId: u.tenantId,
    role: u.role,
    active: u.active ?? true,
    subUntil: Date.now() + 30 * DAY,
    cv: 1,
    ...(u.role === 'subUser' ? { perms: Object.fromEntries(Object.entries(u.perms ?? {}).filter(([, v]) => v)) } : {}),
  };
  await authPost(`projects/${PROJECT_ID}/accounts:update`, { localId: u.uid, customAttributes: JSON.stringify(claims), emailVerified: true }, true);
  const signIn = await authPost('accounts:signInWithPassword', { email, password: PASSWORD, returnSecureToken: true });
  return String(signIn.idToken);
}

export async function clearAuth(): Promise<void> {
  await fetch(`${AUTH}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: 'DELETE' });
}

/* ------------------------------------------------------------- callables */

export interface CallError {
  status: string;
  key?: string;
  params?: Record<string, unknown>;
}

export async function call<R = Record<string, unknown>>(token: string, name: string, data: unknown): Promise<{ result?: R; error?: CallError }> {
  const res = await fetch(`${FUNCTIONS}/${PROJECT_ID}/us-central1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ data }),
  });
  const json = (await res.json()) as { result?: R; error?: { status: string; message: string; details?: { key?: string; params?: Record<string, unknown> } } };
  if (json.error) return { error: { status: json.error.status, key: json.error.details?.key ?? json.error.message, params: json.error.details?.params } };
  return { result: json.result };
}

export async function callOk<R = Record<string, unknown>>(token: string, name: string, data: unknown): Promise<R> {
  const { result, error } = await call<R>(token, name, data);
  if (error) throw new Error(`${name} failed: ${error.status} ${error.key} ${JSON.stringify(error.params ?? {})}`);
  return result as R;
}

/* ------------------------------------------------------------------ seed */

export interface SeedProfile {
  uid: string;
  role: 'owner' | 'subUser';
  permissions?: Record<string, boolean>;
  isActive?: boolean;
}

export async function seedTenant(env: RulesTestEnvironment, t: string, profiles: SeedProfile[], opts: { subscriptionEndsAt?: number } = {}) {
  await asAdmin(env, async (fs) => {
    const now = Timestamp.now();
    for (const p of profiles) {
      await setDoc(doc(fs, `users/${p.uid}`), {
        uid: p.uid,
        role: p.role,
        tenantId: t,
        isActive: p.isActive ?? true,
        fullName: p.uid,
        permissions: p.permissions ?? {},
        claimsVersion: 1,
      });
    }
    await setDoc(doc(fs, `subscriptions/${t}`), {
      activated: true,
      lifetime: false,
      endsAt: Timestamp.fromMillis(opts.subscriptionEndsAt ?? Date.now() + 30 * DAY),
    });
    await setDoc(doc(fs, tp(t, 'settings', 'main')), { storeName: 'Store', exchangeRate: RATE, updatedAt: now });
    await setDoc(doc(fs, tp(t, 'counters', 'sales')), { nextId: 5 });
    await setDoc(doc(fs, tp(t, 'cashbox', 'summary')), { usdCents: 10_000, lbp: 0, lastTxId: null });
    const product = (name: string, retail: number, stock: number, extra: Record<string, unknown> = {}) => ({
      name,
      category: 'Accessories',
      barcode: '',
      prices: { retail: { usdCents: retail, lbp: null }, wholesale: { usdCents: 0, lbp: null }, vip: { usdCents: 0, lbp: null } },
      costUsdCents: 200,
      stock,
      minStock: null,
      supplierId: null,
      supplierName: '',
      expiryDate: null,
      imeiTracking: false,
      imeis: [],
      imageUrl: null,
      imagePath: null,
      lastMovementId: null,
      createdAt: now,
      createdAtMs: Date.now(),
      createdBy: t,
      ...extra,
    });
    await setDoc(doc(fs, tp(t, 'products', 'p1')), product('Phone case', 500, 10));
    await setDoc(
      doc(fs, tp(t, 'products', 'ph')),
      product('Phone', 20_000, 2, {
        imeiTracking: true,
        imeis: [
          { imei: '111', status: 'available' },
          { imei: '222', status: 'available' },
        ],
      }),
    );
    await setDoc(doc(fs, tp(t, 'customers', 'c1')), {
      name: 'Ali',
      phone: '',
      email: '',
      address: '',
      creditLimitUsdCents: 10_000,
      debtUsdCents: 3_000,
      totalPurchasesUsdCents: 0,
      lastLedgerId: null,
      createdAt: now,
      createdAtMs: Date.now(),
      createdBy: t,
    });
    await setDoc(doc(fs, tp(t, 'suppliers', 'sup1')), {
      name: 'Supplier',
      contactPerson: '',
      phone: '',
      email: '',
      address: '',
      balanceUsdCents: 0,
      createdAt: now,
      createdAtMs: Date.now(),
      createdBy: t,
    });
  });
}
