import type { Product } from '@/types/models';
import type { Cents } from './money';

/** Weighted average cost when adding stock: (cur×curCost + add×newCost) / (cur + add). */
export function weightedAverageCost(currentStock: number, currentCost: Cents, addedQty: number, addedCost: Cents): Cents {
  const cur = Math.max(0, currentStock);
  if (addedQty <= 0) return currentCost;
  if (cur === 0) return addedCost;
  return Math.round((cur * currentCost + addedQty * addedCost) / (cur + addedQty));
}

export function lowStockThreshold(product: Pick<Product, 'minStock'>, storeDefault: number): number {
  return product.minStock ?? storeDefault;
}

export function isLowStock(product: Pick<Product, 'stock' | 'minStock'>, storeDefault: number): boolean {
  return product.stock <= lowStockThreshold(product, storeDefault);
}

/**
 * Upper stock bound for a Firestore range scan that must catch every low product: no product can
 * be low above the larger of the store default and the largest per-product minimum.
 */
export function lowStockScanBound(storeDefault: number, largestMinStock: number | null): number {
  return Math.max(0, storeDefault, largestMinStock ?? 0);
}

/** Low but not out: stock above zero and at or below the product's own threshold. */
export function isLowNotOut(product: Pick<Product, 'stock' | 'minStock'>, storeDefault: number): boolean {
  return product.stock > 0 && isLowStock(product, storeDefault);
}

export function perItemLowStock<T extends Pick<Product, 'stock' | 'minStock'>>(products: readonly T[], storeDefault: number): T[] {
  return products.filter((p) => isLowNotOut(p, storeDefault));
}

export function stockValue(products: Pick<Product, 'stock' | 'costUsdCents'>[]): Cents {
  let total = 0;
  for (const p of products) if (p.stock > 0) total += p.stock * p.costUsdCents;
  return total;
}

/**
 * Products this sale pushed to or below their low-stock level, or sold out, lowest first. An item
 * that was already low before the sale is not repeated on every sale, only when it runs out.
 */
export function lowStockAfterSale<T extends Pick<Product, 'id' | 'stock' | 'minStock'> & { status?: string }>(
  after: readonly T[],
  soldQty: ReadonlyMap<string, number>,
  storeDefault: number,
): T[] {
  return after
    .filter((p) => {
      const sold = soldQty.get(p.id) ?? 0;
      if (p.status === 'archived' || sold <= 0) return false;
      const before = p.stock + sold;
      const level = lowStockThreshold(p, storeDefault);
      return (before > level && p.stock <= level) || (before > 0 && p.stock <= 0);
    })
    .sort((a, b) => a.stock - b.stock);
}
