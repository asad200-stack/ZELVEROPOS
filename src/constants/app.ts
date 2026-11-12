export const APP_NAME = 'ZELVERO POS';
export const APP_VERSION = '2.0.0';
/** Product release label. Not 1.0.0 until the owner freezes production. */
export const APP_RELEASE_VERSION = String(import.meta.env.VITE_APP_RELEASE_VERSION || '0.9.0-dev');
export function applicationVersionLabel() {
  return `v${APP_RELEASE_VERSION}`;
}
export const APP_BUILD_ID = String(import.meta.env.VITE_APP_BUILD_ID || 'dev');
export const API_COMPAT_VERSION = Number(import.meta.env.VITE_API_COMPAT_VERSION || 1);
export const OFFLINE_SCHEMA_VERSION = 1;

export const SUPPORT_PHONE = import.meta.env.VITE_SUPPORT_PHONE || '';

/** Business defaults inherited from CATCH POS. */
export const DEFAULTS = {
  exchangeRate: 89500,
  lowStockThreshold: 10,
  creditLimitUsdCents: 500_00,
  expirySoonDays: 30,
  currency: 'USD' as const,
  priceTier: 'retail' as const,
};

export const PAGE_SIZE = 50;

export const STORAGE_KEYS = {
  lang: 'zelvero.lang',
  theme: 'zelvero.theme',
  /** Per store AND user: cashiers sharing a device never see each other's open carts. */
  cart: (tenantId: string, uid: string) => `zelvero.cart.${tenantId}.${uid}`,
  sidebar: 'zelvero.sidebar',
  lastTenantId: 'zelvero.lastTenantId',
  lastGoodVersion: 'zelvero.lastGoodVersion',
  updateSnoozeUntil: 'zelvero.updateSnoozeUntil',
} as const;

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
