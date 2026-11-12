import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAdmin, call, callOk, clearAuth, clearFirestore, createEnv, createUser, DAY, RATE, readDoc } from './helpers';

const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099'}`;
const UID = 'access-owner';
const LIFETIME_UNTIL = 4_102_444_800_000;

let env: RulesTestEnvironment;
let token: string;

async function lookupClaims(): Promise<{ subUntil?: number }> {
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:lookup`, {
    method: 'POST',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: [UID] }),
  });
  const json = (await res.json()) as { users?: Array<{ customAttributes?: string }> };
  const raw = json.users?.[0]?.customAttributes;
  if (!raw) throw new Error(`auth lookup failed: ${JSON.stringify(json)}`);
  return JSON.parse(raw) as { subUntil?: number };
}

async function setSubscription(data: Record<string, unknown>): Promise<void> {
  await asAdmin(env, (fs) => setDoc(doc(fs, `subscriptions/${UID}`), data));
}

async function serverUntil(data: Record<string, unknown>): Promise<number> {
  await setSubscription(data);
  await callOk(token, 'refreshMyClaims', {});
  const claims = await lookupClaims();
  return claims.subUntil ?? -1;
}

describe('server subscription write access', () => {
  beforeAll(async () => {
    env = await createEnv();
    await clearFirestore(env);
    await clearAuth();
    const future = Date.now() + 30 * DAY;
    await asAdmin(env, async (fs) => {
      await setDoc(doc(fs, `users/${UID}`), {
        uid: UID,
        role: 'owner',
        tenantId: UID,
        isActive: true,
        fullName: UID,
        permissions: {},
        claimsVersion: 1,
      });
      await setDoc(doc(fs, `tenants/${UID}/settings/main`), { storeName: 'Access', exchangeRate: RATE, updatedAt: Timestamp.now() });
      await setDoc(doc(fs, `tenants/${UID}/counters/sales`), { nextId: 5 });
      await setDoc(doc(fs, `tenants/${UID}/cashbox/summary`), { usdCents: 10_000, lbp: 0, lastTxId: null });
      await setDoc(doc(fs, `tenants/${UID}/products/p1`), {
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
    token = await createUser({ uid: UID, tenantId: UID, role: 'owner' });
    expect(future).toBeGreaterThan(Date.now());
  });

  afterAll(async () => {
    await env?.cleanup();
  });

  it('grants a future trial and a future paid plan, and denies a past end', async () => {
    const future = Date.now() + 5 * DAY;
    const past = Date.now() - DAY;
    expect(await serverUntil({
      activated: true,
      lifetime: false,
      trial: true,
      status: 'trial',
      endsAt: Timestamp.fromMillis(future),
    })).toBe(future);
    expect(await serverUntil({
      activated: true,
      lifetime: false,
      trial: false,
      status: 'active',
      endsAt: Timestamp.fromMillis(future),
    })).toBe(future);
    expect(await serverUntil({
      activated: true,
      lifetime: false,
      trial: true,
      status: 'trial',
      endsAt: Timestamp.fromMillis(past),
    })).toBe(0);
    expect(await serverUntil({
      activated: true,
      lifetime: false,
      trial: false,
      status: 'active',
      endsAt: Timestamp.fromMillis(past),
    })).toBe(0);
  });

  it('keeps an activated pending_activation record writable and denies every closed status with a future end', async () => {
    const future = Date.now() + 9 * DAY;
    expect(await serverUntil({
      activated: true,
      lifetime: false,
      trial: false,
      status: 'pending_activation',
      endsAt: Timestamp.fromMillis(future),
    })).toBe(future);

    for (const status of ['trial_expired', 'expired', 'inactive', 'canceled', 'cancelled']) {
      expect(await serverUntil({
        activated: true,
        lifetime: false,
        trial: status === 'trial_expired',
        status,
        endsAt: Timestamp.fromMillis(future),
      }), status).toBe(0);
    }
  });

  it('denies activation with no end date and grants an explicit lifetime entitlement', async () => {
    expect(await serverUntil({
      activated: true,
      lifetime: false,
      trial: false,
      status: null,
      endsAt: null,
    })).toBe(0);
    expect(await serverUntil({
      activated: true,
      lifetime: true,
      trial: false,
      status: null,
      endsAt: null,
    })).toBe(LIFETIME_UNTIL);
    expect(await serverUntil({
      activated: true,
      lifetime: true,
      trial: false,
      status: 'canceled',
      endsAt: null,
    })).toBe(0);
  });

  it('blocks checkout for a closed future end and allows it after an activated pending plan', async () => {
    const future = Date.now() + 12 * DAY;
    await setSubscription({
      activated: true,
      lifetime: false,
      trial: false,
      status: 'expired',
      endsAt: Timestamp.fromMillis(future),
    });
    const denied = await call(token, 'posCheckout', {
      saleId: 'access-closed-future',
      kind: 'cash',
      currency: 'USD',
      rate: RATE,
      customerId: null,
      debtLineUsdCents: null,
      lines: [{ productId: 'p1', tier: 'retail', quantity: 1, customUsdCents: null, imei: null }],
      expectedTotalUsdCents: 500,
      cash: { receivedUsdCents: 500, receivedLbp: 0 },
    });
    expect(denied.error?.key).toBe('error.fn.subscriptionInactive');
    expect(await readDoc(env, `tenants/${UID}/sales/access-closed-future`)).toBeUndefined();

    await setSubscription({
      activated: true,
      lifetime: false,
      trial: false,
      status: 'pending_activation',
      endsAt: Timestamp.fromMillis(future),
    });
    const sold = await callOk<{ sale: { id?: string } }>(token, 'posCheckout', {
      saleId: 'access-pending-open',
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
  });
});
