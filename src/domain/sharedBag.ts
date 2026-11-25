/**
 * "Send the bag to a friend": the bag travels inside the shop link (?bag=…&from=…), so nothing is
 * stored on a server. The friend adds it to their own bag, adds more, and one order goes out.
 * Prices and stock are always decided by the server when the order is placed.
 */
import { ORDER_MAX_QTY } from './onlineOrders';

export interface BagLine {
  productId: string;
  qty: number;
  /** Size picked for the item ('' when none). */
  size: string;
}

/** Most lines carried in one link (keeps the link short enough for WhatsApp). */
export const SHARED_BAG_MAX_LINES = 40;
export const SHARED_BAG_NAME_MAX = 40;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SIZE_MAX = 12;

/** "id:qty:size,id:qty" — sizes URI-encoded; the whole value is placed in a URL by URLSearchParams. */
export function encodeBag(lines: readonly BagLine[]): string {
  return lines
    .filter((l) => ID_RE.test(l.productId) && l.qty > 0)
    .slice(0, SHARED_BAG_MAX_LINES)
    .map((l) => {
      const qty = Math.min(ORDER_MAX_QTY, Math.floor(l.qty));
      const size = l.size.trim().slice(0, SIZE_MAX);
      return size ? `${l.productId}:${qty}:${encodeURIComponent(size)}` : `${l.productId}:${qty}`;
    })
    .join(',');
}

/** Reads a bag from a link; anything malformed is skipped, repeated products are merged. */
export function decodeBag(raw: string | null | undefined): BagLine[] {
  if (!raw) return [];
  const byId = new Map<string, BagLine>();
  for (const part of raw.split(',').slice(0, SHARED_BAG_MAX_LINES)) {
    const [id = '', q = '', s = ''] = part.split(':');
    const qty = Number(q);
    if (!ID_RE.test(id) || !Number.isInteger(qty) || qty < 1) continue;
    let size: string;
    try {
      size = decodeURIComponent(s).trim().slice(0, SIZE_MAX);
    } catch {
      size = '';
    }
    const have = byId.get(id);
    if (have) have.qty = Math.min(ORDER_MAX_QTY, have.qty + qty);
    else byId.set(id, { productId: id, qty: Math.min(ORDER_MAX_QTY, qty), size });
  }
  return [...byId.values()];
}

/** Cleans the sender's first name shown to the friend ("Rana sent you her bag"). */
export function cleanSenderName(raw: string | null | undefined): string {
  return [...(raw ?? '')]
    .filter((c) => c.charCodeAt(0) >= 32 && c !== '<' && c !== '>')
    .join('')
    .trim()
    .split(/\s+/)[0]!
    .slice(0, SHARED_BAG_NAME_MAX);
}

/**
 * The friend's bag after adding the shared one: only products still for sale; quantities add up
 * (capped); a size the friend already picked is kept.
 */
export function mergeSharedBag(
  cart: Readonly<Record<string, number>>,
  sizes: Readonly<Record<string, string>>,
  incoming: readonly BagLine[],
  forSale: (productId: string) => boolean,
): { cart: Record<string, number>; sizes: Record<string, string>; added: number } {
  const nextCart = { ...cart };
  const nextSizes = { ...sizes };
  let added = 0;
  for (const l of incoming) {
    if (!forSale(l.productId)) continue;
    nextCart[l.productId] = Math.min(ORDER_MAX_QTY, (nextCart[l.productId] ?? 0) + l.qty);
    if (l.size && !nextSizes[l.productId]) nextSizes[l.productId] = l.size;
    added++;
  }
  return { cart: nextCart, sizes: nextSizes, added };
}
