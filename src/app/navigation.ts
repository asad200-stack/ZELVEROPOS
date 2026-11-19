import type { IconName } from '@/components/ui/Icon';
import type { PermissionKey } from '@/constants/permissions';
import type { TranslationKey } from '@/i18n/i18n';

export interface NavItem {
  path: string;
  label: TranslationKey;
  icon: IconName;
  permission?: PermissionKey;
  ownerOnly?: boolean;
}

/** Screen → permission mapping (same as CATCH POS SCREEN_PERMISSION_MAP). */
export const NAV_ITEMS: NavItem[] = [
  { path: '/dashboard', label: 'nav.dashboard', icon: 'home' },
  { path: '/pos', label: 'nav.pos', icon: 'cart', permission: 'canSell' },
  { path: '/cashbox', label: 'nav.cashbox', icon: 'wallet', permission: 'canManageCashDrawer' },
  { path: '/products', label: 'nav.products', icon: 'box', permission: 'canViewProducts' },
  { path: '/expiry', label: 'nav.expiry', icon: 'calendar', permission: 'canViewProducts' },
  { path: '/sales', label: 'nav.sales', icon: 'receipt', permission: 'canViewSales' },
  { path: '/customers', label: 'nav.customers', icon: 'users', permission: 'canViewCustomers' },
  { path: '/suppliers', label: 'nav.suppliers', icon: 'truck', permission: 'canViewSuppliers' },
  { path: '/purchases', label: 'nav.purchases', icon: 'clipboard', permission: 'canViewSuppliers' },
  { path: '/reports', label: 'nav.reports', icon: 'chart', permission: 'canViewReports' },
  { path: '/users', label: 'nav.users', icon: 'user', ownerOnly: true },
  { path: '/online-store', label: 'nav.onlineStore', icon: 'globe', ownerOnly: true },
  { path: '/online-orders', label: 'nav.onlineOrders', icon: 'receipt', ownerOnly: true },
  { path: '/settings', label: 'nav.settings', icon: 'settings', permission: 'canViewSettings' },
];
