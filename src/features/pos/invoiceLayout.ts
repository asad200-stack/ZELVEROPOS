/**
 * Pure helpers for the POS Invoice Table layout. No React, no Firebase: unit tested on their own.
 * They only arrange and filter what the shared cart engine (domain/cart.ts) already priced.
 */

export type PosLayout = 'classic' | 'invoice';

const LAYOUT_KEY = 'zelvero.pos.layout';

/** Per-user preferred layout. Storage can be missing or blocked (private mode): fall back to classic. */
export function readPosLayout(uid: string): PosLayout {
  try {
    const value = localStorage.getItem(`${LAYOUT_KEY}.${uid}`);
    return value === 'invoice' ? 'invoice' : 'classic';
  } catch {
    return 'classic';
  }
}

export function writePosLayout(uid: string, layout: PosLayout): void {
  try {
    localStorage.setItem(`${LAYOUT_KEY}.${uid}`, layout);
  } catch {
    /* preference only — the POS works without it */
  }
}

export interface RowWindow {
  start: number;
  end: number;
  padTop: number;
  padBottom: number;
}

/**
 * Which rows to render for a scrolled list of fixed-height rows. Small lists render in full;
 * long invoices render only the visible rows plus an overscan margin.
 */
export function rowWindow(scrollTop: number, viewport: number, rowHeight: number, count: number, overscan = 8, fullBelow = 60): RowWindow {
  if (count <= fullBelow || rowHeight <= 0 || viewport <= 0) return { start: 0, end: count, padTop: 0, padBottom: 0 };
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const visible = Math.ceil(viewport / rowHeight);
  const start = Math.max(0, first - overscan);
  const end = Math.min(count, first + visible + overscan);
  return { start, end, padTop: start * rowHeight, padBottom: (count - end) * rowHeight };
}

/** The scrollTop that brings row `index` fully into view, or null when it already is. */
export function scrollToRow(index: number, scrollTop: number, viewport: number, rowHeight: number): number | null {
  const top = index * rowHeight;
  const bottom = top + rowHeight;
  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewport) return bottom - viewport;
  return null;
}

/** Filter for "search in this invoice": name, barcode/SKU or IMEI, case- and space-insensitive. */
export function matchesInvoiceQuery(query: string, fields: Array<string | null | undefined>): boolean {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return true;
  return fields.some((f) => (f ?? '').toLowerCase().replace(/\s+/g, ' ').includes(q));
}

/**
 * "12*6291041500213" or "12 x pepsi" adds 12 at once — a common shortcut on counters with
 * large orders. Plain text is quantity 1. Quantity is capped to a sane range.
 */
export function parseQuantityPrefix(text: string): { qty: number; query: string } {
  const m = /^\s*(\d{1,4})\s*[*xX×]\s*(.+)$/.exec(text);
  if (!m) return { qty: 1, query: text.trim() };
  const qty = Math.min(9_999, Math.max(1, Number(m[1])));
  return { qty, query: m[2]!.trim() };
}

/**
 * A per-unit discount is stored the same way the classic cart stores it: as a custom unit price
 * (customUsdCents). Returns null when the result equals the list price (no override).
 */
export function customPriceFromDiscount(originalUnitUsdCents: number, discountUsdCents: number): number | null {
  const discount = Math.max(0, Math.min(originalUnitUsdCents, Math.round(discountUsdCents)));
  const price = originalUnitUsdCents - discount;
  return price === originalUnitUsdCents ? null : price;
}

/** Same rule for a typed unit price: equal to the list price clears the override. */
export function customPriceFromUnit(originalUnitUsdCents: number, unitUsdCents: number): number | null {
  const price = Math.max(0, Math.round(unitUsdCents));
  return price === originalUnitUsdCents ? null : price;
}

/** How many more units of a product can go in the cart without exceeding stock. */
export function roomInStock(stock: number, alreadyInCart: number): number {
  return Math.max(0, Math.max(0, stock) - Math.max(0, alreadyInCart));
}

export type InvoiceView = 'cards' | 'list';
const VIEW_KEY = 'zelvero.pos.invoiceView';

/** Cards (photo-first, several per row) or the dense list. Defaults to cards. */
export function readInvoiceView(uid: string): InvoiceView {
  try {
    return localStorage.getItem(`${VIEW_KEY}.${uid}`) === 'list' ? 'list' : 'cards';
  } catch {
    return 'cards';
  }
}

export function writeInvoiceView(uid: string, view: InvoiceView): void {
  try {
    localStorage.setItem(`${VIEW_KEY}.${uid}`, view);
  } catch {
    /* preference only */
  }
}

/** How many cards of at least `minCard` px fit in `width`, with `gap` between them. */
export function cardColumns(width: number, minCard: number, gap: number): number {
  if (width <= 0) return 1;
  return Math.max(1, Math.floor((width + gap) / (minCard + gap)));
}
