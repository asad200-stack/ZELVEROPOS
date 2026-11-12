import { describe, expect, it } from 'vitest';
import type { CheckoutResult } from '@/services/salesService';
import { claimAutoPrint, shouldAutoPrintInvoice } from './autoPrint';

const online = { mode: 'online' } as CheckoutResult;
const queued = { mode: 'queued' } as CheckoutResult;

describe('automatic invoice printing', () => {
  it('prints only a confirmed sale when the store turned the setting on', () => {
    expect(shouldAutoPrintInvoice(online, { autoPrintInvoice: true })).toBe(true);
    expect(shouldAutoPrintInvoice(online, { autoPrintInvoice: false })).toBe(false);
    expect(shouldAutoPrintInvoice(queued, { autoPrintInvoice: true })).toBe(false);
  });

  it('claims each sale once so a remount cannot print it again', () => {
    const seen = new Set<string>();
    expect(claimAutoPrint(seen, 'sale-1')).toBe(true);
    expect(claimAutoPrint(seen, 'sale-1')).toBe(false);
    expect(claimAutoPrint(seen, 'sale-2')).toBe(true);
  });
});