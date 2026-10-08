import { describe, expect, it } from 'vitest';
import { formatLbp, formatNumber, formatUsd } from './format';

const LRI = '\u2066';
const PDI = '\u2069';

describe('number direction', () => {
  it('keeps USD, LBP, and grouped numbers in mathematical order', () => {
    expect(formatUsd(50100)).toBe(`${LRI}$501.00${PDI}`);
    expect(formatUsd(-55500)).toBe(`${LRI}-$555.00${PDI}`);
    expect(formatLbp(3_040_000, 'en')).toBe(`${LRI}3,040,000 LBP${PDI}`);
    expect(formatLbp(3_040_000, 'ar')).toBe(`${LRI}3,040,000 ل.ل${PDI}`);
    expect(formatNumber(89500)).toBe(`${LRI}89,500${PDI}`);
  });
});
