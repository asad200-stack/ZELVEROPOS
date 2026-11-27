import type { ChangeManual } from './checkout';
import type { Currency, PriceTier, Product, SaleKind } from '@/types/models';
import { usdCentsToLbp, type Cents } from './money';
import { lineUnitLbp, tierUsdCents, unitDiscount } from './pricing';
import { stockDemand, unitCost } from './stockUnits';

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

/** Cashier-facing payment entry for one cart. */
export interface CartDraft {
  kind: SaleKind;
  receivedUsd: string;
  receivedLbp: string;
  changeUsd: string;
  changeLbp: string;
  changeManual: ChangeManual;
  creditUsd: string;
  creditLbp: string;
  /** Cashier typed USD received (auto-fill must not overwrite it). */
  tenderUsdManual: boolean;
  /** Cashier typed LBP received (auto-fill must not overwrite it). */
  tenderLbpManual: boolean;
}

export type CheckoutDiscountKind = 'fixed' | 'roundDown';

export interface Cart {
  id: string;
  /** Order label such as "Johnny" or "Table 4". Independent of the customer. */
  label: string;
  /** Optional sale note. Printed only when it is not empty. */
  note: string;
  tier: PriceTier;
  currency: Currency;
  customerId: string | null;
  lines: CartLine[];
  /** "Previous balance" line amount (settles customer debt); null when not added. */
  debtLineUsdCents: number | null;
  /**
   * Explicit, cashier-entered checkout-level discount (cash sales only) — e.g. rounding $232.29
   * down to $232.00. NEVER set automatically just because tendered cash is short; only an
   * explicit cashier action (fixed amount or "round down") writes this. Null/0 = no discount.
   * Requires `canEditPrice`, enforced server-side in `posCheckout`, same permission that already
   * gates manual line price overrides.
   */
  checkoutDiscountUsdCents: number;
  checkoutDiscountKind: CheckoutDiscountKind | null;
  /** Idempotency key: the Firestore id the sale will get. Regenerated after a successful sale. */
  saleId: string;
  /** Payment entry for this cart only. Switching carts must not copy it. */
  draft: CartDraft;
}

/** Credit sale needs a real customer. Walk-in cannot open checkout in credit mode. */
export function creditRequiresCustomer(kind: SaleKind, customerId: string | null): boolean {
  return kind === 'credit' && !customerId;
}

/** Products or a selected previous-balance line — either is enough to collect. */
export function cartCanCheckout(cart: Pick<Cart, 'lines' | 'customerId' | 'debtLineUsdCents'>): boolean {
  return cart.lines.length > 0 || Boolean(cart.customerId && cart.debtLineUsdCents && cart.debtLineUsdCents > 0);
}

export function emptyCartDraft(): CartDraft {
  return {
    kind: 'cash',
    receivedUsd: '',
    receivedLbp: '',
    changeUsd: '',
    changeLbp: '',
    changeManual: null,
    creditUsd: '',
    creditLbp: '',
    tenderUsdManual: false,
    tenderLbpManual: false,
  };
}

