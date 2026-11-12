/** Stable audit id so two lifecycle runs cannot insert two expiry records for one tenant. */
export function trialExpiryAuditId(tenantId: string): string {
  return `trial_expired_${tenantId}`;
}

export interface TrialExpirySnapshot {
  status?: string;
  endsAtMs: number;
  notificationsSent?: Record<string, boolean>;
  auditExists: boolean;
  noticeExists: boolean;
}

export interface TrialExpiryPlan {
  changed: boolean;
  newlyExpired: boolean;
  setStatus: boolean;
  notificationsSent?: Record<string, boolean>;
  createAudit: boolean;
  createNotice: boolean;
}

const UNCHANGED: TrialExpiryPlan = {
  changed: false,
  newlyExpired: false,
  setStatus: false,
  createAudit: false,
  createNotice: false,
};

/**
 * Decides the expiry transaction from one consistent read.
 * End timestamps are never part of the write. A second plan after the first
 * plan is applied does not create another audit or replace an existing notice.
 */
export function planTrialExpiry(input: TrialExpirySnapshot, now: number): TrialExpiryPlan {
  if (!input.endsAtMs || now < input.endsAtMs) return UNCHANGED;
  const sent = input.notificationsSent ?? {};
  const alreadyExpired = input.status === 'trial_expired';
  const setStatus = !alreadyExpired;
  const createAudit = !input.auditExists;
  const createNotice = !input.noticeExists;
  const notificationsSent = createNotice && !sent.day15 ? { ...sent, day15: true } : undefined;
  if (!setStatus && !createAudit && !createNotice && !notificationsSent) return UNCHANGED;
  return {
    changed: true,
    newlyExpired: setStatus,
    setStatus,
    ...(notificationsSent ? { notificationsSent } : {}),
    createAudit,
    createNotice,
  };
}
