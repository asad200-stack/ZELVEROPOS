import { subscriptionGrantsWrite } from './shared/trial.js';

/** Claim value used for lifetime subscriptions (2100-01-01). Kept here so unit tests need no Admin. */
export const LIFETIME_UNTIL = 4_102_444_800_000;

type TimestampLike = { toMillis?: () => number };

/** Firestore subscription fields needed to compute write entitlement end. */
export type SubscriptionUntilInput = {
  activated?: unknown;
  lifetime?: unknown;
  status?: unknown;
  trial?: unknown;
  endsAt?: TimestampLike | number | null;
} | null | undefined;

/** Milliseconds until which the tenant may write (0 = not subscribed). */
export function subUntilOf(sub: SubscriptionUntilInput): number {
  const endsAt = sub?.endsAt;
  const endsAtMs = typeof endsAt === 'number' ? endsAt : typeof endsAt?.toMillis === 'function' ? endsAt.toMillis() : null;
  const plain = {
    activated: sub?.activated === true,
    lifetime: sub?.lifetime === true,
    status: typeof sub?.status === 'string' ? sub.status : null,
    trial: sub?.trial === true,
    endsAt: endsAtMs,
  };
  if (!subscriptionGrantsWrite(plain)) return 0;
  if (plain.lifetime) return LIFETIME_UNTIL;
  return endsAtMs ?? 0;
}
