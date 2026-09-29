export const APP_NAME = 'ZELVERO POS';
export const APP_VERSION = '2.0.0';

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
  cart: (tenantId: string) => `zelvero.cart.${tenantId}`,
  sidebar: 'zelvero.sidebar',
} as const;

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
