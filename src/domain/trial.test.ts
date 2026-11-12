import { describe, expect, it } from 'vitest';
import {
  canAccessExpiredTenant,
  displayedTrialStatus,
  subscriptionGrantsWrite,
  subscriptionPhase,
  trialChipKind,
  trialChipTone,
  trialDaysLeft,
} from './trial';

const DAY = 86_400_000;

describe('trial countdown', () => {
  it('counts remaining full days from the trusted end timestamp', () => {
    const now = 1_700_000_000_000;
    expect(trialDaysLeft(now + 15 * DAY - 1, now)).toBe(14);
    expect(trialDaysLeft(now + 15 * DAY, now)).toBe(15);
    expect(trialDaysLeft(now + 7 * DAY, now)).toBe(7);
    expect(trialDaysLeft(now + 3 * DAY, now)).toBe(3);
    expect(trialDaysLeft(now + 1 * DAY, now)).toBe(1);
    expect(trialDaysLeft(now - 1, now)).toBe(0);
  });

  it('does not use aggressive danger tone until the last days', () => {
    expect(trialChipTone(14)).toBe('info');
    expect(trialChipTone(7)).toBe('info');
    expect(trialChipTone(3)).toBe('warning');
    expect(trialChipTone(1)).toBe('danger');
  });

  it('separates trials, paid plans, pending activation, and inconsistent records', () => {
    const now = 1_700_000_000_000;
    const activeTrial = { activated: true, trial: true, status: 'trial', endsAt: now + DAY };
    const expiredTrial = { activated: true, trial: true, status: 'trial', endsAt: now - DAY };
    const activePaid = { activated: true, trial: false, status: 'active', endsAt: now + DAY };
    const expiredPaid = { activated: true, trial: false, status: 'active', endsAt: now - DAY };
    const pending = { activated: false, trial: true, status: 'pending_activation', endsAt: null };
    const activatedOnly = { activated: true, lifetime: false, endsAt: null, status: null };
    const stalePending = { activated: true, trial: true, status: 'pending_activation', endsAt: now + DAY };
    const closedButFuture = { activated: true, trial: true, status: 'trial_expired', endsAt: now + DAY };

    expect(subscriptionPhase(activeTrial, now)).toBe('active');
    expect(trialChipKind(activeTrial, now)).toBe('countdown');
    expect(subscriptionGrantsWrite(activeTrial, now)).toBe(true);
    expect(displayedTrialStatus({ status: 'trial', activated: true, trial: true, endsAtMs: now + DAY }, now)).toBe('trial');

    expect(subscriptionPhase(expiredTrial, now)).toBe('trial_expired');
    expect(trialChipKind(expiredTrial, now)).toBe('ended');
    expect(subscriptionGrantsWrite(expiredTrial, now)).toBe(false);
    expect(displayedTrialStatus({ status: 'trial', activated: true, trial: true, endsAtMs: now - DAY }, now)).toBe('trial_expired');

    expect(subscriptionPhase(activePaid, now)).toBe('active');
    expect(trialChipKind(activePaid, now)).toBe('hidden');
    expect(subscriptionGrantsWrite(activePaid, now)).toBe(true);
    expect(displayedTrialStatus({ status: 'active', activated: true, trial: false, endsAtMs: now + DAY }, now)).toBe('active');

    expect(subscriptionPhase(expiredPaid, now)).toBe('expired');
    expect(trialChipKind(expiredPaid, now)).toBe('hidden');
    expect(subscriptionGrantsWrite(expiredPaid, now)).toBe(false);
    expect(displayedTrialStatus({ status: 'active', activated: true, trial: false, endsAtMs: now - DAY }, now)).toBe('expired');

    expect(subscriptionPhase(pending, now)).toBe('inactive');
    expect(trialChipKind(pending, now)).toBe('hidden');
    expect(subscriptionGrantsWrite(pending, now)).toBe(false);
    expect(displayedTrialStatus({ status: 'pending_activation', activated: false, trial: true, endsAtMs: null }, now)).toBe('pending_activation');

    expect(subscriptionGrantsWrite(activatedOnly, now)).toBe(false);
    expect(subscriptionPhase(activatedOnly, now)).toBe('expired');
    expect(subscriptionGrantsWrite(stalePending, now)).toBe(true);
    expect(subscriptionPhase(closedButFuture, now)).toBe('trial_expired');
    expect(subscriptionGrantsWrite(closedButFuture, now)).toBe(false);
    expect(displayedTrialStatus({ status: 'trial_expired', activated: true, trial: true, endsAtMs: now + DAY }, now)).toBe('trial_expired');
    expect(displayedTrialStatus({ status: 'expired', activated: true, trial: false, endsAtMs: now + DAY }, now)).toBe('expired');
  });

  it('keeps expired trial stores accessible read-only', () => {
    expect(canAccessExpiredTenant({ activated: true, trial: true, endsAt: Date.now() - DAY })).toBe(true);
    expect(canAccessExpiredTenant({ activated: false, lifetime: false, endsAt: null, trial: false })).toBe(false);
  });
});
