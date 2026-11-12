import { subscriptionGrantsWrite } from './shared/trial.js';

const DAY_MS = 86_400_000;
const CLOSED_STATUS = new Set(['trial_expired', 'expired', 'inactive', 'canceled', 'cancelled']);

export type SubscriptionActionName = 'activate' | 'extend' | 'lifetime' | 'deactivate';

export interface SubscriptionSnapshot {
  activated?: boolean;
  lifetime?: boolean;
  status?: string | null;
  endsAtMs?: number | null;
}

/** What the subscription document will contain, and whether that state allows writes. Status is never reopened. */
export function planSubscriptionUpdate(
  current: SubscriptionSnapshot,
  action: SubscriptionActionName,
  now: number,
  days = 0,
): { ok: true; writesEnabled: boolean; closed: boolean; status: string | null; activated: boolean; lifetime: boolean; endsAtMs: number | null } {
  const status = typeof current.status === 'string' && current.status ? current.status : null;
  const closed = status != null && CLOSED_STATUS.has(status);
  let endsAtMs = typeof current.endsAtMs === 'number' ? current.endsAtMs : null;
  let activated: boolean;
  let lifetime: boolean;

  if (action === 'activate') {
    activated = true;
    lifetime = false;
    endsAtMs = now + days * DAY_MS;
  } else if (action === 'extend') {
    activated = true;
    lifetime = false;
    const from = Math.max(now, endsAtMs ?? 0);
    endsAtMs = from + days * DAY_MS;
  } else if (action === 'lifetime') {
    activated = true;
    lifetime = true;
  } else {
    activated = false;
    lifetime = false;
  }

  const writesEnabled = subscriptionGrantsWrite({ activated, lifetime, status, endsAt: endsAtMs }, now);
  return { ok: true, writesEnabled, closed, status, activated, lifetime, endsAtMs };
}
