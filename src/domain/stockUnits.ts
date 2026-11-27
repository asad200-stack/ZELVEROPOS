/**
 * Carton ↔ piece selling and product sets (e.g. a full hookah: base + hose + head + bowl).
 * Framework-free so Cloud Functions can share it with the POS (same pattern as featureRelease.ts).
 *
 * Stock is always kept in base pieces. A pack line (one carton = `size` pieces) and a set line
 * (deducts each component) are converted to base-piece demand here, in one place, so checkout,
 * returns, shortage checks and costing all agree.
 *
 * Both fields are optional on Product: a missing field means the feature is off for that product,
 * so every existing store keeps behaving exactly as before.
 */
import type { PriceTier, Product, TierPrices } from '@/types/models';
import type { Cents } from './money';

export const PACK_SIZE_MAX = 10_000;
export const SET_COMPONENTS_MAX = 20;
export const SET_COMPONENT_QTY_MAX = 1_000;

export interface PackUnit {
  /** Shown on the button and the receipt, e.g. "Carton" / "كرتونة". */
  name: string;
  /** Base pieces in one pack. Integer ≥ 2. */
  size: number;
  /** Barcode printed on the carton; '' when none. Must differ from the piece barcode. */
  barcode: string;
  /** Price of one whole pack per tier (usually below size × piece price). */
  prices: TierPrices;
}

export interface SetComponent {
  productId: string;
  /** Pieces of the component in one set. Integer ≥ 1. */
  quantity: number;
}

/** Optional fields this module reads; Product itself stays unchanged for stores that don't use them. */
export type StockUnitFields = Pick<Product, 'id' | 'name' | 'stock' | 'costUsdCents' | 'barcode' | 'status'> & {
  packUnit?: PackUnit | null;
  setComponents?: SetComponent[] | null;
};

export interface DemandLine {
  productId: string;
  quantity: number;
  /** True when the line sells whole packs (quantity counted in packs). */
  pack?: boolean;
}

export type StockUnitError =
  | { code: 'unknownProduct'; productId: string }
  | { code: 'noPackUnit'; productId: string }
  | { code: 'nestedSet'; productId: string; componentId: string }
  | { code: 'archivedComponent'; productId: string; componentId: string };

export type DemandResult = { ok: true; demand: Map<string, number> } | { ok: false; error: StockUnitError };

/* ------------------------------------------------------------------ validation */

export type PackUnitIssue = 'name' | 'size' | 'barcodeSameAsPiece' | 'price';

export function packUnitIssues(pack: PackUnit, pieceBarcode: string): PackUnitIssue[] {
  const issues: PackUnitIssue[] = [];
  if (!pack.name.trim() || pack.name.length > 40) issues.push('name');
  if (!Number.isInteger(pack.size) || pack.size < 2 || pack.size > PACK_SIZE_MAX) issues.push('size');
  const code = pack.barcode.trim();
  if (code && code === pieceBarcode.trim()) issues.push('barcodeSameAsPiece');
  const tiers = Object.values(pack.prices);
  if (tiers.some((t) => !Number.isInteger(t.usdCents) || t.usdCents < 0)) issues.push('price');
  return issues;
}

export type SetIssue = 'empty' | 'tooMany' | 'quantity' | 'self' | 'duplicate' | 'nested' | 'unknown';

/** Validates a set definition against the current catalog. A set may not contain another set. */
export function setIssues(setId: string, components: SetComponent[], products: Map<string, StockUnitFields>): SetIssue[] {
  const issues = new Set<SetIssue>();
  if (components.length === 0) issues.add('empty');
  if (components.length > SET_COMPONENTS_MAX) issues.add('tooMany');
  const seen = new Set<string>();
  for (const c of components) {
    if (!Number.isInteger(c.quantity) || c.quantity < 1 || c.quantity > SET_COMPONENT_QTY_MAX) issues.add('quantity');
    if (c.productId === setId) issues.add('self');
    if (seen.has(c.productId)) issues.add('duplicate');
    seen.add(c.productId);
    const p = products.get(c.productId);
    if (!p) issues.add('unknown');
    else if (p.setComponents && p.setComponents.length > 0) issues.add('nested');
  }
  return [...issues];
}

