import { describe, expect, it } from 'vitest';
import { centsToInput, lbpCentTolerance, lbpToUsdCents, parseLbpInput, parseUsdInput, toCents, usdCentsToLbp } from './money';

describe('money', () => {
  it('converts dollars to integer cents without float drift', () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(19.99)).toBe(1999);
    expect(toCents(1.005)).toBe(101);
    expect(toCents(Number.NaN)).toBe(0);
  });

  it('converts between USD cents and LBP with the exchange rate', () => {
    expect(usdCentsToLbp(100, 89_500)).toBe(89_500);
    expect(usdCentsToLbp(250, 89_500)).toBe(223_750);
    expect(lbpToUsdCents(89_500, 89_500)).toBe(100);
    expect(lbpToUsdCents(1_000, 0)).toBe(0);
    expect(lbpCentTolerance(89_500)).toBe(895);
  });

  it('parses user input', () => {
    expect(parseUsdInput('1,234.50')).toBe(123_450);
    expect(parseUsdInput('$12')).toBe(1_200);
    expect(parseUsdInput('-3')).toBeNull();
    expect(parseUsdInput('abc')).toBeNull();
    expect(parseLbpInput('150,000 LBP')).toBe(150_000);
    expect(parseLbpInput('50000 ل.ل')).toBe(50_000);
    expect(parseLbpInput('')).toBeNull();
    expect(centsToInput(1250)).toBe('12.50');
    expect(centsToInput(null)).toBe('');
  });
});
