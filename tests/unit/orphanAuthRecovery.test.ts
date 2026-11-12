import { describe, expect, it } from 'vitest';
import { orphanAuthRecoveryBlockers, type OrphanAuthRecords } from '../../functions/src/orphanAuthRecovery';

const clear: OrphanAuthRecords = {
  profileExists: false,
  uidTrialIndexExists: false,
  emailTrialIndexExists: false,
  tenantOwned: false,
  provisionReady: false,
  salesOpReferencesUid: false,
};

describe('orphan Auth recovery', () => {
  it('allows a delete only when no profile, tenant, or successful provision exists', () => {
    expect(orphanAuthRecoveryBlockers(clear)).toEqual([]);
  });

  it('blocks recovery when any owning record exists', () => {
    for (const key of Object.keys(clear) as (keyof OrphanAuthRecords)[]) {
      expect(orphanAuthRecoveryBlockers({ ...clear, [key]: true }).length).toBeGreaterThan(0);
    }
  });
});
