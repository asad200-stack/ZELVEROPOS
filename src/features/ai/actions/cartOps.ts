import { addProductToCart, type Cart } from '@/domain/cart';
import type { Product } from '@/types/models';
import { getPosCartHost } from './cartBridge';

import { isExecuteCartAdd, isExecuteCartRemove } from './operatorIntent';

export function isCartAddRequest(text: string): boolean {
  return isExecuteCartAdd(text);
}

export function isCartRemoveRequest(text: string): boolean {
  return isExecuteCartRemove(text);
}

export function parseCartQuantity(text: string, fallback = 1): number {
  const m =
    text.match(/\b(\d+)\s*(?:x|×|pcs?|units?|more)?\b/i) ||
    text.match(/(?:كمية|قطع)?\s*(\d+)/) ||
    text.match(/\b(one|two|three|four|five)\b/i);
  if (!m?.[1]) return fallback;
  const word: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  const key = m[1].toLowerCase();
  if (word[key] != null) return word[key]!;
  return Math.max(1, Math.min(99999, Math.floor(Number(m[1])) || fallback));
}

export function cartAdd(product: Product, quantity: number): { ok: true; cart: Cart } | { ok: false; reason: 'no-host' } {
  const host = getPosCartHost();
  if (!host) return { ok: false, reason: 'no-host' };
  let next: Cart | null = null;
  host.update((cart) => {
    next = addProductToCart(cart, product, quantity);
    return next;
  });
  return { ok: true, cart: next ?? host.getCart() };
}

export function cartAdjust(productId: string, delta: number): { ok: true; cart: Cart } | { ok: false; reason: 'no-host' | 'not-found' } {
  const host = getPosCartHost();
  if (!host) return { ok: false, reason: 'no-host' };
  const cart = host.getCart();
  const idx = cart.lines.findIndex((line) => line.productId === productId && !line.imei);
  if (idx < 0) return { ok: false, reason: 'not-found' };
  let next: Cart | null = null;
  host.update((current) => {
    const lines = current.lines.slice();
    const line = lines[idx]!;
    const quantity = line.quantity + delta;
    if (quantity <= 0) lines.splice(idx, 1);
    else lines[idx] = { ...line, quantity };
    next = { ...current, lines };
    return next;
  });
  return { ok: true, cart: next ?? host.getCart() };
}

export function cartRemoveOne(productId: string): ReturnType<typeof cartAdjust> {
  return cartAdjust(productId, -1);
}