export function isSet(p: Pick<StockUnitFields, 'setComponents'>): boolean {
  return Array.isArray(p.setComponents) && p.setComponents.length > 0;
}

/* ------------------------------------------------------------------ demand */

/**
 * Converts cart/sale lines into base-piece demand per stocked product.
 * - pack line: quantity × pack size of that product
 * - set line: quantity × component quantity for each component (the set itself holds no stock)
 */
export function stockDemand(lines: DemandLine[], products: Map<string, StockUnitFields>): DemandResult {
  const demand = new Map<string, number>();
  const add = (id: string, qty: number) => demand.set(id, (demand.get(id) ?? 0) + qty);

  for (const line of lines) {
    const p = products.get(line.productId);
    if (!p) return { ok: false, error: { code: 'unknownProduct', productId: line.productId } };

    let pieces = line.quantity;
    if (line.pack) {
      if (!p.packUnit) return { ok: false, error: { code: 'noPackUnit', productId: p.id } };
      pieces = line.quantity * p.packUnit.size;
    }

    if (isSet(p)) {
      for (const c of p.setComponents ?? []) {
        const comp = products.get(c.productId);
        if (!comp) return { ok: false, error: { code: 'unknownProduct', productId: c.productId } };
        if (isSet(comp)) return { ok: false, error: { code: 'nestedSet', productId: p.id, componentId: comp.id } };
        if (comp.status === 'archived') return { ok: false, error: { code: 'archivedComponent', productId: p.id, componentId: comp.id } };
        add(comp.id, pieces * c.quantity);
      }
    } else {
      add(p.id, pieces);
    }
  }
  return { ok: true, demand };
}

/* ------------------------------------------------------------------ availability + cost */

/** How many whole sets can be made from current component stock (0 when any component is short). */
export function setsAvailable(set: StockUnitFields, products: Map<string, StockUnitFields>): number {
  if (!isSet(set)) return Math.max(0, set.stock);
  let min = Number.POSITIVE_INFINITY;
  for (const c of set.setComponents ?? []) {
    const comp = products.get(c.productId);
    if (!comp) return 0;
    min = Math.min(min, Math.floor(Math.max(0, comp.stock) / c.quantity));
  }
  return Number.isFinite(min) ? min : 0;
}

/** Whole packs available from the piece stock. */
export function packsAvailable(p: StockUnitFields): number {
  if (!p.packUnit) return 0;
  return Math.floor(Math.max(0, p.stock) / p.packUnit.size);
}

/** Cost of one sale unit: a set costs the sum of its parts; a pack costs size × piece cost. */
export function unitCostUsdCents(p: StockUnitFields, products: Map<string, StockUnitFields>, pack = false): Cents {
  let cost = p.costUsdCents;
  if (isSet(p)) {
    cost = 0;
    for (const c of p.setComponents ?? []) cost += (products.get(c.productId)?.costUsdCents ?? 0) * c.quantity;
  }
  return pack && p.packUnit ? cost * p.packUnit.size : cost;
}

/** Pack price for a tier. */
export function packPriceUsdCents(p: StockUnitFields, tier: PriceTier): Cents | null {
  return p.packUnit ? p.packUnit.prices[tier].usdCents : null;
}

/* ------------------------------------------------------------------ scanning + purchases */

export interface ScanHit {
  product: StockUnitFields;
  pack: boolean;
}

/** Finds a product by its piece barcode or its pack barcode. Archived products are not sold. */
export function findByBarcode(code: string, products: Iterable<StockUnitFields>): ScanHit | null {
  const needle = code.trim();
  if (!needle) return null;
  let packHit: ScanHit | null = null;
  for (const p of products) {
    if (p.status === 'archived') continue;
    if (p.barcode.trim() === needle) return { product: p, pack: false };
    if (!packHit && p.packUnit && p.packUnit.barcode.trim() === needle) packHit = { product: p, pack: true };
  }
  return packHit;
}

/** Purchases entered in packs: pieces added to stock and the per-piece cost (rounded to the cent). */
export function packPurchase(packs: number, packCostUsdCents: Cents, packSize: number): { pieces: number; unitCostUsdCents: Cents } {
  return { pieces: packs * packSize, unitCostUsdCents: Math.round(packCostUsdCents / packSize) };
}
