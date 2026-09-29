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

export function stockValue(products: Pick<Product, 'stock' | 'costUsdCents'>[]): Cents {
  let total = 0;
  for (const p of products) if (p.stock > 0) total += p.stock * p.costUsdCents;
  return total;
}
