import { describe, expect, it } from 'vitest';
import { planTrialExpiry, trialExpiryAuditId, type TrialExpirySnapshot } from '../../functions/src/trialExpiry';

const now = 1_700_000_000_000;
const past = now - 86_400_000;

function snap(extra: Partial<TrialExpirySnapshot> = {}): TrialExpirySnapshot {
  return { status: 'trial', endsAtMs: past, notificationsSent: {}, auditExists: false, noticeExists: false, ...extra };
}

describe('trial expiry transaction plan', () => {
  it('expires once and keeps the end time out of the write', () => {
    const plan = planTrialExpiry(snap(), now);
    expect(plan.newlyExpired).toBe(true);
    expect(plan.createAudit).toBe(true);
    expect(plan.createNotice).toBe(true);
    expect(plan.notificationsSent).toMatchObject({ day15: true });
    expect(JSON.stringify(plan)).not.toContain('endsAt');
    expect(trialExpiryAuditId('life-expired')).toBe('trial_expired_life-expired');
  });

  it('heals an interrupted expiry without a second audit or a replaced notice', () => {
    const missingAudit = planTrialExpiry(snap({
      status: 'trial_expired',
      notificationsSent: { day15: true },
      noticeExists: true,
    }), now);
    expect(missingAudit).toMatchObject({ newlyExpired: false, createAudit: true, createNotice: false, setStatus: false });

    const missingStatus = planTrialExpiry(snap({ auditExists: true }), now);
    expect(missingStatus).toMatchObject({ newlyExpired: true, createAudit: false, createNotice: true });

    const healed = planTrialExpiry(snap({
      status: 'trial_expired',
      notificationsSent: { day15: true },
      auditExists: true,
      noticeExists: true,
    }), now);
    expect(healed.changed).toBe(false);
  });

  it('lets a concurrent caller retry against the committed snapshot', () => {
    const initial = snap();
    const first = planTrialExpiry(initial, now);
    const second = planTrialExpiry(initial, now);
    expect(first.createAudit).toBe(true);
    expect(second.createAudit).toBe(true);
    const afterCommit = planTrialExpiry(snap({
      status: 'trial_expired',
      notificationsSent: { day15: true },
      auditExists: true,
      noticeExists: true,
    }), now);
    expect(afterCommit.changed).toBe(false);
  });

  it('leaves a trial that has not ended unchanged', () => {
    expect(planTrialExpiry(snap({ endsAtMs: now + 1_000 }), now).changed).toBe(false);
  });
});
