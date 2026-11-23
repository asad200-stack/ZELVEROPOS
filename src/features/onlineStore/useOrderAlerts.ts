import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { api } from '@/services/functionsClient';
import { newOrderIds, playChime } from './orderAlerts';

const POLL_MS = 45_000;

export interface OrderAlerts {
  /** Orders waiting to be accepted, for the menu badge (null until the first check). */
  pending: number | null;
  /** References of orders that arrived while the owner was on another screen. */
  fresh: string[];
  dismiss: () => void;
}

/**
 * Checks for new website orders on every screen of the app (the inbox can't be listened to
 * directly), so an order isn't missed while the owner is at the till. Rings and remembers the new
 * references; the inbox page rings on its own, so nothing is announced while it is open.
 */
export function useOrderAlerts(enabled: boolean, onInbox: boolean): OrderAlerts {
  const [pending, setPending] = useState<number | null>(null);
  const [fresh, setFresh] = useState<string[]>([]);
  const known = useRef<Set<string> | null>(null);
  const announce = useEffectEvent((refs: string[]) => {
    if (onInbox) return;
    setFresh((cur) => [...cur, ...refs.filter((r) => !cur.includes(r))]);
    playChime();
  });

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await api.onlineOrdersList({ status: 'pending', limit: 50 });
        if (stopped) return;
        const ids = res.orders.map((o) => o.id);
        const added = newOrderIds(known.current, ids);
        known.current = new Set([...(known.current ?? []), ...ids]);
        setPending(res.orders.length);
        if (added.length > 0) announce(res.orders.filter((o) => added.includes(o.id)).map((o) => o.ref));
      } catch {
        // Offline or a hiccup: try again on the next tick.
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);

  // Opening the inbox counts as having seen them.
  const [wasOnInbox, setWasOnInbox] = useState(onInbox);
  if (wasOnInbox !== onInbox) {
    setWasOnInbox(onInbox);
    if (onInbox) setFresh([]);
  }

  // The tab title shows the count so a background tab still catches the eye.
  useEffect(() => {
    if (fresh.length === 0) return;
    const base = document.title.replace(/^\(\d+\)\s*/, '');
    document.title = `(${fresh.length}) ${base}`;
    return () => {
      document.title = document.title.replace(/^\(\d+\)\s*/, '');
    };
  }, [fresh.length]);

  return { pending, fresh, dismiss: () => setFresh([]) };
}
