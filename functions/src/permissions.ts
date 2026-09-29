/** Must stay identical to src/constants/permissions.ts (checked by tests/unit/permissionsSync.test.ts). */
export const PERMISSION_KEYS = [
  'canSell',
  'canEditPrice',
  'canViewSales',
  'canViewProducts',
  'canAddProducts',
  'canEditProducts',
  'canDeleteProducts',
  'canImportProducts',
  'canExportProducts',
  'canViewCustomers',
  'canViewReports',
  'canViewSuppliers',
  'canManageCashDrawer',
  'canViewSettings',
  'canEditSettings',
  'canViewCosts',
  'canViewSensitiveData',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];
export type PermissionMap = Record<PermissionKey, boolean>;

export function normalizePermissions(input: unknown): PermissionMap {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out = {} as PermissionMap;
  for (const key of PERMISSION_KEYS) out[key] = src[key] === true;
  if (!out.canViewProducts) {
    out.canAddProducts = false;
    out.canEditProducts = false;
    out.canDeleteProducts = false;
    out.canImportProducts = false;
    out.canExportProducts = false;
  }
  if (!out.canViewSettings) out.canEditSettings = false;
  return out;
}

/** Compact claim form: only granted keys (custom claims are limited to 1000 bytes). */
export function grantedOnly(perms: PermissionMap): Record<string, true> {
  const out: Record<string, true> = {};
  for (const key of PERMISSION_KEYS) if (perms[key]) out[key] = true;
  return out;
}
