/**
 * Products sold from other products' stock.
 *
 * - Carton → piece: the "Carton" product links to the piece product × 10. It has its own name,
 *   barcode and prices; selling one carton deducts 10 pieces.
 * - Set: "Full hookah" links to base × 1 + hose × 1 + head × 2. Selling one set deducts each part.
 *
 * A linked product holds no stock of its own (stock stays 0). Its availability and cost are derived
 * from the products it links to, so purchases, counts and stock value stay on the real pieces.
 * Links are one level deep: a linked product cannot point at another linked product.
 *
 * Framework-free and copied into Cloud Functions (functions/scripts/copy-shared.mjs) so the POS
 * screen and posCheckout compute exactly the same demand.
 */
import type { Product, StockLink } from '@/types/models';
import type { Cents } from './money';

export const STOCK_LINKS_MAX = 20;
export const STOCK_LINK_QTY_MAX = 10_000;

type Stocked = Pick<Product, 'id' | 'name' | 'stock' | 'costUsdCents' | 'status' | 'stockLinks'>;

export function isLinked(p: Pick<Product, 'stockLinks'> | undefined | null): boolean {
  return Array.isArray(p?.stockLinks) && p.stockLinks.length > 0;
}

export function linksOf(p: Pick<Product, 'stockLinks'>): StockLink[] {
  return isLinked(p) ? (p.stockLinks as StockLink[]) : [];
}

/** Ids of every product whose stock a set of lines touches (the lines' products plus their links). */
export function stockProductIds(productIds: Iterable<string>, products: Map<string, Pick<Product, 'stockLinks'>>): string[] {
  const out = new Set<string>();
  for (const id of productIds) {
    out.add(id);
    const p = products.get(id);
    if (p) for (const l of linksOf(p)) out.add(l.productId);
  }
  return [...out];
}

/* ------------------------------------------------------------------ validation */

export type StockLinkIssue = 'tooMany' | 'quantity' | 'self' | 'duplicate' | 'unknown' | 'nested' | 'archived' | 'imei' | 'hasOwnStock';

/**
 * Checks a link list for product `self` against the catalog. An empty list is valid (it turns the
 * feature off). `self` may have no own stock or IMEIs while linked.
 */
export function stockLinkIssues(
  self: Pick<Product, 'id' | 'stock' | 'imeiTracking'>,
  links: StockLink[],
  products: Map<string, Pick<Product, 'id' | 'status' | 'imeiTracking' | 'stockLinks'>>,
): StockLinkIssue[] {
  const issues = new Set<StockLinkIssue>();
  if (links.length === 0) return [];
  if (links.length > STOCK_LINKS_MAX) issues.add('tooMany');
  if (self.stock !== 0) issues.add('hasOwnStock');
  if (self.imeiTracking) issues.add('imei');
  const seen = new Set<string>();
  for (const l of links) {
    if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > STOCK_LINK_QTY_MAX) issues.add('quantity');
    if (l.productId === self.id) issues.add('self');
    if (seen.has(l.productId)) issues.add('duplicate');
    seen.add(l.productId);
    const target = products.get(l.productId);
    if (!target) issues.add('unknown');
    else {
      if (isLinked(target)) issues.add('nested');
      if (target.status === 'archived') issues.add('archived');
      if (target.imeiTracking) issues.add('imei');
    }
  }
  return [...issues];
}

/** Products that link to `id` (used to refuse making a linked target itself linked, or archiving it). */
export function linkedFrom(id: string, products: Iterable<Pick<Product, 'id' | 'stockLinks'>>): string[] {
  const out: string[] = [];
  for (const p of products) if (linksOf(p).some((l) => l.productId === id)) out.push(p.id);
  return out;
}

/* ------------------------------------------------------------------ demand, availability, cost */

export interface DemandLine {
  productId: string;
  quantity: number;
}

/**
 * Pieces to take from each stock-holding product. An ordinary line counts against its own product;
 * a linked line counts quantity × link quantity against each linked product (never against itself).
 * Products missing from `products` are counted against their own id (callers report them as missing).
 */
export function stockDemand(lines: DemandLine[], products: Map<string, Pick<Product, 'stockLinks'>>): Map<string, number> {
  const demand = new Map<string, number>();
  const add = (id: string, qty: number) => demand.set(id, (demand.get(id) ?? 0) + qty);
  for (const line of lines) {
    const p = products.get(line.productId);
    if (p && isLinked(p)) for (const l of linksOf(p)) add(l.productId, line.quantity * l.quantity);
    else add(line.productId, line.quantity);
  }
  return demand;
}

/** Units of `p` that can be sold now: own stock, or the scarcest linked product ÷ its link quantity. */
export function availableStock(p: Stocked, products: Map<string, Stocked>): number {
  if (!isLinked(p)) return p.stock;
  let min = Number.POSITIVE_INFINITY;
  for (const l of linksOf(p)) {
    const target = products.get(l.productId);
    if (!target || target.status === 'archived') return 0;
    min = Math.min(min, Math.floor(Math.max(0, target.stock) / l.quantity));
  }
  return Number.isFinite(min) ? min : 0;
}

/** Cost of one unit: own cost, or the sum of linked products' costs × quantities. */
export function unitCost(p: Pick<Product, 'costUsdCents' | 'stockLinks'>, products: Map<string, Pick<Product, 'costUsdCents'>>): Cents {
  if (!isLinked(p)) return p.costUsdCents;
  let cost = 0;
  for (const l of linksOf(p)) cost += (products.get(l.productId)?.costUsdCents ?? 0) * l.quantity;
  return cost;
}
