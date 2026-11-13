import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, serverTimestamp, setDoc, Timestamp, type Firestore } from 'firebase/firestore';

export const PROJECT_ID = 'demo-zelvero';
export const T = 'tenantA';
export const OTHER = 'tenantB';
export const DAY = 86_400_000;

export async function createEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8') },
    storage: { rules: readFileSync(resolve(process.cwd(), 'storage.rules'), 'utf8') },
  });
}

type Perms = Partial<Record<string, boolean>>;

export interface ClaimOptions {
  /** null means a pure platform account with no tenant membership at all (e.g. a marketing partner). */
  tenantId?: string | null;
  role?: 'owner' | 'subUser';
  perms?: Perms;
  active?: boolean;
  subUntil?: number;
  emailVerified?: boolean;
  superAdmin?: boolean;
  /** Platform marketing-partner claim. Pass with no tenantId for a "pure" partner (the real shape — a partner owns no tenant). */
  marketingPartner?: boolean;
}

export function claims(o: ClaimOptions = {}) {
  const role = o.role ?? 'owner';
  const base: Record<string, unknown> = { email_verified: o.emailVerified ?? true };
  if (o.tenantId !== null) {
    Object.assign(base, {
      tenantId: o.tenantId ?? T,
      role,
      active: o.active ?? true,
      subUntil: o.subUntil ?? Date.now() + 30 * DAY,
      cv: 1,
      ...(role === 'subUser' ? { perms: o.perms ?? {} } : {}),
    });
  }
  if (o.superAdmin) base.superAdmin = true;
  if (o.marketingPartner) base.marketingPartner = true;
  return base;
}

export function db(env: RulesTestEnvironment, uid: string, o: ClaimOptions = {}): Firestore {
  return env.authenticatedContext(uid, claims(o)).firestore() as unknown as Firestore;
}

export const tp = (t: string, ...segments: string[]) => ['tenants', t, ...segments].join('/');

export function audit(uid: string) {
  const now = new Date();
  return {
    createdAt: serverTimestamp(),
    createdAtMs: now.getTime(),
    localDate: now.toISOString().slice(0, 10),
    createdBy: uid,
    createdByName: uid,
  };
}

/** Seeds a tenant the way completeSignup does, plus one product and one customer. */
export async function seedTenant(env: RulesTestEnvironment, t = T) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore() as unknown as Firestore;
    const now = Timestamp.now();
    await setDoc(doc(fs, `users/${t}`), { uid: t, role: 'owner', tenantId: t, isActive: true, fullName: 'Owner', claimsVersion: 1 });
    for (const uid of ['cashier', 'editor', 'clerk', 'buyer', 'rep', 'deleter', 'staff']) {
      await setDoc(doc(fs, `users/${uid}`), { uid, role: 'subUser', tenantId: t, isActive: true, fullName: uid, claimsVersion: 1 });
    }
    await setDoc(doc(fs, `subscriptions/${t}`), { activated: true, lifetime: false, endsAt: Timestamp.fromMillis(Date.now() + 30 * DAY) });
    await setDoc(doc(fs, tp(t, 'settings', 'main')), { storeName: 'Store', updatedAt: now });
    await setDoc(doc(fs, tp(t, 'private', 'telegram')), { botToken: 'secret', chatId: '123' });
    await setDoc(doc(fs, tp(t, 'counters', 'sales')), { nextId: 5 });
    await setDoc(doc(fs, tp(t, 'counters', 'purchases')), { nextId: 1 });
    await setDoc(doc(fs, tp(t, 'cashbox', 'summary')), { usdCents: 10_000, lbp: 0, lastTxId: 'seed', updatedAt: now });
    await setDoc(doc(fs, tp(t, 'products', 'p1')), {
      name: 'Phone case',
      category: 'Accessories',
      barcode: '111',
      prices: { retail: { usdCents: 500, lbp: null } },
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
      createdAt: now,
      createdAtMs: Date.now(),
      createdBy: t,
    });
    await setDoc(doc(fs, tp(t, 'customers', 'c1')), {
      name: 'Ali',
      phone: '',
      email: '',
      address: '',
      creditLimitUsdCents: 0,
      debtUsdCents: 3_000,
      totalPurchasesUsdCents: 0,
      lastLedgerId: 'seedLedger',
      createdAt: now,
      createdAtMs: Date.now(),
      createdBy: t,
    });
  });
}
