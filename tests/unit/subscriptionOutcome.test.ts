import { describe, expect, it } from 'vitest';
import { planSubscriptionUpdate } from '../../functions/src/subscriptionOutcome';

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

describe('subscription administration does not reopen a closed status', () => {
  it('extends an active paid plan and allows writes', () => {
    const result = planSubscriptionUpdate(
      { activated: true, lifetime: false, status: 'active', endsAtMs: NOW + DAY },
      'extend',
      NOW,
      10,
    );
    expect(result.status).toBe('active');
    expect(result.endsAtMs).toBe(NOW + 11 * DAY);
    expect(result).toMatchObject({ writesEnabled: true, closed: false });
  });

  it('extends an active trial and allows writes', () => {
    const result = planSubscriptionUpdate(
      { activated: true, status: 'trial', endsAtMs: NOW + DAY },
      'extend',
      NOW,
      5,
    );
    expect(result).toMatchObject({ status: 'trial', writesEnabled: true, closed: false });
  });

  it('activates a pending subscription without treating it as closed', () => {
    const result = planSubscriptionUpdate(
      { activated: false, status: 'pending_activation', endsAtMs: null },
      'activate',
      NOW,
      15,
    );
    expect(result).toMatchObject({
      status: 'pending_activation',
      activated: true,
      writesEnabled: true,
      closed: false,
      endsAtMs: NOW + 15 * DAY,
    });
  });

  it.each(['trial_expired', 'expired', 'inactive', 'canceled', 'cancelled'] as const)(
    'extend, lifetime, and activate leave %s closed and without writes',
    (status) => {
      for (const action of ['extend', 'lifetime', 'activate'] as const) {
        const result = planSubscriptionUpdate(
          { activated: true, lifetime: false, status, endsAtMs: NOW + DAY },
          action,
          NOW,
          30,
        );
        expect(result.status, action).toBe(status);
        expect(result.writesEnabled, action).toBe(false);
        expect(result.closed, action).toBe(true);
      }
    },
  );

  it('turns access off on deactivate without marking an open status closed', () => {
    const result = planSubscriptionUpdate(
      { activated: true, status: 'active', endsAtMs: NOW + DAY },
      'deactivate',
      NOW,
    );
    expect(result).toMatchObject({ status: 'active', activated: false, writesEnabled: false, closed: false });
  });
});
