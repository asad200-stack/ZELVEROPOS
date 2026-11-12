import { describe, expect, it } from 'vitest';
import { EMPTY_QUOTE, QUOTE_STEPS, canAdvance, quoteReadyCopy, quoteSummaryLines, recommendedSetup } from './model';

describe('quote wizard', () => {
  it('never invents a numeric price', () => {
    expect(quoteReadyCopy()).toBe('Your recommended ZELVERO setup');
    expect(quoteReadyCopy()).not.toMatch(/\$\d/);
    expect(quoteSummaryLines(EMPTY_QUOTE).join(' ')).not.toMatch(/\$\d/);
  });

  it('moves through five sales steps', () => {
    expect(QUOTE_STEPS).toEqual([
      'Tell us about your business',
      'How do you work?',
      'What do you need?',
      'Your contact details',
      'Your recommended ZELVERO setup',
    ]);
    expect(canAdvance('Tell us about your business', EMPTY_QUOTE)).toBe(true);
    expect(canAdvance('Your contact details', EMPTY_QUOTE)).toBe(false);
    expect(canAdvance('Your contact details', { ...EMPTY_QUOTE, name: 'A', company: 'B', email: 'a@b.co', phone: '1' })).toBe(true);
  });

  it('summarizes a recommended setup', () => {
    const rec = recommendedSetup({ ...EMPTY_QUOTE, businessType: 'mobile-electronics', imei: true });
    expect(rec).toContain('POS');
    expect(rec).toContain('Customers');
    expect(rec).toContain('Customer credit');
    expect(rec.some((i) => i.includes('IMEI'))).toBe(true);
    expect(rec.join(' ')).not.toMatch(/\$\d/);
  });
});
