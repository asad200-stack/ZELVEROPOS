export interface ApprovedMedia {
  id: string;
  feature: string;
  version: string;
  screen: string;
  caption: string;
  tags: string[];
  imageUrl: string | null;
  visual: 'reconstruction' | 'approved-photo';
  validFromVersion: string;
  validUntilVersion: string | null;
}

/**
 * No approved production photographs are checked in yet.
 * Interface reconstructions may be shown; AI must not call them customer screenshots.
 */
export const MEDIA_LIBRARY: ApprovedMedia[] = [
  {
    id: 'pos-grid-cart',
    feature: 'pos',
    version: 'current',
    screen: 'POS',
    caption: 'Product grid, cart, customer, and mixed USD/LBP checkout — reconstructed from the live ZELVERO POS UI.',
    tags: ['pos', 'cart', 'checkout'],
    imageUrl: null,
    visual: 'reconstruction',
    validFromVersion: '0.9.0-dev',
    validUntilVersion: null,
  },
  {
    id: 'credit-previous',
    feature: 'credit',
    version: 'current',
    screen: 'POS checkout',
    caption: 'Add Previous collects outstanding debt with the new sale. Debt collected is not new revenue.',
    tags: ['credit', 'previous-balance'],
    imageUrl: null,
    visual: 'reconstruction',
    validFromVersion: '0.9.0-dev',
    validUntilVersion: null,
  },
  {
    id: 'inventory-stock',
    feature: 'inventory',
    version: 'current',
    screen: 'Products',
    caption: 'Catalog with stock, categories, and images.',
    tags: ['inventory', 'stock'],
    imageUrl: null,
    visual: 'reconstruction',
    validFromVersion: '0.9.0-dev',
    validUntilVersion: null,
  },
  {
    id: 'reports-overview',
    feature: 'reports',
    version: 'current',
    screen: 'Reports',
    caption: 'Operational reports for sales, debt, and inventory.',
    tags: ['reports'],
    imageUrl: null,
    visual: 'reconstruction',
    validFromVersion: '0.9.0-dev',
    validUntilVersion: null,
  },
  {
    id: 'drawer-session',
    feature: 'drawer',
    version: 'current',
    screen: 'Cashbox',
    caption: 'Cash drawer with USD and LBP.',
    tags: ['drawer', 'cash'],
    imageUrl: null,
    visual: 'reconstruction',
    validFromVersion: '0.9.0-dev',
    validUntilVersion: null,
  },
];

export function mediaForFeature(feature: string, runningVersion = 'current'): ApprovedMedia[] {
  return MEDIA_LIBRARY.filter((item) => {
    if (item.feature !== feature) return false;
    if (item.validUntilVersion && runningVersion > item.validUntilVersion) return false;
    return true;
  });
}
