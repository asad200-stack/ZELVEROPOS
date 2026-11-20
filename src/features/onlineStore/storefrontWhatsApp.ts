import type { PublicOrderReceipt } from '@/domain/onlineOrders';

/** Plain-text money for chat messages (no bidi isolates: WhatsApp shows them as boxes on some phones). */
export function plainUsd(cents: number): string {
  return `$${(Math.round(cents) / 100).toFixed(2)}`;
}

export function plainLbp(lbp: number, lang: 'ar' | 'en'): string {
  return `${Math.round(lbp).toLocaleString('en-US')} ${lang === 'ar' ? 'ل.ل' : 'LBP'}`;
}

export interface WaOrderDetails {
  storeName: string;
  name: string;
  phone: string;
  address: string;
  note: string;
}

export interface WaWords {
  hello: (store: string, ref: string) => string;
  total: (amount: string) => string;
  name: (v: string) => string;
  phone: (v: string) => string;
  delivery: (address: string) => string;
  pickup: string;
  note: (v: string) => string;
  fee: (zone: string, amount: string) => string;
}

/** The order summary a guest sends to the shop after placing an order. */
export function whatsAppOrderText(receipt: PublicOrderReceipt, d: WaOrderDetails, w: WaWords, lang: 'ar' | 'en'): string {
  const money = (usd: number, lbp: number) => (usd > 0 ? plainUsd(usd) : plainLbp(lbp, lang));
  const lines = [w.hello(d.storeName, receipt.ref), ''];
  for (const l of receipt.lines) lines.push(`• ${l.qty} × ${l.name} = ${money(l.lineUsdCents, l.lineLbp)}`);
  if (receipt.deliveryFeeUsdCents > 0 || receipt.deliveryZone) {
    lines.push(w.fee(receipt.deliveryZone, receipt.deliveryFeeUsdCents > 0 ? plainUsd(receipt.deliveryFeeUsdCents) : plainUsd(0)));
  }
  lines.push('', w.total(money(receipt.totalUsdCents, receipt.totalLbp)));
  if (d.name.trim()) lines.push(w.name(d.name.trim()));
  if (d.phone.trim()) lines.push(w.phone(d.phone.trim()));
  lines.push(receipt.fulfillment === 'delivery' ? w.delivery(d.address.trim()) : w.pickup);
  if (d.note.trim()) lines.push(w.note(d.note.trim()));
  return lines.join('\n');
}

/** wa.me link with the message pre-filled; null when the shop has no WhatsApp number. */
export function whatsAppLink(whatsapp: string, text: string): string | null {
  const digits = whatsapp.replace(/\D/g, '');
  if (digits.length < 7) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
