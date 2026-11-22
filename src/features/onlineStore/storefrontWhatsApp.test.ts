import { describe, expect, it } from 'vitest';
import { plainUsd, whatsAppLink, whatsAppOrderText, type WaWords } from './storefrontWhatsApp';

const words: WaWords = {
  hello: (s, r) => `Hi ${s}, order ${r}:`,
  total: (a) => `Total: ${a}`,
  name: (v) => `Name: ${v}`,
  phone: (v) => `Phone: ${v}`,
  delivery: (a) => `Deliver to: ${a}`,
  pickup: 'Pickup from the shop',
  note: (v) => `Note: ${v}`,
  fee: (z, a) => `Delivery (${z}): ${a}`,
};

const receipt = {
  payment: 'cod' as const,
  paymentStatus: 'none' as const,
  ref: 'ZV-000007',
  status: 'pending' as const,
  fulfillment: 'delivery' as const,
  lines: [
    { name: 'Phone case', qty: 2, lineUsdCents: 1000, lineLbp: 0 },
    { name: 'Bread', qty: 1, lineUsdCents: 0, lineLbp: 90000 },
  ],
  deliveryZone: '',
  deliveryFeeUsdCents: 0,
  totalUsdCents: 1000,
  totalLbp: 985000,
};

describe('storefront WhatsApp order', () => {
  it('formats plain money without bidi marks', () => {
    expect(plainUsd(1050)).toBe('$10.50');
  });

  it('lists every line, the total and the delivery details', () => {
    const text = whatsAppOrderText(receipt, { storeName: 'Demo', name: ' Ali ', phone: '70123456', address: 'Hamra', note: '' }, words, 'en');
    expect(text).toBe(
      ['Hi Demo, order ZV-000007:', '', '• 2 × Phone case = $10.00', '• 1 × Bread = 90,000 LBP', '', 'Total: $10.00', 'Name: Ali', 'Phone: 70123456', 'Deliver to: Hamra'].join('\n'),
    );
  });

  it('says pickup and keeps the note', () => {
    const text = whatsAppOrderText({ ...receipt, fulfillment: 'pickup' }, { storeName: 'D', name: '', phone: '', address: '', note: 'Ring twice' }, words, 'en');
    expect(text).toContain('Pickup from the shop');
    expect(text).toContain('Note: Ring twice');
    expect(text).not.toContain('Name:');
  });

  it('builds a wa.me link only for a real number', () => {
    expect(whatsAppLink('+961 70 123 456', 'a b')).toBe('https://wa.me/96170123456?text=a%20b');
    expect(whatsAppLink('', 'x')).toBeNull();
  });

  it('adds the delivery fee line when a zone was chosen', () => {
    const text = whatsAppOrderText(
      { ...receipt, deliveryZone: 'Hamra', deliveryFeeUsdCents: 300, totalUsdCents: 1300 },
      { storeName: 'D', name: '', phone: '', address: 'Street 1', note: '' },
      words,
      'en',
    );
    expect(text).toContain('Delivery (Hamra): $3.00');
    expect(text).toContain('Total: $13.00');
  });
});
