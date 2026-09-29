import type { PriceTier, Product } from '@/types/models';
import { lbpToUsdCents, usdCentsToLbp, type Cents } from './money';

type PricedProduct = Pick<Product, 'prices'>;

/**
 * Tier price in USD cents (CATCH POS priority): tier USD, else tier LBP / rate, else retail USD.
 */
export function tierUsdCents(product: PricedProduct, tier: PriceTier, rate: number): Cents {
  const p = product.prices[tier];
  if (p && p.usdCents > 0) return p.usdCents;
  if (p && p.lbp && p.lbp > 0) return lbpToUsdCents(p.lbp, rate);
  return product.prices.retail?.usdCents ?? 0;
}

/** Tier price in LBP: the manually stored LBP price wins, otherwise USD × rate. */
export function tierLbp(product: PricedProduct, tier: PriceTier, rate: number): number {
  const p = product.prices[tier];
  if (p && p.lbp && p.lbp > 0) return p.lbp;
  return usdCentsToLbp(tierUsdCents(product, tier, rate), rate);
}

/**
 * Unit LBP price for a (possibly custom-priced) line:
 * - unchanged price → the tier LBP price (keeps manual LBP prices exact);
 * - custom price → scale the tier LBP price proportionally; if the base is 0, convert USD × rate.
 */
export function lineUnitLbp(product: PricedProduct, tier: PriceTier, effectiveUsdCents: Cents, rate: number): number {
  const base = tierUsdCents(product, tier, rate);
  const baseLbp = tierLbp(product, tier, rate);
  if (effectiveUsdCents === base) return baseLbp;
  if (base > 0) return Math.round((baseLbp * effectiveUsdCents) / base);
  return usdCentsToLbp(effectiveUsdCents, rate);
}

export function unitDiscount(originalUsdCents: Cents, effectiveUsdCents: Cents): Cents {
  return Math.max(0, originalUsdCents - effectiveUsdCents);
}

export function unitProfit(unitUsdCents: Cents, costUsdCents: Cents): Cents {
  return unitUsdCents - costUsdCents;
}
