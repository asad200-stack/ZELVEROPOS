const DAY_MS = 86_400_000;

export function trialDaysLeft(endsAt: number | null | undefined, now = Date.now()): number {
  if (!endsAt) return 0;
  return Math.max(0, Math.floor((endsAt - now) / DAY_MS));
}

export type SubscriptionShape = {
  activated?: boolean;
  lifetime?: boolean;
  endsAt?: number | null;
  status?: string | null;
  trial?: boolean;
} | null | undefined;

export type SubscriptionPhase = 'inactive' | 'lifetime' | 'active' | 'expired' | 'trial_expired';

/** Explicitly closed records. `pending_activation` is omitted because activation sets `endsAt` without clearing that status. */
const CLOSED_STATUS = new Set(['trial_expired', 'expired', 'inactive', 'canceled', 'cancelled']);

export function isTrialSubscription(sub: SubscriptionShape): boolean {
  return sub?.trial === true || sub?.status === 'trial' || sub?.status === 'trial_expired';
}

/** Writes require activation plus a lifetime flag or a future end. A closed status blocks both. */
export function subscriptionGrantsWrite(sub: SubscriptionShape, now = Date.now()): boolean {
  if (!sub?.activated) return false;
  if (sub.status && CLOSED_STATUS.has(sub.status)) return false;
  if (sub.lifetime) return true;
  return typeof sub.endsAt === 'number' && sub.endsAt > now;
}

/** Expired trials stay distinct from expired paid subscriptions. Activation alone is not access. */
export function subscriptionPhase(sub: SubscriptionShape, now = Date.now()): SubscriptionPhase {
  if (sub?.lifetime && subscriptionGrantsWrite(sub, now)) return 'lifetime';
  if (subscriptionGrantsWrite(sub, now)) return 'active';
  if (!sub) return 'inactive';
  if (!sub.activated && sub.status !== 'trial_expired' && sub.status !== 'expired') return 'inactive';
  if (isTrialSubscription(sub) || sub.status === 'trial_expired') return 'trial_expired';
  return 'expired';
}

export function trialChipKind(sub: SubscriptionShape, now = Date.now()): 'hidden' | 'ended' | 'countdown' {
  if (!isTrialSubscription(sub)) return 'hidden';
  const phase = subscriptionPhase(sub, now);
  if (phase === 'active') return 'countdown';
  if (phase === 'trial_expired') return 'ended';
  return 'hidden';
}

/**
 * Label for admin lists. Does not write the stored record.
 * A past end on a trial is `trial_expired`; a past end on any other plan is `expired`.
 */
export function displayedTrialStatus(input: {
  status?: unknown;
  activated?: boolean;
  lifetime?: boolean;
  trial?: boolean;
  endsAtMs: number | null;
}, now: number): string {
  const stored = typeof input.status === 'string' && input.status ? input.status : '';
  const phase = subscriptionPhase({
    activated: input.activated,
    lifetime: input.lifetime,
    trial: input.trial === true || stored === 'trial' || stored === 'trial_expired',
    status: stored || null,
    endsAt: input.endsAtMs,
  }, now);
  if (phase === 'trial_expired') return 'trial_expired';
  if (phase === 'expired') return 'expired';
  if (phase === 'inactive' && (!stored || stored === 'pending_activation')) return stored || 'pending_activation';
  if (stored) return stored;
  if (phase === 'lifetime') return 'lifetime';
  if (phase === 'active') return input.trial ? 'trial' : 'active';
  return 'inactive';
}

export function trialChipTone(days: number): 'info' | 'warning' | 'danger' {
  if (days <= 1) return 'danger';
  if (days <= 3) return 'warning';
  return 'info';
}

export function canAccessExpiredTenant(sub: {
  activated?: boolean;
  lifetime?: boolean;
  endsAt?: number | null;
  trial?: boolean;
} | null): boolean {
  if (!sub) return false;
  if (sub.lifetime) return true;
  if (sub.activated && sub.endsAt && sub.endsAt > Date.now()) return true;
  if (sub.endsAt) return true;
  if (sub.trial) return true;
  return false;
}
