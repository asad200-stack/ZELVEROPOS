/**
 * Owner → customer WhatsApp updates for online orders. Opens WhatsApp with a ready message;
 * the owner presses send (no automatic messaging, no third-party API).
 */

/**
 * wa.me needs the full international number without "+". Lebanese customers often type the local
 * form (70 123 456 or 03 123 456), so short numbers get Lebanon's 961 in front.
 */
export function waNumber(phone: string, countryCode = '961'): string | null {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (!phone.trim().startsWith('+') && digits.startsWith('0')) digits = `${countryCode}${digits.slice(1)}`;
  else if (!phone.trim().startsWith('+') && digits.length <= 8) digits = `${countryCode}${digits}`;
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

export function customerWhatsAppLink(phone: string, text: string): string | null {
  const n = waNumber(phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}
