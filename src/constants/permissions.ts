/**
 * Authoritative permission contract (client + Cloud Functions).
 *
 * Copied into Functions by `functions/scripts/copy-shared.mjs` → `functions/src/shared/permissions.ts`.
 * `functions/src/permissions.ts` re-exports that shared module — do not duplicate keys here.
 *
 * Sub-user keys keep CATCH POS meaning. Owners implicitly have every permission. (`ALL_PERMISSIONS` holds them all.)
 * Custom claims (`perms`) are written only by Cloud Functions; UI checks are for UX only.
 *
 * `canUseZelveroAI` — explicit boolean Zelvero AI access:
 * - Missing on a profile ⇒ `false` (`normalizePermissions`).
 * - Independent of POS keys; granting/revoking AI must not imply or clear `canSell` /
 *   `canAddProducts` / other POS permissions (`mergePermissionPatch`).
 * - Only owner-side `createSubUser` / `updateSubUser` may change it; clients cannot self-grant.
 * - Server verifies tenant ownership + target membership. AI UI is not the security boundary.
 *
 * `canManageUsers` from CATCH POS is intentionally not grantable (escalation risk).
 */
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
  'canUseZelveroAI',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];
export type PermissionMap = Record<PermissionKey, boolean>;

export const PERMISSION_GROUPS: { key: 'products' | 'sales' | 'management'; permissions: PermissionKey[] }[] = [
  {
    key: 'products',
    permissions: [
      'canViewProducts',
      'canAddProducts',
      'canEditProducts',
      'canDeleteProducts',
      'canImportProducts',
      'canExportProducts',
    ],
  },
  { key: 'sales', permissions: ['canSell', 'canEditPrice', 'canViewSales'] },
  {
    key: 'management',
    permissions: [
      'canViewCustomers',
      'canViewReports',
      'canViewSuppliers',
      'canManageCashDrawer',
      'canViewSettings',
      'canEditSettings',
      'canViewCosts',
      'canViewSensitiveData',
      'canUseZelveroAI',
    ],
  },
];

/** Defaults of the CATCH POS "add sub-user" form. */
export const DEFAULT_SUBUSER_PERMISSIONS: PermissionMap = {
  canSell: true,
  canEditPrice: true,
  canViewSales: true,
  canViewProducts: true,
  canAddProducts: false,
  canEditProducts: false,
  canDeleteProducts: false,
  canImportProducts: false,
  canExportProducts: false,
  canViewCustomers: true,
  canViewReports: true,
  canViewSuppliers: false,
  canManageCashDrawer: false,
  canViewSettings: false,
  canEditSettings: false,
  canViewCosts: false,
  canViewSensitiveData: false,
  canUseZelveroAI: false,
};

export const ALL_PERMISSIONS: PermissionMap = Object.fromEntries(
  PERMISSION_KEYS.map((k) => [k, true]),
) as PermissionMap;

/**
 * Return authorization: view sales history and either sell or manage the cash drawer.
 * Matches `posReturn` Cloud Function auth (`anyOf` sell|drawer + `canViewSales`).
 */
export function canProcessReturn(can: (permission: PermissionKey) => boolean): boolean {
  return can('canViewSales') && (can('canSell') || can('canManageCashDrawer'));
}

/** Normalises an arbitrary object into a full permission map (product sub-permissions need view). */
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

/**
 * Applies only known boolean keys from `patch` onto an existing map.
 * Unknown keys are ignored. Unmentioned keys keep their previous values.
 */
export function mergePermissionPatch(existing: unknown, patch: Record<string, boolean>): PermissionMap {
  const base = normalizePermissions(existing);
  const next: Record<string, boolean> = { ...base };
  for (const key of PERMISSION_KEYS) {
    if (typeof patch[key] === 'boolean') next[key] = patch[key];
  }
  return normalizePermissions(next);
}

/** Compact claim form: only granted keys (custom claims are size-limited). */
export function grantedOnly(perms: PermissionMap): Record<string, true> {
  const out: Record<string, true> = {};
  for (const key of PERMISSION_KEYS) {
    if (perms[key] === true) out[key] = true;
  }
  return out;
}
