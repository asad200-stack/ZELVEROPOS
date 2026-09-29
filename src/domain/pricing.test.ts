import { describe, expect, it } from 'vitest';
import { product } from './fixtures.test-utils';
import { lineUnitLbp, tierLbp, tierUsdCents, unitDiscount } from './pricing';

const RATE = 100_000;

describe('pricing', () => {
  it('uses the tier USD price, then tier LBP / rate, then retail', () => {
    const p = product();
    expect(tierUsdCents(p, 'retail', RATE)).toBe(500);
    expect(tierUsdCents(p, 'wholesale', RATE)).toBe(400);
    expect(tierUsdCents(p, 'vip', RATE)).toBe(300);
    const noVip = product({ prices: { ...p.prices, vip: { usdCents: 0, lbp: null } } });
    expect(tierUsdCents(noVip, 'vip', RATE)).toBe(500);
  });

  it('keeps manual LBP prices exact and scales them for custom prices', () => {
    const p = product();
    expect(tierLbp(p, 'vip', RATE)).toBe(300_000);
    expect(tierLbp(p, 'retail', RATE)).toBe(500_000);
    expect(lineUnitLbp(p, 'vip', 300, RATE)).toBe(300_000);
    expect(lineUnitLbp(p, 'vip', 150, RATE)).toBe(150_000);
  });

  it('never reports a negative discount', () => {
    expect(unitDiscount(500, 450)).toBe(50);
    expect(unitDiscount(500, 600)).toBe(0);
  });
});
