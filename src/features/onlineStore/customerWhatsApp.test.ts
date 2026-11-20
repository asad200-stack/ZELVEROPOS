import { describe, expect, it } from 'vitest';
import { customerWhatsAppLink, waNumber } from './customerWhatsApp';

describe('customer WhatsApp numbers', () => {
  it('adds Lebanon to local numbers', () => {
    expect(waNumber('70123456')).toBe('96170123456');
    expect(waNumber('70 123 456')).toBe('96170123456');
    expect(waNumber('03 123 456')).toBe('9613123456');
  });

  it('keeps international numbers', () => {
    expect(waNumber('+96170123456')).toBe('96170123456');
    expect(waNumber('0096170123456')).toBe('96170123456');
    expect(waNumber('+33612345678')).toBe('33612345678');
  });

  it('rejects junk', () => {
    expect(waNumber('')).toBeNull();
    expect(waNumber('123')).toBeNull();
  });

  it('builds the link with the message', () => {
    expect(customerWhatsAppLink('70123456', 'Hi there')).toBe('https://wa.me/96170123456?text=Hi%20there');
  });
});
