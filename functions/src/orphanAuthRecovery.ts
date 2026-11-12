/**
 * Safe recovery for an Auth user left behind when trial provisioning dies after
 * `createUser` and before `platformProvisionState` records `createdByOperation`.
 *
 * This module does not delete users, create tenants, or mark email addresses verified.
 * Provisioning must keep refusing an existing Auth user with `error.fn.trialUnavailable`.
 * Never attach that user to a new tenant.
 *
 * A super admin may delete the Auth user only when `orphanAuthRecoveryBlockers` returns
 * an empty list, and only after reading the same records again inside one transaction:
 * 1. Look the user up by the exact email. Stop if Auth has no such user.
 * 2. Stop when any blocker below is present.
 * 3. Re-read the profile, both trial-index documents, tenant ownership, provision state,
 *    and sales operations inside one transaction.
 * 4. If they are still absent, delete only that Auth user and `platformProvisionState/{uid}`.
 * 5. Ask the customer to submit the trial form again. That creates a new Auth user.
 */
export interface OrphanAuthRecords {
  profileExists: boolean;
  uidTrialIndexExists: boolean;
  emailTrialIndexExists: boolean;
  tenantOwned: boolean;
  provisionReady: boolean;
  salesOpReferencesUid: boolean;
}

export function orphanAuthRecoveryBlockers(records: OrphanAuthRecords): string[] {
  const blockers: string[] = [];
  if (records.profileExists) blockers.push('users profile');
  if (records.uidTrialIndexExists) blockers.push('uid trial index');
  if (records.emailTrialIndexExists) blockers.push('email trial index');
  if (records.tenantOwned) blockers.push('tenant owner');
  if (records.provisionReady) blockers.push('ready provision');
  if (records.salesOpReferencesUid) blockers.push('sales operation');
  return blockers;
}
