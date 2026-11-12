/**
 * Marketing site never talks to tenant Firestore. POS stays on its own origin.
 * Staging builds must set VITE_POS_ORIGIN. The production host is not part of that branch.
 */
export const POS_ORIGIN =
  import.meta.env.MODE === 'staging'
    ? String(import.meta.env.VITE_POS_ORIGIN || '')
    : String(import.meta.env.VITE_POS_ORIGIN || 'https://zelvoropos.web.app');
export const POS_LOGIN = `${POS_ORIGIN}/login`;
export const POS_SIGNUP = `${POS_ORIGIN}/signup`;

export const BRAND = 'ZELVERO';
export const PRODUCT = 'ZELVERO POS';
export const TAGLINE = 'The operating system for modern businesses.';
export const TRIAL_DAYS = 15;

export const STORAGE = {
  sound: 'zelvero.web.sound',
  ref: 'zelvero.web.ref',
  quote: 'zelvero.web.quoteDraft',
} as const;

export const NAV = [
  { to: '/product', label: 'Product' },
  { to: '/solutions', label: 'Solutions' },
  { to: '/industries', label: 'Industries' },
  { to: '/demo', label: 'Demo' },
  { to: '/quote', label: 'Get a Quote' },
  { to: '/resources', label: 'Resources' },
] as const;
