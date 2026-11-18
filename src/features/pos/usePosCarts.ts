import { useCallback, useEffect, useState } from 'react';
import { STORAGE_KEYS } from '@/constants/app';
import { emptyCartDraft, normalizeCart, type Cart } from '@/domain/cart';
import { paths } from '@/services/db';
import type { Currency } from '@/types/models';
import { PRICE_TIERS } from '@/types/models';

export const MAX_CARTS = 10;

function newCart(tenantId: string, currency: Currency, id: string): Cart {
  return normalizeCart({
    id,
    label: '',
    note: '',
    tier: 'retail',
    currency,
    customerId: null,
    lines: [],
    debtLineUsdCents: null,
    checkoutDiscountUsdCents: 0,
    checkoutDiscountKind: null,
    saleId: paths.newId(tenantId, 'sales'),
    draft: emptyCartDraft(),
  });
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
  /** Storage key the carts belong to; carts are never carried over to another user or store. */
  key: string;
  carts: Cart[];
  active: number;
}

export function load(tenantId: string, uid: string, currency: Currency): PosState {
  const key = STORAGE_KEYS.cart(tenantId, uid);
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as PosState;
      const carts = Array.isArray(parsed.carts) ? parsed.carts.filter(isCart).slice(0, MAX_CARTS).map(normalizeCart) : [];
      if (carts.length) return { key, carts, active: Math.min(Math.max(0, Number(parsed.active) || 0), carts.length - 1) };
    }
  } catch {
    /* corrupted storage: start fresh */
  }
  return { key, carts: [newCart(tenantId, currency, '1')], active: 0 };
}

/** Up to 10 parallel carts (held orders), persisted locally per user so a reload never loses a sale. */
export function usePosCarts(tenantId: string, uid: string, defaultCurrency: Currency) {
  const key = STORAGE_KEYS.cart(tenantId, uid);
  const [loaded, setState] = useState<PosState>(() => load(tenantId, uid, defaultCurrency));
  const state = loaded.key === key ? loaded : load(tenantId, uid, defaultCurrency);
  if (state !== loaded) setState(state);

  useEffect(() => {
    try {
      localStorage.setItem(state.key, JSON.stringify({ carts: state.carts, active: state.active }));
    } catch {
      /* storage full: carts still work in memory */
    }
  }, [state]);

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
      return { ...s, carts: [...s.carts, newCart(tenantId, defaultCurrency, String(n))], active: s.carts.length };
    });
  }, [tenantId, defaultCurrency]);

  const removeCart = useCallback(
    (index: number) => {
      setState((s) => {
        if (s.carts.length <= 1) return { ...s, carts: [newCart(tenantId, defaultCurrency, '1')], active: 0 };
        const carts = s.carts.filter((_, i) => i !== index);
        return { ...s, carts, active: Math.min(s.active > index ? s.active - 1 : s.active, carts.length - 1) };
      });
    },
    [tenantId, defaultCurrency],
  );

  const setActive = useCallback((index: number) => setState((s) => ({ ...s, active: index })), []);

  const renameCart = useCallback((id: string, label: string) => {
    const next = label.trim().slice(0, 40);
    setState((s) => ({ ...s, carts: s.carts.map((c) => (c.id === id ? { ...c, label: next } : c)) }));
  }, []);

  /** Clears the active cart after a completed sale and issues a NEW idempotency key. */
  const resetActive = useCallback(() => {
    setState((s) => {
      const carts = s.carts.slice();
      const current = carts[s.active];
      carts[s.active] = { ...newCart(tenantId, current.currency, current.id), tier: current.tier };
      return { ...s, carts };
    });
  }, [tenantId]);

  /**
   * Opens `content` in the active cart if it is empty, otherwise in a new cart, always with a NEW
   * idempotency key. Returns false (nothing changed) when every cart slot is taken.
   */
  const openInCart = useCallback(
    (content: Pick<Cart, 'tier' | 'currency' | 'customerId' | 'lines' | 'debtLineUsdCents'> & Partial<Pick<Cart, 'label' | 'note'>>): boolean => {
      const s = state;
      const current = s.carts[s.active];
      if (current && current.lines.length === 0) {
        const carts = s.carts.slice();
        carts[s.active] = { ...newCart(tenantId, content.currency, current.id), ...content };
        setState({ ...s, carts });
        return true;
      }
      if (s.carts.length >= MAX_CARTS) return false;
      const used = new Set(s.carts.map((c) => c.id));
      let n = 1;
      while (used.has(String(n))) n++;
      setState({ ...s, carts: [...s.carts, { ...newCart(tenantId, content.currency, String(n)), ...content }], active: s.carts.length });
      return true;
    },
    [tenantId, state],
  );

  return { carts: state.carts, active: state.active, cart, update, addCart, removeCart, setActive, renameCart, resetActive, openInCart };
}
