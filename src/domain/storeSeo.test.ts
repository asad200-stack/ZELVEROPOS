import { describe, expect, it } from 'vitest';
import { feedPrice, imageVersion, injectSeo, parseStoreImagePath, productFeedXml, robotsTxt, sitemapIndexXml, sitemapXml, storeImageUrl, type SeoStore } from './storeSeo';

const store: SeoStore = { name: 'Today & Co', description: 'Clothes', url: 'https://zelvoropos.web.app/s/todayslook', imageUrl: '', locale: 'ar' };
const product = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  name: 'Denim <Jacket>',
  category: 'Women',
  priceUsdCents: 2800,
  priceLbp: null,
  imageUrl: 'https://firebasestorage.googleapis.com/v0/b/b/o/x.webp?alt=media',
  images: [],
  inStock: true,
  description: '',
  compareAtUsdCents: null,
  groupId: null,
  groupName: '',
  ...over,
});

describe('store SEO', () => {
  it('formats catalogue prices', () => {
    expect(feedPrice(2800, null)).toBe('28.00 USD');
    expect(feedPrice(0, 150000)).toBe('150000 LBP');
    expect(feedPrice(0, null)).toBe('');
  });

  it('lists every product link in the sitemap, escaped', () => {
    const xml = sitemapXml(store, [product(), product({ id: 'p 2' })]);
    expect(xml).toContain('<loc>https://zelvoropos.web.app/s/todayslook</loc>');
    expect(xml).toContain('<loc>https://zelvoropos.web.app/s/todayslook?p=p1</loc>');
    expect(xml).toContain('?p=p%202');
  });

  it('builds a catalogue feed with sale prices and JPEG photos', () => {
    const xml = productFeedXml(store, [product({ compareAtUsdCents: 3500 }), product({ id: 'nophoto', imageUrl: null })], (p) => `https://x/${p.id}.jpg`);
    expect(xml).toContain('<g:price>35.00 USD</g:price>');
    expect(xml).toContain('<g:sale_price>28.00 USD</g:sale_price>');
    expect(xml).toContain('<g:image_link>https://x/p1.jpg</g:image_link>');
    expect(xml).toContain('<g:title>Denim &lt;Jacket&gt;</g:title>');
    expect(xml).toContain('<g:brand>Today &amp; Co</g:brand>');
    expect(xml).not.toContain('nophoto');
  });

  it('puts schema.org data in the page without breaking out of the script tag', () => {
    const html = injectSeo('<html><head></head><body><div id="root"></div></body></html>', store, [product({ name: '</script><b>x' })], null);
    expect(html).toContain('application/ld+json');
    expect(html).not.toMatch(/<\/script><b>/);
    expect(html).toContain('<noscript><h1>Today &amp; Co</h1>');
  });

  it('makes and reads photo links', () => {
    const url = storeImageUrl('', 'todayslook', 'p1', 'https://a/b.webp', 640);
    expect(url).toBe(`/s/todayslook/img/p1-640.webp?v=${imageVersion('https://a/b.webp')}`);
    expect(parseStoreImagePath('/s/todayslook/img/p1-640.webp')).toEqual({ slug: 'todayslook', productId: 'p1', width: 640, format: 'webp' });
    expect(parseStoreImagePath('/s/todayslook/img/p1-500.webp')).toBeNull();
    expect(parseStoreImagePath('/s/todayslook/img/../x-640.webp')).toBeNull();
    expect(imageVersion('https://a/b.webp')).not.toBe(imageVersion('https://a/c.webp'));
  });

  it('lists every shop sitemap in one index', () => {
    expect(sitemapIndexXml(['https://h/s/a/sitemap.xml', 'https://h/s/b&c/sitemap.xml'])).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <sitemap><loc>https://h/s/a/sitemap.xml</loc></sitemap>\n  <sitemap><loc>https://h/s/b&amp;c/sitemap.xml</loc></sitemap>\n</sitemapindex>\n',
    );
    expect(sitemapIndexXml([])).toContain('<sitemapindex');
  });

  it('writes robots.txt with the sitemaps', () => {
    expect(robotsTxt(['https://h/s/a/sitemap.xml'])).toBe('User-agent: *\nAllow: /\n\nSitemap: https://h/s/a/sitemap.xml\n');
  });
});
