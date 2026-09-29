import { useCallback, useEffect, useState } from 'react';
import { STORAGE_KEYS } from '@/constants/app';
import type { Cart } from '@/domain/cart';
import { paths } from '@/services/db';
import type { Currency } from '@/types/models';
import { PRICE_TIERS } from '@/types/models';

export const MAX_CARTS = 10;

function newCart(tenantId: string, currency: Currency, id: string): Cart {
  return {
    id,
    tier: 'retail',
    currency,
    customerId: null,
    lines: [],
    debtLineUsdCents: null,
    saleId: paths.newId(tenantId, 'sales'),
  };
}

function isCart(value: unknown): value is Cart {
  const c = value as Cart;
  return (
    !!c &&
    typeof c.id === 'string' &&
    typeof c.saleId === 'string' &&
    Array.isArray(c.lines) &&
    PRICE_TIERS.includes(c.tier) &&
    (c.currency === 'USD' || c.currency === 'LBP')
  );
}

interface PosState {
  carts: Cart[];
  active: number;
}

function load(tenantId: string, currency: Currency): PosState {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.cart(tenantId));
    if (raw) {
      const parsed = JSON.parse(raw) as PosState;
      const carts = Array.isArray(parsed.carts) ? parsed.carts.filter(isCart).slice(0, MAX_CARTS) : [];
      if (carts.length) return { carts, active: Math.min(Math.max(0, Number(parsed.active) || 0), carts.length - 1) };
    }
  } catch {
    /* corrupted storage: start fresh */
  }
  return { carts: [newCart(tenantId, currency, '1')], active: 0 };
}

/** Up to 10 parallel carts (held orders), persisted locally so a reload never loses a sale. */
export function usePosCarts(tenantId: string, defaultCurrency: Currency) {
  const [state, setState] = useState<PosState>(() => load(tenantId, defaultCurrency));

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.cart(tenantId), JSON.stringify(state));
    } catch {
      /* storage full: carts still work in memory */
    }
  }, [tenantId, state]);

  const cart = state.carts[state.active];

  const update = useCallback((fn: (cart: Cart) => Cart) => {
    setState((s) => {
      const carts = s.carts.slice();
      carts[s.active] = fn(carts[s.active]);
      return { ...s, carts };
    });
  }, []);

  const addCart = useCallback(() => {
    setState((s) => {
      if (s.carts.length >= MAX_CARTS) return s;
      const used = new Set(s.carts.map((c) => c.id));
      let n = 1;
      while (used.has(String(n))) n++;
      return { carts: [...s.carts, newCart(tenantId, defaultCurrency, String(n))], active: s.carts.length };
    });
  }, [tenantId, defaultCurrency]);

  const removeCart = useCallback(
    (index: number) => {
      setState((s) => {
        if (s.carts.length <= 1) return { carts: [newCart(tenantId, defaultCurrency, '1')], active: 0 };
        const carts = s.carts.filter((_, i) => i !== index);
        return { carts, active: Math.min(s.active > index ? s.active - 1 : s.active, carts.length - 1) };
      });
    },
    [tenantId, defaultCurrency],
  );

  const setActive = useCallback((index: number) => setState((s) => ({ ...s, active: index })), []);

  /** Clears the active cart after a completed sale and issues a NEW idempotency key. */
  const resetActive = useCallback(() => {
    setState((s) => {
      const carts = s.carts.slice();
      const current = carts[s.active];
      carts[s.active] = { ...newCart(tenantId, current.currency, current.id), tier: current.tier };
      return { ...s, carts };
    });
  }, [tenantId]);

  return { carts: state.carts, active: state.active, cart, update, addCart, removeCart, setActive, resetActive };
}
