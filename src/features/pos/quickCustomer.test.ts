import { describe, expect, it } from 'vitest';
import { quickCustomerSchema } from '@/validation/schemas';
import { quickCustomerSeed } from './quickCustomer';

describe('quick add customer', () => {
  it('prefills the name from a typed name and the phone from a typed number', () => {
    expect(quickCustomerSeed('  Abou Ali ')).toEqual({ name: 'Abou Ali', phone: '' });
    expect(quickCustomerSeed('03 123 456')).toEqual({ name: '', phone: '03 123 456' });
    expect(quickCustomerSeed('+961 3 123456')).toEqual({ name: '', phone: '+961 3 123456' });
    expect(quickCustomerSeed('')).toEqual({ name: '', phone: '' });
  });

  it('requires a name and accepts an empty phone and address', () => {
    expect(quickCustomerSchema.safeParse({ name: '', phone: '', address: '' }).success).toBe(false);
    expect(quickCustomerSchema.safeParse({ name: 'Hiba', phone: '', address: '' }).success).toBe(true);
  });

  it('rejects an invalid phone and normalises a valid one', () => {
    expect(quickCustomerSchema.safeParse({ name: 'Hiba', phone: 'abc', address: '' }).success).toBe(false);
    const ok = quickCustomerSchema.safeParse({ name: 'Hiba', phone: '03 123-456', address: '' });
    expect(ok.success && ok.data.phone).toBe('03123456');
  });
});
