/**
 * Pure helpers for the POS "Quick add customer" flow (kept separate so they can be unit tested).
 */

/** What the cashier typed in the customer search becomes the starting name or phone. */
export function quickCustomerSeed(search: string): { name: string; phone: string } {
  const text = search.trim();
  if (!text) return { name: '', phone: '' };
  const digits = text.replace(/[\s()+-]/g, '');
  // Mostly digits → it is a phone number the cashier was searching for.
  if (/^\d{3,15}$/.test(digits)) return { name: '', phone: text };
  return { name: text, phone: '' };
}
