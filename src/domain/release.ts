/**
 * Release-management rules. Framework-free so Cloud Functions can share this file.
 * V1 targeting is store/tenant only — never a user id.
 */

export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

export const RELEASE_STATUSES = ['draft', 'testing', 'ready', 'pilot', 'released', 'paused', 'rolled_back'] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

export const RELEASE_TYPES = ['patch', 'minor', 'major'] as const;
export type ReleaseType = (typeof RELEASE_TYPES)[number];

export const TARGET_TYPES = ['none', 'tenants', 'everyone'] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

export const CURRENT_API_COMPAT = 1;
export const CURRENT_OFFLINE_SCHEMA = 1;

/** Production frozen by the owner on 2026-11-25: every store runs 1.0.0. */
export const FROZEN_PRODUCTION_VERSION: string | null = '1.0.0';

export const PUBLIC_APP_PATHS = [
  '/login',
  '/signup',
  '/forgot-password',
  '/verify-email',
  '/auth/action',
  '/setup',
] as const;

export function isValidVersion(value: string): boolean {
  return SEMVER.test(String(value ?? '').trim());
}

export function parseSemver(value: string): { major: number; minor: number; patch: number; prerelease: string } | null {
  const raw = String(value ?? '').trim();
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/.exec(raw);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), prerelease: m[4] ?? '' };
}

export function compareSemver(a: string, b: string): number {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) return 0;
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;
  if (!left.prerelease && right.prerelease) return 1;
  if (left.prerelease && !right.prerelease) return -1;
  return left.prerelease.localeCompare(right.prerelease);
}

export function isNewerVersion(next: string, current: string): boolean {
  return compareSemver(next, current) > 0;
}

export function canCreateVersion(next: string, latestReleased: string | null): boolean {
  if (!isValidVersion(next)) return false;
  if (next === '1.0.0' && !FROZEN_PRODUCTION_VERSION) return false;
  if (!latestReleased) return true;
  return isNewerVersion(next, latestReleased);
}

const FLOW: Record<ReleaseStatus, ReleaseStatus[]> = {
  draft: ['testing'],
  testing: ['ready', 'draft'],
  ready: ['pilot', 'testing'],
  pilot: ['released', 'paused', 'ready'],
  released: ['paused'],
  paused: ['pilot', 'released', 'rolled_back'],
  rolled_back: [],
};

export function canTransition(from: ReleaseStatus, to: ReleaseStatus, emergency = false): boolean {
  if (from === to) return true;
  if (emergency && to === 'released') return from !== 'rolled_back';
  return FLOW[from]?.includes(to) === true;
}

/** DRAFT → EVERYONE is forbidden. Emergency still cannot skip from draft without TESTING. */
export function canReleaseToEveryone(status: ReleaseStatus, emergency = false): boolean {
  if (status === 'draft') return false;
  if (emergency) return status === 'testing' || status === 'ready' || status === 'pilot' || status === 'paused';
  return status === 'ready' || status === 'pilot' || status === 'paused';
}

export function canAssignTenants(status: ReleaseStatus): boolean {
  return status === 'ready' || status === 'pilot' || status === 'paused';
}

export interface ReleaseManifest {
  productionVersion: string | null;
  previousProductionVersion: string | null;
  stagingVersion: string | null;
  minSupportedVersion: string | null;
  paused: boolean;
  updatedAt: number | null;
}

export interface TenantAssignment {
  tenantId: string;
  assignedVersion: string;
}

