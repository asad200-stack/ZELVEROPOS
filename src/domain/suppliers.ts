import type { BillStatus, Purchase } from '@/types/models';
import type { Cents } from './money';

export interface Allocation {
  purchaseId: string;
  purchaseNumber: string;
  amountUsdCents: Cents;
}

export type AllocationResult =
  | { ok: true; allocations: Allocation[] }
  | { ok: false; error: 'invalidAmount' | 'exceedsBalance'; openUsdCents: Cents };

/** Applies a supplier payment to open bills, oldest first. Rejects amounts above the open balance. */
export function allocateSupplierPayment(
  amountUsdCents: Cents,
  bills: Pick<Purchase, 'id' | 'number' | 'date' | 'remainingUsdCents' | 'createdAt'>[],
): AllocationResult {
  const open = bills
    .filter((b) => b.remainingUsdCents > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt ?? 0) - (b.createdAt ?? 0));
  const openUsdCents = open.reduce((s, b) => s + b.remainingUsdCents, 0);
  if (!(amountUsdCents > 0)) return { ok: false, error: 'invalidAmount', openUsdCents };
  if (amountUsdCents > openUsdCents) return { ok: false, error: 'exceedsBalance', openUsdCents };

  let left = amountUsdCents;
  const allocations: Allocation[] = [];
  for (const bill of open) {
    if (left <= 0) break;
    const take = Math.min(left, bill.remainingUsdCents);
    allocations.push({ purchaseId: bill.id, purchaseNumber: bill.number, amountUsdCents: take });
    left -= take;
  }
  return { ok: true, allocations };
}

export function billStatus(totalUsdCents: Cents, paidUsdCents: Cents, returnedUsdCents: Cents): BillStatus {
  const remaining = totalUsdCents - returnedUsdCents - paidUsdCents;
  if (remaining <= 0) return 'paid';
  return paidUsdCents > 0 ? 'partial' : 'unpaid';
}
