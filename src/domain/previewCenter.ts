/**
 * Super Admin preview rules. Feature flags are not frontend versions.
 * A draft records a build. Customers move only when a store is explicitly selected.
 */
import { isEligibleCustomer, type CustomerAccount } from './featureRelease';

export interface FrontendDelivery {
  /** Store-specific pin. Null when this store was not selected. */
  assignedVersion: string | null;
  /** Approved default for stores with no pin. */
  productionVersion: string | null;
  paused: boolean;
}

/** The version a store is allowed to run. A testing build is never used here. */
export function deliveredFrontendVersion(input: FrontendDelivery): string | null {
  if (input.assignedVersion) return input.assignedVersion;
  if (input.paused) return null;
  return input.productionVersion;
}

export function eligibleCustomerTenantIds(accounts: CustomerAccount[], now: number): string[] {
  return accounts.filter((account) => isEligibleCustomer(account, now)).map((account) => account.tenantId);
}

/** Selected stores, or every eligible customer store. The internal demo store is never included. */
export function releaseTargetIds(eligibleIds: string[], selectedIds: string[], allEligible: boolean): string[] {
  if (allEligible) return [...eligibleIds];
  const allowed = new Set(eligibleIds);
  return selectedIds.filter((id) => allowed.has(id));
}

/** A preview draft names one immutable build and targets nobody. */
export function draftReleaseRecord(input: { version: string; title: string; description: string; buildId: string }) {
  return {
    version: input.version.trim(),
    title: input.title.trim(),
    notes: input.description.trim(),
    buildId: input.buildId.trim(),
    status: 'draft' as const,
    targetType: 'none' as const,
    targetTenantIds: [] as string[],
  };
}
