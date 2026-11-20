import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  grantedOnly as clientGrantedOnly,
  mergePermissionPatch as clientMerge,
  normalizePermissions as clientNormalize,
  PERMISSION_KEYS as CLIENT_KEYS,
} from '../../src/constants/permissions';
import { cashMessage, crossedLowStock, formatDate, lowStockMessage, onlineOrderMessage, saleMessage } from '../../functions/src/telegram/format';

const sharedPerms = resolve(__dirname, '../../functions/src/shared/permissions.ts');
if (!existsSync(sharedPerms)) {
  execFileSync(process.execPath, [resolve(__dirname, '../../functions/scripts/copy-shared.mjs')], {
    stdio: 'inherit',
  });
}

const {
  grantedOnly,
  mergePermissionPatch: serverMerge,
  normalizePermissions: serverNormalize,
  PERMISSION_KEYS: SERVER_KEYS,
} = await import('../../functions/src/permissions');

describe('permission keys stay in sync between client and Cloud Functions', () => {
  it('has identical keys and normalization including canUseZelveroAI', () => {
    expect([...SERVER_KEYS]).toEqual([...CLIENT_KEYS]);
    expect(SERVER_KEYS).toContain('canUseZelveroAI');
    const input = { canSell: true, canAddProducts: true, canEditSettings: true, canUseZelveroAI: true, bogus: true };
    expect(serverNormalize(input)).toEqual(clientNormalize(input));
    expect(grantedOnly(serverNormalize({ canSell: true, canViewProducts: true, canAddProducts: true }))).toEqual({
      canSell: true,
      canViewProducts: true,
      canAddProducts: true,
    });
    expect(clientGrantedOnly(clientNormalize({ canUseZelveroAI: true })).canUseZelveroAI).toBe(true);
    expect(
      serverMerge({ canSell: true, canUseZelveroAI: false }, { canUseZelveroAI: true }),
    ).toEqual(clientMerge({ canSell: true, canUseZelveroAI: false }, { canUseZelveroAI: true }));
  });
});

describe('telegram messages (legacy CATCH POS format)', () => {
  it('formats dates as dd/mm/yyyy h:mm:ss in the configured time zone', () => {
    expect(formatDate(Date.UTC(2026, 8, 29, 6, 5, 9), 'Asia/Beirut')).toBe('29/09/2026 9:05:09');
  });

  it('builds a sale message', () => {
    const text = saleMessage(
      {
        kind: 'cash',
        invoiceNumber: 'INV-007',
        createdByName: 'Rami',
        createdAtMs: Date.UTC(2026, 8, 29, 6, 0, 0),
        items: [{ name: 'Case', quantity: 2, unitUsdCents: 500 }],
        totalUsdCents: 1_000,
        discountUsdCents: 100,
        costUsdCents: 400,
        payment: { receivedUsdCents: 600, receivedLbp: 358_000 },
      },
      'Asia/Beirut',
    );
    expect(text).toContain('🔔 New sale');
    expect(text).toContain('👤 Seller: Rami');
    expect(text).toContain('📄 Invoice: INV-007');
    expect(text).toContain('Case × 2 = 10.00 USD');
    expect(text).toContain('💰 Total: 10.00 USD');
    expect(text).toContain('💸 Discount: 1.00 USD');
    expect(text).toContain('📈 Profit: 6.00 USD');
    expect(text).toContain('💵 Received: 6.00 USD / 358,000 LBP');
  });

  it('builds a cash movement message with before / changed / after', () => {
    const text = cashMessage(
      { type: 'expense', usdCents: -500, lbp: 0, balanceAfter: { usdCents: 9_500, lbp: 0 }, category: 'rent', note: 'May', createdByName: 'Owner' },
      'Asia/Beirut',
    );
    expect(text).toContain('🔔 Expense');
    expect(text).toContain('💵 Before: 100.00 USD / 0 LBP');
    expect(text).toContain('➕ Changed: -5.00 USD');
    expect(text).toContain('💰 After: 95.00 USD / 0 LBP');
    expect(text).toContain('📝 May');
  });

  it('detects low stock crossings only once', () => {
    expect(crossedLowStock(11, 10, 10)).toBe(true);
    expect(crossedLowStock(10, 9, 10)).toBe(false);
    expect(lowStockMessage('Case', 3, 5)).toContain('📉 Stock: 3 (alert at 5)');
  });
});

describe('telegram online order message', () => {
  it('lists the customer, delivery area, items, fee and total', () => {
    const text = onlineOrderMessage(
      {
        ref: 'ZV-000005',
        createdAtMs: Date.UTC(2026, 10, 20, 13, 16, 0),
        customerName: 'Test Customer',
        customerPhone: '70123456',
        fulfillment: 'delivery',
        deliveryZone: 'Jounieh',
        address: 'Main road',
        lines: [{ name: 'Phone case', qty: 3, lineUsdCents: 1500, lineLbp: 1342500 }],
        deliveryFeeUsdCents: 500,
        totalUsdCents: 2000,
        totalLbp: 1790000,
        note: '',
      },
      'Asia/Beirut',
    );
    expect(text.split('\n')).toEqual([
      '🛍️ New online order ZV-000005',
      '📅 20/11/2026 15:16:00',
      '👥 Customer: Test Customer · 70123456',
      '🚚 Delivery (Jounieh)',
      '📍 Main road',
      '🛒 Products:',
      '  • Phone case × 3 = 15.00 USD',
      '🚚 Delivery fee: 5.00 USD',
      '💰 Total: 20.00 USD / 1,790,000 LBP',
      '💵 Cash on delivery / at pickup',
    ]);
  });

  it('says pickup and skips the address and fee', () => {
    const text = onlineOrderMessage({ ref: 'ZV-1', fulfillment: 'pickup', address: 'x', lines: [], totalUsdCents: 500 }, 'Asia/Beirut');
    expect(text).toContain('🏪 Pickup from the shop');
    expect(text).not.toContain('📍');
    expect(text).not.toContain('Delivery fee');
  });
});
