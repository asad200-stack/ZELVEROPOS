import type { CheckoutResult } from '@/services/salesService';
import type { StoreSettings } from '@/types/models';

/**
 * Automatic printing is only for a sale the server has already accepted.
 * A queued offline sale is not an invoice, and a missing preference stays off.
 */
export function shouldAutoPrintInvoice(result: CheckoutResult, settings: Pick<StoreSettings, 'autoPrintInvoice'>): boolean {
  return settings.autoPrintInvoice === true && result.mode === 'online';
}

/** One automatic print per confirmed sale, including if the print sheet is mounted twice. */
export function claimAutoPrint(seen: Set<string>, saleId: string): boolean {
  if (seen.has(saleId)) return false;
  seen.add(saleId);
  return true;
}
