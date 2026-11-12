import { describe, expect, it } from 'vitest';
import { isSubscriptionActive } from '../../src/contexts/session';
import {
  displayedTrialStatus,
  subscriptionGrantsWrite,
  subscriptionPhase,
  trialChipKind,
  type SubscriptionShape,
} from '../../src/domain/trial';
import type { Subscription } from '../../src/types/models';

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;
const FUTURE = NOW + DAY;
const PAST = NOW - DAY;
const LIFETIME_UNTIL = 4_102_444_800_000;

type AccessCase = {
  name: string;
  sub: SubscriptionShape;
  write: boolean;
  phase: 'inactive' | 'lifetime' | 'active' | 'expired' | 'trial_expired';
  label: string;
  chip: 'hidden' | 'ended' | 'countdown';
};

const cases: AccessCase[] = [
  {
    name: 'active trial with a future end',
    sub: { activated: true, trial: true, status: 'trial', endsAt: FUTURE },
    write: true,
    phase: 'active',
    label: 'trial',
    chip: 'countdown',
  },
  {
    name: 'expired trial with a past end',
    sub: { activated: true, trial: true, status: 'trial', endsAt: PAST },
    write: false,
    phase: 'trial_expired',
    label: 'trial_expired',
    chip: 'ended',
  },
  {
    name: 'active paid subscription',
    sub: { activated: true, trial: false, status: 'active', endsAt: FUTURE },
    write: true,
    phase: 'active',
    label: 'active',
    chip: 'hidden',
  },
  {
    name: 'expired paid subscription',
    sub: { activated: true, trial: false, status: 'active', endsAt: PAST },
    write: false,
    phase: 'expired',
    label: 'expired',
    chip: 'hidden',
  },
  {
    name: 'pending activation kept after admin activation',
    sub: { activated: true, trial: false, lifetime: false, status: 'pending_activation', endsAt: FUTURE },
    write: true,
    phase: 'active',
    label: 'pending_activation',
    chip: 'hidden',
  },
  {
    name: 'closed trial_expired with a future end',
    sub: { activated: true, trial: true, status: 'trial_expired', endsAt: FUTURE },
    write: false,
    phase: 'trial_expired',
    label: 'trial_expired',
    chip: 'ended',
  },
  {
    name: 'closed expired with a future end',
    sub: { activated: true, trial: false, status: 'expired', endsAt: FUTURE },
    write: false,
    phase: 'expired',
    label: 'expired',
    chip: 'hidden',
  },
  {
    name: 'closed inactive with a future end',
    sub: { activated: true, trial: false, status: 'inactive', endsAt: FUTURE },
    write: false,
    phase: 'expired',
    label: 'expired',
    chip: 'hidden',
  },
  {
    name: 'closed canceled with a future end',
    sub: { activated: true, trial: false, status: 'canceled', endsAt: FUTURE },
    write: false,
    phase: 'expired',
    label: 'expired',
    chip: 'hidden',
  },
  {
    name: 'closed cancelled with a future end',
    sub: { activated: true, trial: false, status: 'cancelled', endsAt: FUTURE },
    write: false,
    phase: 'expired',
    label: 'expired',
    chip: 'hidden',
  },
  {
    name: 'activation without an end date or lifetime entitlement',
    sub: { activated: true, lifetime: false, trial: false, status: null, endsAt: null },
    write: false,
    phase: 'expired',
    label: 'expired',
    chip: 'hidden',
  },
  {
    name: 'explicit lifetime entitlement',
    sub: { activated: true, lifetime: true, trial: false, status: null, endsAt: null },
    write: true,
    phase: 'lifetime',
    label: 'lifetime',
    chip: 'hidden',
  },
  {
    name: 'lifetime flag on a closed status',
    sub: { activated: true, lifetime: true, trial: false, status: 'canceled', endsAt: null },
    write: false,
    phase: 'expired',
    label: 'expired',
    chip: 'hidden',
  },
];

function asClient(sub: SubscriptionShape): Subscription {
  return {
    activated: sub?.activated === true,
    lifetime: sub?.lifetime === true,
    startsAt: 0,
    endsAt: typeof sub?.endsAt === 'number' ? sub.endsAt : 0,
    updatedAt: 0,
    trial: sub?.trial,
    status: sub?.status ?? undefined,
  };
}

describe('subscription write access', () => {
  it.each(cases)('$name', async (row) => {
    expect(subscriptionGrantsWrite(row.sub, NOW)).toBe(row.write);
    expect(isSubscriptionActive(asClient(row.sub), NOW)).toBe(row.write);
    expect(subscriptionPhase(row.sub, NOW)).toBe(row.phase);
    expect(trialChipKind(row.sub, NOW)).toBe(row.chip);
    expect(displayedTrialStatus({
      status: row.sub?.status,
      activated: row.sub?.activated,
      lifetime: row.sub?.lifetime,
      trial: row.sub?.trial,
      endsAtMs: typeof row.sub?.endsAt === 'number' ? row.sub.endsAt : null,
    }, NOW)).toBe(row.label);
    if (row.name.includes('paid')) expect(row.label).not.toBe('trial_expired');

    // Import the Admin-free helper — `claims.ts` pulls firebase-admin and timed out in the suite.
    const { LIFETIME_UNTIL: claimLifetimeUntil, subUntilOf } = await import('../../functions/src/subscriptionUntil');
    expect(claimLifetimeUntil).toBe(LIFETIME_UNTIL);
    const liveEnd = typeof row.sub?.endsAt === 'number' ? (row.sub.endsAt > NOW ? Date.now() + DAY : Date.now() - DAY) : null;
    const until = subUntilOf({
      activated: row.sub?.activated === true,
      lifetime: row.sub?.lifetime === true,
      status: row.sub?.status,
      trial: row.sub?.trial === true,
      endsAt: liveEnd === null ? null : { toMillis: () => liveEnd },
    });
    const expectedUntil = !row.write ? 0 : row.sub?.lifetime ? LIFETIME_UNTIL : liveEnd;
    expect(until).toBe(expectedUntil);
    expect(until > Date.now()).toBe(row.write);
  });

  it('does not treat a stored pending status as an expired trial after activation', () => {
    const label = displayedTrialStatus({
      status: 'pending_activation',
      activated: true,
      trial: false,
      endsAtMs: FUTURE,
    }, NOW);
    expect(label).toBe('pending_activation');
    expect(label).not.toBe('trial_expired');
  });
});
