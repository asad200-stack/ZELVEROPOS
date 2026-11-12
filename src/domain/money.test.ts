import { describe, expect, it } from 'vitest';
import {
  applyTypedMoney,
  centsToInput,
  completeMoneyInput,
  formatUsdTyped,
  lbpCentTolerance,
  lbpToUsdCents,
  parseLbpInput,
  parseUsdInput,
  toCents,
  usdCentsToLbp,
} from './money';

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

  it('G: groups thousands without using formatted strings as cents', () => {
    expect(formatUsdTyped('2000')).toBe('2,000');
    expect(completeMoneyInput('usd', '2000')).toBe('2,000.00');
    expect(completeMoneyInput('usd', '1234567.5')).toBe('1,234,567.50');
    expect(completeMoneyInput('lbp', '44750000')).toBe('44,750,000');
    expect(completeMoneyInput('lbp', '223750000')).toBe('223,750,000');
    expect(parseUsdInput('2,000.00')).toBe(200_000);
    expect(parseLbpInput('44,750,000')).toBe(44_750_000);
  });

  it('I: keeps the caret on the same digit when commas are inserted', () => {
    const next = applyTypedMoney('usd', '2000', 4);
    expect(next.value).toBe('2,000');
    expect(next.value[next.caret - 1]).toBe('0');
  });

  it('parses USD dollars once: 2400 is $2,400.00 not $2,400,000.00', () => {
    expect(parseUsdInput('2400')).toBe(240_000);
    expect(parseUsdInput('2,400')).toBe(240_000);
    expect(parseUsdInput('2400.5')).toBe(240_050);
    expect(parseUsdInput('2,400.50')).toBe(240_050);
    expect(parseUsdInput('2,400.00')).toBe(240_000);
    expect(parseUsdInput('0')).toBe(0);
    expect(completeMoneyInput('usd', '2400')).toBe('2,400.00');
    expect(completeMoneyInput('usd', '2,400')).toBe('2,400.00');
  });

  it('parses LBP pounds without scaling', () => {
    expect(parseLbpInput('17900000')).toBe(17_900_000);
    expect(parseLbpInput('17,900,000')).toBe(17_900_000);
    expect(completeMoneyInput('lbp', '17900000')).toBe('17,900,000');
  });

  it('does not grow when a formatted display string is parsed again', () => {
    let value = '2400';
    for (let i = 0; i < 5; i += 1) {
      value = completeMoneyInput('usd', value);
      expect(parseUsdInput(value)).toBe(240_000);
      expect(value).toBe('2,400.00');
    }
  });

  it('keeps 2400 stable while typing through grouping commas', () => {
    let value = '';
    let caret = 0;
    for (const ch of '2400') {
      const raw = value.slice(0, caret) + ch + value.slice(caret);
      const next = applyTypedMoney('usd', raw, caret + 1);
      value = next.value;
      caret = next.caret;
    }
    expect(value).toBe('2,400');
    expect(parseUsdInput(value)).toBe(240_000);
    expect(completeMoneyInput('usd', value)).toBe('2,400.00');
  });
});
