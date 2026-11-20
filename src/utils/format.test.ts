import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatLbp, formatNumber, formatUsd } from './format';

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

describe('date direction', () => {
  const RLI = '\u2067';
  const ms = Date.UTC(2026, 10, 20, 10, 15);

  it('keeps English dates in a left-to-right isolate', () => {
    expect(formatDateTime(ms, 'en').startsWith(LRI)).toBe(true);
    expect(formatDate('2026-11-20', 'en')).toBe(`${LRI}20/11/2026${PDI}`);
  });

  it('isolates Arabic dates right-to-left so their marks are not reversed', () => {
    const dt = formatDateTime(ms, 'ar');
    expect(dt.startsWith(RLI)).toBe(true);
    expect(dt.endsWith(PDI)).toBe(true);
    expect(dt).not.toContain(LRI);
    expect(formatDate('2026-11-20', 'ar').startsWith(RLI)).toBe(true);
  });
});
