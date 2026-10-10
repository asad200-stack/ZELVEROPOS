import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, getDocs } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  asAdmin,
  callOk,
  clearAuth,
  createEnv,
  createUser,
  RATE,
  readDoc,
  seedTenant,
  T,
  tp,
  type SeedProfile,
} from './helpers';

let env: RulesTestEnvironment;
const tokens: Record<string, string> = {};
const STAFF: SeedProfile[] = [
  { uid: 'cashier', role: 'subUser', permissions: { canSell: true } },
  { uid: 'clerk', role: 'subUser', permissions: { canViewSales: true, canViewCustomers: true } },
  { uid: 'buyer', role: 'subUser', permissions: { canViewSuppliers: true, canManageCashDrawer: true } },
];

beforeAll(async () => {
  env = await createEnv();
  await clearAuth();
  tokens.owner = await createUser({ uid: T, tenantId: T, role: 'owner' });
  for (const s of STAFF) tokens[s.uid] = await createUser({ uid: s.uid, tenantId: T, role: 'subUser', perms: s.permissions });
});
afterAll(async () => {
  await env?.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await seedTenant(env, T, [{ uid: T, role: 'owner' }, ...STAFF]);
});

const count = async (col: string) => asAdmin(env, async (fs) => (await getDocs(collection(fs, tp(T, col)))).size);
const debt = async () => Number((await readDoc(env, tp(T, 'customers', 'c1')))?.debtUsdCents);
const drawer = async () => (await readDoc(env, tp(T, 'cashbox', 'summary'))) as { usdCents: number; lbp: number };

async function twice<R extends { duplicate?: boolean }>(name: string, data: Record<string, unknown>, token = tokens.clerk!) {
  const first = await callOk<R>(token, name, data);
  const again = await callOk<R>(token, name, data);
  return { first, again };
}

describe('non-checkout money mutations are idempotent on clientOperationId', () => {
  it('customer debt payment', async () => {
    const { first, again } = await twice('posPayDebt', {
      clientOperationId: 'payDebtOnce',
      customerId: 'c1',
      usdCents: 1_000,
      lbp: 0,
      rate: RATE,
      note: '',
    });
    expect(first.duplicate).toBe(false);
    expect(again.duplicate).toBe(true);
    expect(await debt()).toBe(2_000);
    expect(await count('customerLedger')).toBe(1);
    expect(await count('cashTransactions')).toBe(1);
    expect((await drawer()).usdCents).toBe(11_000);
  });

  it('deposit, withdrawal and expense', async () => {
    for (const type of ['deposit', 'withdrawal', 'expense'] as const) {
      await env.clearFirestore();
      await seedTenant(env, T, [{ uid: T, role: 'owner' }, ...STAFF]);
      const { again } = await twice(
        'posCashMove',
        { clientOperationId: `move-${type}`, type, usdCents: 500, lbp: 0, category: 'rent', note: '' },
        tokens.buyer!,
      );
      expect(again.duplicate).toBe(true);
      expect(await count('cashTransactions')).toBe(1);
    }
  });

  it('supplier payment', async () => {
    await callOk(tokens.buyer!, 'posCreatePurchase', {
      clientOperationId: 'bill1',
      supplierId: 'sup1',
      date: '2026-10-09',
      dueDate: null,
      items: [{ productId: 'p1', quantity: 2, unitCostUsdCents: 100 }],
      updateCost: false,
      paidNowUsdCents: 0,
      payFromCashbox: false,
      note: '',
    });
    const { again } = await twice(
      'posPaySupplier',
      { clientOperationId: 'supPay1', supplierId: 'sup1', currency: 'USD', amount: 100, rate: RATE, method: 'cash', note: '' },
      tokens.buyer!,
    );
    expect(again.duplicate).toBe(true);
    expect(await count('supplierPayments')).toBe(1);
    expect(Number((await readDoc(env, tp(T, 'suppliers', 'sup1')))?.balanceUsdCents)).toBe(100);
  });

  it('same-id retry recovers after the cashier is disabled', async () => {
    const data = { clientOperationId: 'payThenDisable', customerId: 'c1', usdCents: 500, lbp: 0, rate: RATE, note: '' };
    await callOk(tokens.clerk!, 'posPayDebt', data);
    await asAdmin(env, async (fs) => {
      const { updateDoc, doc } = await import('firebase/firestore');
      await updateDoc(doc(fs, 'users/clerk'), { isActive: false });
    });
    const again = await callOk<{ duplicate: boolean }>(tokens.clerk!, 'posPayDebt', data);
    expect(again.duplicate).toBe(true);
    expect(await debt()).toBe(2_500);
    expect(await count('customerLedger')).toBe(1);
  });
});
