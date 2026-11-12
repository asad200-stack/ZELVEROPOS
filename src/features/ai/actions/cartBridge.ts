import type { Cart } from '@/domain/cart';

export interface PosCartHost {
  getCart: () => Cart;
  update: (fn: (cart: Cart) => Cart) => void;
}

let host: PosCartHost | null = null;

export function registerPosCartHost(next: PosCartHost): void {
  host = next;
}

export function unregisterPosCartHost(current?: PosCartHost): void {
  if (!current || host === current) host = null;
}

export function getPosCartHost(): PosCartHost | null {
  return host;
}