/** Old saved carts predate the label, note and per-cart payment. Fill those without dropping the sale. */
export function normalizeCart(cart: Cart): Cart {
  const d = cart.draft;
  return {
    ...cart,
    label: typeof cart.label === 'string' ? cart.label.trim().slice(0, 40) : '',
    note: typeof cart.note === 'string' ? cart.note.trim().slice(0, 200) : '',
    checkoutDiscountUsdCents: typeof cart.checkoutDiscountUsdCents === 'number' && cart.checkoutDiscountUsdCents > 0 ? Math.round(cart.checkoutDiscountUsdCents) : 0,
    checkoutDiscountKind: cart.checkoutDiscountKind === 'fixed' || cart.checkoutDiscountKind === 'roundDown' ? cart.checkoutDiscountKind : null,
    draft: {
      kind: d?.kind === 'credit' ? 'credit' : 'cash',
      receivedUsd: typeof d?.receivedUsd === 'string' ? d.receivedUsd : '',
      receivedLbp: typeof d?.receivedLbp === 'string' ? d.receivedLbp : '',
      changeUsd: typeof d?.changeUsd === 'string' ? d.changeUsd : '',
      changeLbp: typeof d?.changeLbp === 'string' ? d.changeLbp : '',
      changeManual: d?.changeManual === 'usd' || d?.changeManual === 'lbp' ? d.changeManual : null,
      creditUsd: typeof d?.creditUsd === 'string' ? d.creditUsd : '',
      creditLbp: typeof d?.creditLbp === 'string' ? d.creditLbp : '',
      tenderUsdManual: d?.tenderUsdManual === true,
      tenderLbpManual: d?.tenderLbpManual === true,
    },
  };
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
  /** Sum of per-line price-override discounts (`canEditPrice`). Distinct from `checkoutDiscountUsdCents`. */
  discountUsdCents: Cents;
  costUsdCents: Cents;
  debtLineUsdCents: Cents;
  debtLineLbp: number;
  /** What the customer must pay for a cash sale (products + previous-balance line), BEFORE any checkout discount. */
  dueUsdCents: Cents;
  dueLbp: number;
  /** Explicit checkout-level discount (cash sales only); see `Cart.checkoutDiscountUsdCents`. */
  checkoutDiscountUsdCents: Cents;
  checkoutDiscountLbp: number;
  checkoutDiscountKind: CheckoutDiscountKind | null;
  /** Final amount the customer must actually pay: `due` minus the checkout discount, floored at 0. */
  payableUsdCents: Cents;
  payableLbp: number;
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
    // A carton or set costs what its linked pieces cost (see domain/stockUnits).
    const cost = unitCost(product, products);
    costUsdCents += cost * line.quantity;
    itemCount += line.quantity;
    return {
      ...line,
      name: product.name,
      missing: false,
      unitUsdCents: unit,
      unitLbp,
      originalUnitUsdCents: original,
      discountUsdCents: discount,
      costUsdCents: cost,
      lineUsdCents: lineUsd,
      lineLbp,
    };
  });

  const debtLineUsdCents = cart.customerId && cart.debtLineUsdCents ? Math.max(0, cart.debtLineUsdCents) : 0;
  const debtLineLbp = usdCentsToLbp(debtLineUsdCents, rate);
  const dueUsdCents = productsUsdCents + debtLineUsdCents;
  const dueLbp = productsLbp + debtLineLbp;
  // Clamped to what is actually due. The "cash sales only" rule is NOT enforced here (this is a
  // pure pricer): the POS UI only ever sets this for a cash draft, and `posCheckout` independently
  // rejects a nonzero discount on a credit sale server-side.
  const checkoutDiscountUsdCents = Math.max(0, Math.min(cart.checkoutDiscountUsdCents || 0, dueUsdCents));
  const checkoutDiscountLbp = usdCentsToLbp(checkoutDiscountUsdCents, rate);
  const checkoutDiscountKind = checkoutDiscountUsdCents > 0 ? cart.checkoutDiscountKind : null;

  return {
    lines,
    itemCount,
    productsUsdCents,
    productsLbp,
    discountUsdCents,
    costUsdCents,
    debtLineUsdCents,
    debtLineLbp,
    dueUsdCents,
    dueLbp,
    checkoutDiscountUsdCents,
    checkoutDiscountLbp,
    checkoutDiscountKind,
    payableUsdCents: Math.max(0, dueUsdCents - checkoutDiscountUsdCents),
    payableLbp: Math.max(0, dueLbp - checkoutDiscountLbp),
  };
}

export interface StockShortage {
  productId: string;
  name: string;
  requested: number;
  available: number;
}

/**
 * Validates stock against the aggregated demand of all lines. A carton or set line counts against the
 * products it is linked to, so `products` must also hold those (see stockProductIds).
 */
export function findStockShortages(lines: Pick<CartLine, 'productId' | 'name' | 'quantity'>[], products: Map<string, Product>): StockShortage[] {
  const demand = stockDemand(lines, products);
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
