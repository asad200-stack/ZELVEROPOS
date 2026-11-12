/**
 * Functions permission surface — re-exports the shared client contract.
 *
 * Source of truth: `src/constants/permissions.ts`, copied by
 * `scripts/copy-shared.mjs` (npm prebuild) into `./shared/permissions.ts`.
 * Do not duplicate PERMISSION_KEYS / defaults / normalize here.
 *
 * Authoritative AI contract (`canUseZelveroAI`): see shared module header.
 */

export {
  PERMISSION_KEYS,
  DEFAULT_SUBUSER_PERMISSIONS,
  ALL_PERMISSIONS,
  normalizePermissions,
  mergePermissionPatch,
  grantedOnly,
  type PermissionKey,
  type PermissionMap,
} from './shared/permissions.js';