export function resolveTenantVersion(input: {
  tenantId: string | null;
  signedIn: boolean;
  offline: boolean;
  lastGoodVersion: string | null;
  lastTenantId: string | null;
  siteDefaultVersion: string | null;
  manifest: ReleaseManifest;
  assignment: TenantAssignment | null;
}): { version: string | null; reason: string; requireTenant: boolean } {
  const publicOk = !input.signedIn || !input.tenantId;
  if (publicOk && !input.tenantId) {
    const version = input.lastGoodVersion || input.siteDefaultVersion;
    return { version, reason: input.signedIn ? 'signed-in-no-tenant' : 'signed-out', requireTenant: false };
  }
  if (input.offline) {
    return { version: input.lastGoodVersion || input.siteDefaultVersion, reason: 'offline-last-good', requireTenant: false };
  }
  if (input.assignment?.assignedVersion) {
    return { version: input.assignment.assignedVersion, reason: 'tenant-assignment', requireTenant: true };
  }
  if (input.manifest.productionVersion && !input.manifest.paused) {
    return { version: input.manifest.productionVersion, reason: 'everyone', requireTenant: true };
  }
  if (input.manifest.productionVersion && input.manifest.paused) {
    return { version: input.lastGoodVersion || input.manifest.previousProductionVersion || input.siteDefaultVersion, reason: 'paused', requireTenant: true };
  }
  return { version: input.lastGoodVersion || input.siteDefaultVersion, reason: 'site-default', requireTenant: true };
}

export function updateAvailable(running: string, assigned: string | null, paused: boolean): boolean {
  if (!assigned || paused) return false;
  return isNewerVersion(assigned, running);
}

export function requiresForcedUpdate(running: string, minSupported: string | null): boolean {
  if (!minSupported) return false;
  return compareSemver(running, minSupported) < 0;
}

export function isPublicPath(pathname: string): boolean {
  const path = stripAppTreePrefix(pathname).replace(/\/+$/, '') || '/';
  if (path === '/') return true;
  return PUBLIC_APP_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

export function stripAppTreePrefix(pathname: string): string {
  const m = /^\/app\/[^/]+(\/.*)?$/.exec(pathname);
  if (!m) return pathname || '/';
  return m[1] && m[1].length ? m[1] : '/';
}

export function versionFromPath(pathname: string): string | null {
  const m = /^\/app\/([^/]+)(?:\/|$)/.exec(pathname);
  return m?.[1] ?? null;
}

export function alreadyInAppTree(pathname: string): boolean {
  return /^\/app\/[^/]+(?:\/|$)/.test(pathname);
}

/** Maps a normal route (/pos, /auth/action) onto /app/{version}/… keeping query and hash. */
export function mapBootLocation(input: { version: string; pathname: string; search?: string; hash?: string }): string {
  const rest = stripAppTreePrefix(input.pathname);
  const path = rest === '/' ? '/' : rest;
  return `/app/${input.version}${path}${input.search ?? ''}${input.hash ?? ''}`;
}

export function treesEligibleForDelete(input: {
  trees: string[];
  assignedVersions: string[];
  productionVersion: string | null;
  previousProductionVersion: string | null;
  minSupportedVersion: string | null;
  rollbackVersions: string[];
  stagingVersion: string | null;
}): string[] {
  const keep = new Set(
    [
      ...input.assignedVersions,
      input.productionVersion,
      input.previousProductionVersion,
      input.minSupportedVersion,
      input.stagingVersion,
      ...input.rollbackVersions,
    ].filter((v): v is string => !!v),
  );
  return input.trees.filter((tree) => !keep.has(tree));
}

export function clientApiAllowed(clientApiVersion: unknown, minApi: number, maxApi: number): boolean {
  if (clientApiVersion == null || clientApiVersion === '') return true;
  const n = Number(clientApiVersion);
  return Number.isInteger(n) && n >= minApi && n <= maxApi;
}

export function rollbackSafe(input: {
  toVersion: string;
  fromVersion: string;
  toApi: number;
  liveApiMin: number;
  toOfflineSchema: number;
  liveOfflineSchema: number;
  fromRequiresMigration: boolean;
}): boolean {
  if (compareSemver(input.toVersion, input.fromVersion) >= 0) return false;
  if (input.fromRequiresMigration) return false;
  if (input.toApi < input.liveApiMin) return false;
  if (input.toOfflineSchema !== input.liveOfflineSchema) return false;
  return true;
}
