import { describe, expect, it } from 'vitest';
import {
  cleanVisibleIds,
  defaultBranding,
  emptyStoreConfig,
  normalizeSlug,
  projectPublicProduct,
  projectPublicStore,
  publishBlockers,
  slugProblem,
  toStoreConfig,
} from './onlineStore';

describe('online store slugs', () => {
  it('accepts lowercase subdomain-shaped slugs', () => {
    expect(slugProblem('abu-ali-market')).toBeNull();
    expect(slugProblem(normalizeSlug('  My-Shop1 '))).toBeNull();
  });

  it('rejects bad formats', () => {
    for (const s of ['ab', '-shop', 'shop-', 'sh--op', 'my shop', 'متجر', 'a'.repeat(31), 'Shop']) {
      expect(slugProblem(s)).toBe('format');
    }
  });

  it('rejects reserved platform names', () => {
    expect(slugProblem('admin')).toBe('reserved');
    expect(slugProblem('zelvero')).toBe('reserved');
  });
});

describe('online store config', () => {
  it('is disabled and unpublished by default', () => {
    const c = emptyStoreConfig('Shop');
    expect(c.enabled).toBe(false);
    expect(c.publication).toBe('draft');
    expect(c.published).toBeNull();
    expect(publishBlockers(c)).toEqual(['disabled', 'noSlug', 'noProducts']);
  });

  it('is publishable only when enabled, slugged, branded, and with products', () => {
    const c = { ...emptyStoreConfig('Shop'), enabled: true, slug: 'shop-one', visibleProductIds: ['p1'] };
    expect(publishBlockers(c)).toEqual([]);
    expect(publishBlockers({ ...c, draft: { ...c.draft, storeName: ' ' } })).toEqual(['branding']);
    expect(publishBlockers({ ...c, draft: { ...c.draft, defaultLocale: 'en', enabledLocales: ['ar'] } })).toEqual(['branding']);
  });

  it('normalizes a broken stored doc defensively', () => {
    const c = toStoreConfig({
      enabled: 'yes',
      slug: 'BAD SLUG',
      publication: 'live',
      draft: { template: 'casino', primaryColor: 'red', enabledLocales: ['fr', 'en'], storeName: 7 },
      visibleProductIds: ['a', 'a', 3, 'b'],
    }, 'Fallback');
    expect(c.enabled).toBe(false);
    expect(c.slug).toBeNull();
    expect(c.publication).toBe('draft');
    expect(c.draft.template).toBe('retail');
    expect(c.draft.primaryColor).toBe(defaultBranding().primaryColor);
    expect(c.draft.enabledLocales).toEqual(['en']);
    expect(c.draft.storeName).toBe('Fallback');
    expect(c.visibleProductIds).toEqual(['a', 'b']);
  });

  it('dedupes and caps visible ids', () => {
    expect(cleanVisibleIds(['a', 'b', 'a', 'c'], 2)).toEqual(['a', 'b']);
  });
});

describe('public projections', () => {
  it('never leaks cost, supplier, barcode, or exact stock', () => {
    const product = {
      id: 'p1',
      name: 'Tea',
      category: 'Drinks',
      prices: { retail: { usdCents: 250, lbp: 225000 }, wholesale: { usdCents: 100, lbp: null } },
      imageUrl: '',
      stock: 17,
      costUsdCents: 90,
      supplierId: 's1',
      barcode: '123',
    };
    const out = projectPublicProduct(product as unknown as Parameters<typeof projectPublicProduct>[0]);
    expect(out).toEqual({ id: 'p1', name: 'Tea', category: 'Drinks', priceUsdCents: 250, priceLbp: 225000, imageUrl: null, inStock: true });
  });

  it('builds the public store header from the published snapshot only', () => {
    const out = projectPublicStore('shop-one', defaultBranding('Shop'));
    expect(Object.keys(out).sort()).toEqual([
      'accentColor', 'contactPhone', 'defaultLocale', 'enabledLocales', 'font', 'primaryColor', 'slug',
      'storeName', 'tagline', 'template', 'whatsapp',
    ]);
  });
});
