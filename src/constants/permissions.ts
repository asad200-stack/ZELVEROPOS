/**
 * Sub-user permission keys (identical to CATCH POS so the business meaning is unchanged).
 * Owners implicitly have every permission. Permissions are enforced by Firestore rules through
 * custom claims (`perms`) written only by Cloud Functions; UI checks are for UX only.
 *
 * `canManageUsers` from CATCH POS is intentionally not grantable: a sub-user able to manage users
 * could escalate its own permissions. User management is owner-only.
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
};

export const ALL_PERMISSIONS: PermissionMap = Object.fromEntries(
  PERMISSION_KEYS.map((k) => [k, true]),
) as PermissionMap;

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
