import { describe, expect, it } from 'vitest';
import { allocateSupplierPayment, billStatus } from './suppliers';

const bill = (id: string, date: string, remaining: number) => ({ id, number: id.toUpperCase(), date, remainingUsdCents: remaining, createdAt: 0 });

describe('supplier payments', () => {
  it('applies payments to the oldest open bills first', () => {
    const r = allocateSupplierPayment(700, [bill('b2', '2026-02-01', 500), bill('b1', '2026-01-01', 400), bill('b3', '2026-03-01', 0)]);
    expect(r).toEqual({
      ok: true,
      allocations: [
        { purchaseId: 'b1', purchaseNumber: 'B1', amountUsdCents: 400 },
        { purchaseId: 'b2', purchaseNumber: 'B2', amountUsdCents: 300 },
      ],
    });
  });

  it('rejects payments above the open balance', () => {
    expect(allocateSupplierPayment(1_000, [bill('b1', '2026-01-01', 400)])).toEqual({ ok: false, error: 'exceedsBalance', openUsdCents: 400 });
    expect(allocateSupplierPayment(0, [bill('b1', '2026-01-01', 400)])).toMatchObject({ ok: false, error: 'invalidAmount' });
  });

  it('derives bill status from paid and returned amounts', () => {
    expect(billStatus(1_000, 0, 0)).toBe('unpaid');
    expect(billStatus(1_000, 400, 0)).toBe('partial');
    expect(billStatus(1_000, 600, 400)).toBe('paid');
  });
});
