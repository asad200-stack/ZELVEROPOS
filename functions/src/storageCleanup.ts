export interface CleanupRecord {
  tenantId?: unknown;
  prefix?: unknown;
  accountDeleted?: unknown;
  storageCleanup?: unknown;
  ownerUid?: unknown;
  memberUids?: unknown;
  subdomain?: unknown;
  lastOutcome?: unknown;
  updatedAt?: unknown;
  lastAttemptAt?: unknown;
}

export type CleanupDecision =
  | { action: 'delete'; prefix: string }
  | { action: 'complete' }
  | { action: 'pending' }
  | { action: 'reject' };

export type AbsenceVerdict = 'absent' | 'present' | 'ambiguous';

export type CleanupOutcome = 'complete' | 'storage-failed' | 'account-remains' | 'unverified';

export interface AbsenceEvidence {
  tenantDocExists: boolean;
  tenantSubcollectionCount: number | null;
  storeDocExists: boolean;
  subscriptionDocExists: boolean;
  subdomainDocExists: boolean;
  usersWithTenant: number | null;
  userDocExists: Record<string, boolean>;
  /** `null` means the Auth lookup failed and absence is not proven. */
  authUserExists: Record<string, boolean | null>;
}

export interface CleanupAttention {
  tenantId: string;
  storageCleanup: 'pending';
  lastOutcome: Exclude<CleanupOutcome, 'complete'> | null;
  updatedAt: number | null;
  lastAttemptAt: number | null;
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const SUBDOMAIN = /^[A-Za-z0-9-]{1,64}$/;
const PREFIX = /^tenants\/([A-Za-z0-9_-]{1,128})\/$/;

export interface DescribedMembers {
  ownerUid: string;
  memberUids: string[];
  subdomain: string;
}

/**
 * A cleanup document reserves its tenant id. Pending and completed deletions both block
 * provisioning. The document is not deleted when cleanup finishes, and nothing in the
 * product clears it. Reuse needs a separate authorized workflow.
 *
 * Legacy records without `memberUids` stay unverified: retry will not delete their files.
 * Manual recovery, from an Admin SDK session, is:
 * 1. Read `platformStorageCleanup/{tenantId}` and stop unless `prefix` is exactly `tenants/{tenantId}/`.
 * 2. From audit logs or the original deletion record, list the Auth uids that belonged to that tenant.
 *    Stop if those uids were never recorded. Do not invent replacements.
 * 3. Confirm each uid is `auth/user-not-found`, `users/{uid}` is absent, no user has that `tenantId`,
 *    and `tenants/{tenantId}` (including subcollections), `stores/{tenantId}`, `subscriptions/{tenantId}`,
 *    and `storeSubdomains/{subdomain}` are absent.
 * 4. Delete only `tenants/{tenantId}/` in Storage, then set `storageCleanup` to `complete` on that same
 *    document. Leave the document in place so the tenant id stays reserved.
 */
export function tenantIdReserved(record: CleanupRecord | undefined): boolean {
  return record !== undefined;
}

/**
 * A retry may delete storage only when this record proves the account is already gone
 * and the stored prefix is exactly `tenants/{that tenant id}/`.
 */
export function decideStorageCleanup(tenantId: string, record: CleanupRecord | undefined): CleanupDecision {
  if (!record) return { action: 'reject' };
  if (record.storageCleanup === 'complete') return { action: 'complete' };
  if (record.accountDeleted !== true) return { action: 'pending' };
  const prefix = provenTenantPrefix(tenantId, record);
  if (!prefix) return { action: 'reject' };
  return { action: 'delete', prefix };
}

export function tenantStoragePrefix(tenantId: string): string | null {
  if (!ID.test(tenantId)) return null;
  return `tenants/${tenantId}/`;
}

/** The only prefix a retry may remove. It is derived from the tenant id, never from the caller. */
export function provenTenantPrefix(tenantId: string, record: CleanupRecord | undefined): string | null {
  if (!record || record.tenantId !== tenantId) return null;
  const prefix = tenantStoragePrefix(tenantId);
  if (!prefix || record.prefix !== prefix) return null;
  const match = PREFIX.exec(prefix);
  if (!match || match[1] !== tenantId) return null;
  return prefix;
}

/**
 * Identities captured before deletion. A missing or malformed list means Auth absence
 * cannot be checked, so recovery must stop.
 */
export function describedMembers(record: CleanupRecord | undefined): DescribedMembers | null {
  if (!record) return null;
  const ownerUid = typeof record.ownerUid === 'string' ? record.ownerUid : '';
  if (!ID.test(ownerUid) || typeof record.subdomain !== 'string') return null;
  if (record.subdomain !== '' && !SUBDOMAIN.test(record.subdomain)) return null;
  if (!Array.isArray(record.memberUids) || record.memberUids.length === 0 || record.memberUids.length > 1000) return null;
  const memberUids: string[] = [];
  for (const uid of record.memberUids) {
    if (typeof uid !== 'string' || !ID.test(uid) || memberUids.includes(uid)) return null;
    memberUids.push(uid);
  }
  if (!memberUids.includes(ownerUid)) return null;
  return { ownerUid, memberUids, subdomain: record.subdomain };
}

/** Firestore user documents that the deletion flow removes for this tenant. */
export function requiredUserDocs(tenantId: string, memberUids: readonly string[]): string[] {
  return memberUids.includes(tenantId) ? [...memberUids] : [...memberUids, tenantId];
}

/**
 * `absent` only when every Auth user and Firestore record the deletion flow removes is gone.
 * A lookup failure or a record that does not name those users is `ambiguous`.
 */
export function judgeAccountAbsence(tenantId: string, record: CleanupRecord | undefined, evidence: AbsenceEvidence): AbsenceVerdict {
  if (!provenTenantPrefix(tenantId, record)) return 'ambiguous';
  const members = describedMembers(record);
  if (!members || evidence.tenantSubcollectionCount === null || evidence.usersWithTenant === null) return 'ambiguous';
  for (const uid of members.memberUids) {
    if (!(uid in evidence.authUserExists)) return 'ambiguous';
    const auth = evidence.authUserExists[uid];
    if (auth == null) return 'ambiguous';
    if (auth) return 'present';
  }
  for (const uid of requiredUserDocs(tenantId, members.memberUids)) {
    if (!(uid in evidence.userDocExists)) return 'ambiguous';
    if (evidence.userDocExists[uid]) return 'present';
  }
  if (evidence.usersWithTenant > 0) return 'present';
  if (evidence.tenantDocExists || evidence.tenantSubcollectionCount > 0) return 'present';
  if (evidence.storeDocExists || evidence.subscriptionDocExists) return 'present';
  if (members.subdomain && evidence.subdomainDocExists) return 'present';
  return 'absent';
}

function millis(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'object' && value !== null && 'toMillis' in value && typeof value.toMillis === 'function') {
    return value.toMillis();
  }
  return null;
}

/** Pending rows for the Super Admin list. Completed records and stored prefixes are omitted. */
export function cleanupAttention(id: string, data: CleanupRecord | undefined): CleanupAttention | null {
  if (!data || data.storageCleanup !== 'pending' || data.tenantId !== id || !ID.test(id)) return null;
  const outcome = data.lastOutcome;
  const lastOutcome = outcome === 'storage-failed' || outcome === 'account-remains' || outcome === 'unverified' ? outcome : null;
  return {
    tenantId: id,
    storageCleanup: 'pending',
    lastOutcome,
    updatedAt: millis(data.updatedAt),
    lastAttemptAt: millis(data.lastAttemptAt),
  };
}
