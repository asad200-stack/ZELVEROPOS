/**
 * Shopper accounts on the shop websites (optional: guests can still order).
 *
 * Pure rules shared by the storefront and the Cloud Functions (copied by copy-shared.mjs): what a
 * saved profile may hold, the wishlist limit, and which lines of a past order can be ordered again.
 */
import { ORDER_ADDRESS_MAX, ORDER_NAME_MAX, type OrderStatus } from './onlineOrders';

/** Most favourites kept per shop in an account. */
export const SHOPPER_WISHLIST_MAX = 200;
/** Most past orders shown in "My orders". */
export const SHOPPER_ORDERS_MAX = 50;

export interface ShopperProfile {
  name: string;
  phone: string;
  address: string;
}

export const EMPTY_SHOPPER_PROFILE: ShopperProfile = { name: '', phone: '', address: '' };

/** One past order as the shopper sees it in "My orders". */
export interface ShopperOrder {
  ref: string;
  status: OrderStatus;
  fulfillment: 'delivery' | 'pickup';
  createdAtMs: number;
  totalUsdCents: number;
  totalLbp: number;
  lines: { productId: string; name: string; qty: number }[];
}

export interface ShopperAccountView {
  profile: ShopperProfile;
  wishlist: string[];
  orders: ShopperOrder[];
}

const clip = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Cleans a saved profile (trimmed, length-capped; unknown fields dropped). */
export function cleanShopperProfile(raw: unknown): ShopperProfile {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return { name: clip(r.name, ORDER_NAME_MAX), phone: clip(r.phone, 40), address: clip(r.address, ORDER_ADDRESS_MAX) };
}

/** Unique product ids, first occurrence kept, capped at SHOPPER_WISHLIST_MAX. */
export function cleanWishlist(ids: readonly unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= SHOPPER_WISHLIST_MAX) break;
  }
  return out;
}

/** Favourites from this browser and from the account together (account first). */
export function mergeWishlists(account: readonly string[], local: readonly string[]): string[] {
  return cleanWishlist([...account, ...local]);
}

/**
 * Lines of a past order that can go back in the bag: products still on the website and in stock.
 * The server re-checks prices and stock when the order is placed.
 */
export function orderAgainLines(
  order: Pick<ShopperOrder, 'lines'>,
  available: (productId: string) => boolean,
): { productId: string; qty: number }[] {
  const qty = new Map<string, number>();
  for (const l of order.lines) {
    if (!available(l.productId) || l.qty <= 0) continue;
    qty.set(l.productId, (qty.get(l.productId) ?? 0) + l.qty);
  }
  return [...qty.entries()].map(([productId, n]) => ({ productId, qty: n }));
}

/** Fills empty checkout fields from the saved profile; never overwrites what the shopper typed. */
export function prefillCheckout(current: ShopperProfile, saved: ShopperProfile): ShopperProfile {
  return {
    name: current.name.trim() ? current.name : saved.name,
    phone: current.phone.trim() ? current.phone : saved.phone,
    address: current.address.trim() ? current.address : saved.address,
  };
}
