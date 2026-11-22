import type { PublicOrderReceipt } from '@/domain/onlineOrders';

/**
 * The order a guest is paying for while they are on Whish's page. Kept in sessionStorage (this
 * tab only) so the receipt and the payment check can resume when Whish sends them back.
 */
export interface PendingPayment {
  receipt: PublicOrderReceipt;
  phone: string;
}

const keyOf = (slug: string) => `sf-pay-${slug}`;

export function savePendingPayment(slug: string, p: PendingPayment): void {
  try {
    window.sessionStorage.setItem(keyOf(slug), JSON.stringify(p));
  } catch {
    // Storage blocked: the guest can still use "track order" with their reference.
  }
}

export function readPendingPayment(slug: string): PendingPayment | null {
  try {
    const raw = window.sessionStorage.getItem(keyOf(slug));
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingPayment;
    return p && p.receipt && typeof p.receipt.ref === 'string' && typeof p.phone === 'string' ? p : null;
  } catch {
    return null;
  }
}

export function clearPendingPayment(slug: string): void {
  try {
    window.sessionStorage.removeItem(keyOf(slug));
  } catch {
    // ignore
  }
}
