import { describe, expect, it } from 'vitest';
import { displayedTrialStatus, publicTrialResult, trialDeliveryAllowed, trialSignupAllowed } from '../../functions/src/trialAccess';
import { verificationEmailConfigured } from '../../functions/src/verificationEmail';

describe('trial provisioning stays closed without a mailbox provider', () => {
  it('has no verification email provider', () => {
    expect(verificationEmailConfigured()).toBe(false);
    expect(trialDeliveryAllowed('owner@example.com')).toBe(false);
    expect(trialDeliveryAllowed('owner@zelvero.test')).toBe(true);
  });

  it('lets staging create only reserved test trials', () => {
    expect(trialSignupAllowed('staging', 'owner@example.com')).toBe(false);
    expect(trialSignupAllowed('staging', 'owner@zelvero.test')).toBe(true);
    expect(trialSignupAllowed('off', 'owner@zelvero.test')).toBe(false);
    expect(trialSignupAllowed('on', 'owner@example.com')).toBe(true);
  });

  it('labels an activated past-end trial as expired before the sweep updates status', () => {
    const now = 1_700_000_000_000;
    expect(displayedTrialStatus({ status: 'trial', activated: true, trial: true, endsAtMs: now - 1 }, now)).toBe('trial_expired');
    expect(displayedTrialStatus({ status: 'trial', activated: true, trial: true, endsAtMs: now + 1 }, now)).toBe('trial');
    expect(displayedTrialStatus({ status: 'active', activated: true, trial: false, endsAtMs: now - 1 }, now)).toBe('expired');
    expect(displayedTrialStatus({ status: 'pending_activation', activated: false, endsAtMs: null }, now)).toBe('pending_activation');
  });

  it('drops auth and tenant ids from the public trial response', () => {
    const result = publicTrialResult({
      ok: true,
      uid: 'uid-secret',
      tenantId: 't-secret',
      leadId: 'lead-secret',
      trialEndsAt: 123,
      referralAccepted: true,
      resumable: false,
    });
    expect(result).toEqual({ ok: true, referralAccepted: true, resumable: false });
    expect(JSON.stringify(result)).not.toContain('uid-secret');
    expect(JSON.stringify(result)).not.toContain('t-secret');
    expect(JSON.stringify(result)).not.toContain('lead-secret');
  });
});
