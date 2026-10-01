import type { Currency, PriceTier, Product } from '@/types/models';
import { usdCentsToLbp, type Cents } from './money';
import { lineUnitLbp, tierUsdCents, unitDiscount } from './pricing';

export interface CartLine {
  key: string;
  productId: string;
  name: string;
  tier: PriceTier;
  quantity: number;
  /** Price override (needs canEditPrice); null = tier price. */
  customUsdCents: number | null;
  imei: string | null;
}

export interface Cart {
  id: string;
  tier: PriceTier;
  currency: Currency;
  customerId: string | null;
  lines: CartLine[];
  /** "Previous balance" line amount (settles customer debt); null when not added. */
  debtLineUsdCents: number | null;
  /** Idempotency key: the Firestore id the sale will get. Regenerated after a successful sale. */
  saleId: string;
}

export interface PricedLine extends CartLine {
  missing: boolean;
  unitUsdCents: Cents;
  unitLbp: number;
  originalUnitUsdCents: Cents;
  discountUsdCents: Cents;
  costUsdCents: Cents;
  lineUsdCents: Cents;
  lineLbp: number;
}

export interface CartTotals {
  lines: PricedLine[];
  itemCount: number;
  productsUsdCents: Cents;
  productsLbp: number;
  discountUsdCents: Cents;
  costUsdCents: Cents;
  debtLineUsdCents: Cents;
  debtLineLbp: number;
  /** What the customer must pay for a cash sale (products + previous-balance line). */
  dueUsdCents: Cents;
  dueLbp: number;
}

export function priceCart(cart: Cart, products: Map<string, Product>, rate: number): CartTotals {
  let productsUsdCents = 0;
  let productsLbp = 0;
  let discountUsdCents = 0;
  let costUsdCents = 0;
  let itemCount = 0;

  const lines = cart.lines.map<PricedLine>((line) => {
    const product = products.get(line.productId);
    if (!product) {
      return {
        ...line,
        missing: true,
        unitUsdCents: 0,
        unitLbp: 0,
        originalUnitUsdCents: 0,
        discountUsdCents: 0,
        costUsdCents: 0,
        lineUsdCents: 0,
        lineLbp: 0,
      };
    }
    const original = tierUsdCents(product, line.tier, rate);
    const unit = line.customUsdCents ?? original;
    const unitLbp = lineUnitLbp(product, line.tier, unit, rate);
    const discount = unitDiscount(original, unit);
    const lineUsd = unit * line.quantity;
    const lineLbp = unitLbp * line.quantity;
    productsUsdCents += lineUsd;
    productsLbp += lineLbp;
    discountUsdCents += discount * line.quantity;
    costUsdCents += product.costUsdCents * line.quantity;
    itemCount += line.quantity;
    return {
      ...line,
      name: product.name,
      missing: false,
      unitUsdCents: unit,
      unitLbp,
      originalUnitUsdCents: original,
      discountUsdCents: discount,
      costUsdCents: product.costUsdCents,
      lineUsdCents: lineUsd,
      lineLbp,
    };
  });

  const debtLineUsdCents = cart.customerId && cart.debtLineUsdCents ? Math.max(0, cart.debtLineUsdCents) : 0;
  const debtLineLbp = usdCentsToLbp(debtLineUsdCents, rate);

  return {
    lines,
    itemCount,
    productsUsdCents,
    productsLbp,
    discountUsdCents,
    costUsdCents,
    debtLineUsdCents,
    debtLineLbp,
    dueUsdCents: productsUsdCents + debtLineUsdCents,
    dueLbp: productsLbp + debtLineLbp,
  };
}

export interface StockShortage {
  productId: string;
  name: string;
  requested: number;
  available: number;
}

/** Validates stock against the aggregated demand of all lines of the same product. */
export function findStockShortages(lines: Pick<CartLine, 'productId' | 'name' | 'quantity'>[], products: Map<string, Product>): StockShortage[] {
  const demand = new Map<string, number>();
  for (const line of lines) demand.set(line.productId, (demand.get(line.productId) ?? 0) + line.quantity);
  const shortages: StockShortage[] = [];
  for (const [productId, requested] of demand) {
    const product = products.get(productId);
    const available = product ? product.stock : 0;
    if (!product || requested > available) {
      shortages.push({ productId, name: product?.name ?? lines.find((l) => l.productId === productId)?.name ?? '', requested, available });
    }
  }
  return shortages;
}

/** Returns IMEIs in the cart that are no longer available on their product. */
export function findUnavailableImeis(lines: CartLine[], products: Map<string, Product>): string[] {
  const bad: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if (!line.imei) continue;
    const product = products.get(line.productId);
    const entry = product?.imeis.find((e) => e.imei === line.imei);
    if (!entry || entry.status !== 'available' || seen.has(line.imei)) bad.push(line.imei);
    seen.add(line.imei);
  }
  return bad;
}

export function newLineKey(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Adds a product to a cart (merging with an identical, non-custom line when possible). */
export function addProductToCart(cart: Cart, product: Product, quantity = 1, imei: string | null = null): Cart {
  if (imei) {
    if (cart.lines.some((l) => l.imei === imei)) return cart;
    return {
      ...cart,
      lines: [
        ...cart.lines,
        { key: newLineKey(), productId: product.id, name: product.name, tier: cart.tier, quantity: 1, customUsdCents: null, imei },
      ],
    };
  }
  const idx = cart.lines.findIndex(
    (l) => l.productId === product.id && l.tier === cart.tier && l.customUsdCents === null && !l.imei,
  );
  const existing = idx >= 0 ? cart.lines[idx] : undefined;
  if (existing) {
    const lines = cart.lines.slice();
    lines[idx] = { ...existing, quantity: existing.quantity + quantity };
    return { ...cart, lines };
  }
  return {
    ...cart,
    lines: [
      ...cart.lines,
      { key: newLineKey(), productId: product.id, name: product.name, tier: cart.tier, quantity, customUsdCents: null, imei: null },
    ],
  };
}
