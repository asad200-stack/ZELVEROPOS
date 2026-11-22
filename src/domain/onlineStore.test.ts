import { describe, expect, it } from 'vitest';
import {
  cleanVisibleIds,
  defaultBranding,
  deliveryQuote,
  discountPercent,
  mapLink,
  openState,
  shopClock,
  toStoreHours,
  emptyStoreConfig,
  FREE_DELIVERY_MAX_USD_CENTS,
  freeDeliveryProgress,
  normalizeSlug,
  projectPublicProduct,
  projectPublicStore,
  publishBlockers,
  slugProblem,
  toDeliveryZones,
  toListings,
  rankBestSellers,
  toRatingTotals,
  toFreeDeliveryThreshold,
  toStoreBranding,
  injectShareMeta,
  statDates,
  storeManifest,
  storeShareMeta,
  summarizeStats,
  toDayStats,
  toSections,
  toHeroProductIds,
  heroImageOk,
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
    expect(out).toEqual({
      id: 'p1',
      name: 'Tea',
      category: 'Drinks',
      priceUsdCents: 250,
      priceLbp: 225000,
      imageUrl: null,
      inStock: true,
      description: '',
      compareAtUsdCents: null,
      rating: null,
      isNew: false,
      cutoutUrl: null,
    });
  });

  it('builds the public store header from the published snapshot only', () => {
    const out = projectPublicStore('shop-one', defaultBranding('Shop'));
    expect(Object.keys(out).sort()).toEqual([
      'accentColor', 'contactPhone', 'defaultLocale', 'deliveryZones', 'enabledLocales', 'font', 'freeDeliveryOverUsdCents',
      'heroCta', 'heroImageUrl', 'heroProductIds', 'heroSubtitle', 'heroTitle', 'hours', 'minOrderUsdCents', 'primaryColor', 'sections', 'slug',
      'storeAddress', 'storeName', 'tagline', 'template', 'theme', 'whatsapp',
    ]);
  });
});

describe('free delivery', () => {
  it('normalizes the threshold', () => {
    expect(toFreeDeliveryThreshold(undefined)).toBeNull();
    expect(toFreeDeliveryThreshold(0)).toBeNull();
    expect(toFreeDeliveryThreshold(-5)).toBeNull();
    expect(toFreeDeliveryThreshold(12.5)).toBeNull();
    expect(toFreeDeliveryThreshold('5000')).toBeNull();
    expect(toFreeDeliveryThreshold(FREE_DELIVERY_MAX_USD_CENTS + 1)).toBeNull();
    expect(toFreeDeliveryThreshold(5000)).toBe(5000);
  });

  it('computes cart progress', () => {
    expect(freeDeliveryProgress(null, 1000)).toBeNull();
    expect(freeDeliveryProgress(0, 1000)).toBeNull();
    expect(freeDeliveryProgress(5000, -100)).toEqual({ remainingUsdCents: 5000, ratio: 0, reached: false });
    expect(freeDeliveryProgress(5000, 2000)).toEqual({ remainingUsdCents: 3000, ratio: 0.4, reached: false });
    expect(freeDeliveryProgress(5000, 5000)).toEqual({ remainingUsdCents: 0, ratio: 1, reached: true });
    expect(freeDeliveryProgress(5000, 9000)).toEqual({ remainingUsdCents: 0, ratio: 1, reached: true });
  });
});

describe('delivery zones', () => {
  const zones = [
    { id: 'hamra', name: 'Hamra', feeUsdCents: 300 },
    { id: 'jounieh', name: 'Jounieh', feeUsdCents: 500 },
  ];
  const store = { deliveryZones: zones, freeDeliveryOverUsdCents: 5000, minOrderUsdCents: 1000 };

  it('charges the chosen zone fee for delivery', () => {
    expect(deliveryQuote(store, 2000, 'delivery', 'jounieh')).toEqual({ feeUsdCents: 500, zone: zones[1], free: false, problem: null });
  });

  it('asks for a zone when the store has zones and none (or an unknown one) is picked', () => {
    expect(deliveryQuote(store, 2000, 'delivery', null).problem).toBe('zone');
    expect(deliveryQuote(store, 2000, 'delivery', 'nowhere').problem).toBe('zone');
  });

  it('enforces the minimum order for delivery only', () => {
    expect(deliveryQuote(store, 999, 'delivery', 'hamra').problem).toBe('minOrder');
    expect(deliveryQuote(store, 999, 'pickup', null)).toEqual({ feeUsdCents: 0, zone: null, free: false, problem: null });
  });

  it('drops the fee once the free-delivery threshold is reached', () => {
    expect(deliveryQuote(store, 5000, 'delivery', 'hamra')).toEqual({ feeUsdCents: 0, zone: zones[0], free: true, problem: null });
  });

  it('charges nothing when the store has no zones', () => {
    const plain = { deliveryZones: [], freeDeliveryOverUsdCents: null, minOrderUsdCents: null };
    expect(deliveryQuote(plain, 100, 'delivery', undefined)).toEqual({ feeUsdCents: 0, zone: null, free: false, problem: null });
  });

  it('reads stored zones defensively', () => {
    expect(
      toDeliveryZones([
        { id: 'a1', name: ' Beirut ', feeUsdCents: 200 },
        { id: 'a1', name: 'Duplicate', feeUsdCents: 100 },
        { id: 'BAD ID', name: 'x', feeUsdCents: 100 },
        { id: 'b2', name: '', feeUsdCents: 100 },
        { id: 'c3', name: 'Neg', feeUsdCents: -5 },
        { id: 'd4', name: 'Float', feeUsdCents: 1.5 },
        'junk',
      ]),
    ).toEqual([{ id: 'a1', name: 'Beirut', feeUsdCents: 200 }]);
    expect(toDeliveryZones(undefined)).toEqual([]);
  });

  it('keeps zones and the minimum when reading a stored branding', () => {
    const b = toStoreBranding({ storeName: 'S', deliveryZones: zones, minOrderUsdCents: 1500 });
    expect(b.deliveryZones).toEqual(zones);
    expect(b.minOrderUsdCents).toBe(1500);
    expect(toStoreBranding({ storeName: 'S' }).deliveryZones).toEqual([]);
  });
});

describe('product listings', () => {
  const product = { id: 'p1', name: 'Tea', category: 'Drinks', prices: { retail: { usdCents: 800, lbp: 0 } }, imageUrl: null, stock: 3 };
  const project = (listing?: { description: string; compareAtUsdCents: number | null; cutoutUrl?: string }) =>
    projectPublicProduct(product as unknown as Parameters<typeof projectPublicProduct>[0], listing && { cutoutUrl: '', ...listing });

  it('adds the description and a real price-before-discount', () => {
    const out = project({ description: 'Ceylon tea', compareAtUsdCents: 1000 });
    expect(out.description).toBe('Ceylon tea');
    expect(out.compareAtUsdCents).toBe(1000);
    expect(discountPercent(out)).toBe(20);
  });

  it('ignores a "before" price that is not above the current price', () => {
    expect(project({ description: '', compareAtUsdCents: 800 }).compareAtUsdCents).toBeNull();
    expect(project({ description: '', compareAtUsdCents: 500 }).compareAtUsdCents).toBeNull();
    expect(discountPercent({ priceUsdCents: 800, compareAtUsdCents: null })).toBeNull();
  });

  it('reads stored listings defensively', () => {
    expect(
      toListings({
        p1: { description: '  Nice  ', compareAtUsdCents: 1200 },
        'bad id': { description: 'x', compareAtUsdCents: null },
        p2: { description: '', compareAtUsdCents: null },
        p3: { description: 'y'.repeat(700), compareAtUsdCents: -1 },
        p4: { description: '', compareAtUsdCents: null, cutoutUrl: 'https://img.example/p4.webp' },
        p5: { description: '', compareAtUsdCents: null, cutoutUrl: 'http://evil.example/x.png' },
      }),
    ).toEqual({
      p1: { description: 'Nice', compareAtUsdCents: 1200, cutoutUrl: '' },
      p3: { description: 'y'.repeat(600), compareAtUsdCents: null, cutoutUrl: '' },
      p4: { description: '', compareAtUsdCents: null, cutoutUrl: 'https://img.example/p4.webp' },
    });
    expect(toListings(null)).toEqual({});
  });
});

describe('opening hours', () => {
  const week = (open: string, close: string, closedDays: number[] = []) =>
    Array.from({ length: 7 }, (_, d) => ({ closed: closedDays.includes(d), open, close }));

  it('is open between opening and closing time', () => {
    expect(openState(week('09:00', '21:00'), { day: 1, minute: 10 * 60 })).toEqual({ open: true, until: '21:00', untilDay: null });
  });

  it('says when it opens later today, or on the next open day', () => {
    expect(openState(week('09:00', '21:00'), { day: 1, minute: 8 * 60 })).toEqual({ open: false, until: '09:00', untilDay: null });
    expect(openState(week('09:00', '21:00', [0]), { day: 6, minute: 22 * 60 })).toEqual({ open: false, until: '09:00', untilDay: 1 });
  });

  it('handles hours past midnight', () => {
    const h = week('18:00', '02:00');
    expect(openState(h, { day: 2, minute: 23 * 60 })?.open).toBe(true);
    expect(openState(h, { day: 3, minute: 60 })).toEqual({ open: true, until: '02:00', untilDay: null });
    expect(openState(h, { day: 3, minute: 3 * 60 })?.open).toBe(false);
  });

  it('returns null when hours are not set and reads stored hours defensively', () => {
    expect(openState([], { day: 0, minute: 0 })).toBeNull();
    expect(toStoreHours(week('9:00', '21:00'))).toEqual([]);
    expect(toStoreHours(week('09:00', '21:00')).length).toBe(7);
    expect(toStoreHours([{ closed: false, open: '09:00', close: '21:00' }])).toEqual([]);
  });

  it('reads the shop clock in Beirut time', () => {
    // 2026-11-20 is a Friday; 10:30 UTC is 12:30 in Beirut (UTC+2).
    expect(shopClock(new Date(Date.UTC(2026, 10, 20, 10, 30)))).toEqual({ day: 5, minute: 12 * 60 + 30 });
  });

  it('links the address to maps', () => {
    expect(mapLink(' Hamra, Beirut ')).toBe('https://www.google.com/maps/search/?api=1&query=Hamra%2C%20Beirut');
    expect(mapLink('')).toBeNull();
  });
});

describe('product ratings', () => {
  it('reads totals defensively and projects a rounded average', () => {
    const totals = toRatingTotals({ p1: { count: 3, sum: 13 }, p2: { count: 1, sum: 9 }, p3: { count: 0, sum: 0 }, 'bad id': { count: 1, sum: 5 } });
    expect(totals).toEqual({ p1: { count: 3, sum: 13 } });
    const product = { id: 'p1', name: 'Tea', category: '', prices: { retail: { usdCents: 800, lbp: 0 } }, imageUrl: null, stock: 3 };
    const out = projectPublicProduct(product as unknown as Parameters<typeof projectPublicProduct>[0], undefined, totals.p1);
    expect(out.rating).toEqual({ average: 4.3, count: 3 });
  });
});

describe('best sellers and new arrivals', () => {
  it('ranks by quantity sold and ignores junk', () => {
    expect(
      rankBestSellers(
        [
          { productId: 'a', quantity: 2 },
          { productId: 'b', quantity: 5 },
          { productId: 'a', quantity: 4 },
          { productId: 'c', quantity: 1 },
          { productId: '', quantity: 9 },
          { productId: 'd', quantity: -3 },
        ],
        2,
      ),
    ).toEqual(['a', 'b']);
  });

  it('marks products added in the last three weeks as new', () => {
    const now = Date.UTC(2026, 10, 20);
    const base = { id: 'p1', name: 'Tea', category: '', prices: { retail: { usdCents: 800, lbp: 0 } }, imageUrl: null, stock: 3 };
    const project = (createdAt: number | null) =>
      projectPublicProduct({ ...base, createdAt } as unknown as Parameters<typeof projectPublicProduct>[0], undefined, undefined, now);
    expect(project(now - 2 * 86_400_000).isNew).toBe(true);
    expect(project(now - 30 * 86_400_000).isNew).toBe(false);
    expect(project(null).isNew).toBe(false);
  });
});

describe('store analytics', () => {
  it('reads counters defensively', () => {
    const d = toDayStats('2026-11-20', { visits: 4, views: -2, adds: 'x', orders: 1.7, viewsBy: { a: 3, b: 0 } });
    expect(d).toEqual({ date: '2026-11-20', visits: 4, views: 0, adds: 0, checkouts: 0, orders: 1, revenueUsdCents: 0, viewsBy: { a: 3 } });
    expect(toDayStats('2026-11-20', undefined).visits).toBe(0);
  });

  it('lists the range oldest first across month ends', () => {
    expect(statDates('2026-12-02', 3)).toEqual(['2026-11-30', '2026-12-01', '2026-12-02']);
    expect(statDates('bad', 3)).toEqual([]);
  });

  it('sums days, ranks views and computes conversion', () => {
    const s = summarizeStats([
      toDayStats('2026-11-19', { visits: 10, orders: 1, revenueUsdCents: 500, viewsBy: { a: 2, b: 5 } }),
      toDayStats('2026-11-20', { visits: 10, orders: 2, revenueUsdCents: 700, viewsBy: { a: 4 } }),
    ]);
    expect(s.totals.visits).toBe(20);
    expect(s.totals.revenueUsdCents).toBe(1200);
    expect(s.conversionPct).toBe(15);
    expect(s.topViewed).toEqual([{ productId: 'a', views: 6 }, { productId: 'b', views: 5 }]);
    expect(summarizeStats([]).conversionPct).toBeNull();
  });
});

describe('share previews', () => {
  const b = toStoreBranding({ storeName: 'Abu <Ali>', tagline: '', defaultLocale: 'ar', primaryColor: '#123456' }, 'x');
  const m = storeShareMeta('abu-ali', b, 'https://zelvoropos.web.app/', 'https://img.example/x.jpg');

  it('builds escaped tags and replaces the generic ones', () => {
    const html = injectShareMeta(
      '<html><head><meta name="theme-color" content="#000" /><meta name="description" content="POS" /><link rel="manifest" href="/manifest.webmanifest" /><title>ZELVERO POS</title></head></html>',
      m,
    );
    expect(html).toContain('<title>Abu &lt;Ali&gt;</title>');
    expect(html).toContain('og:image" content="https://img.example/x.jpg"');
    expect(html).toContain('href="/s/abu-ali/manifest.webmanifest"');
    expect(html).not.toContain('ZELVERO POS');
    expect(html.match(/rel="manifest"/g)).toHaveLength(1);
    expect(m.url).toBe('https://zelvoropos.web.app/s/abu-ali');
  });

  it('drops non-https images and builds a per-store manifest', () => {
    expect(storeShareMeta('a', b, 'https://x', 'javascript:alert(1)').imageUrl).toBe('');
    const man = storeManifest(m);
    expect(man.start_url).toBe('/s/abu-ali');
    expect(man.dir).toBe('rtl');
  });
});

describe('themes and hero', () => {
  it('reads theme, hero text and sections defensively', () => {
    const b = toStoreBranding({ theme: 'perfume', heroTitle: 'Oud nights', heroCta: 'x'.repeat(50), heroImageUrl: 'javascript:alert(1)', sections: ['catalog', 'bogus', 'categories', 'catalog'] }, 'S');
    expect(b.theme).toBe('perfume');
    expect(b.heroTitle).toBe('Oud nights');
    expect(b.heroCta).toHaveLength(30);
    expect(b.heroImageUrl).toBe('');
    expect(b.sections).toEqual(['catalog', 'categories']);
    expect(toStoreBranding({ theme: 'disco' }, 'S').theme).toBe('classic');
  });

  it('keeps hero products unique, well-formed and capped', () => {
    expect(toHeroProductIds(['a', 'a', 'bad id', 7, 'b'])).toEqual(['a', 'b']);
    expect(toHeroProductIds(Array.from({ length: 14 }, (_, i) => `p${i}`))).toHaveLength(10);
    expect(toHeroProductIds('x')).toEqual([]);
  });

  it('always keeps the catalogue and accepts only safe hero images', () => {
    expect(toSections(['bestSellers'])).toEqual(['bestSellers', 'catalog']);
    expect(toSections(undefined)).toEqual(['categories', 'bestSellers', 'newArrivals', 'catalog']);
    expect(heroImageOk('https://firebasestorage.googleapis.com/v0/b/x/o/y')).toBe(true);
    expect(heroImageOk('http://127.0.0.1:9199/v0/b/x')).toBe(true);
    expect(heroImageOk('http://evil.example/x.jpg')).toBe(false);
  });
});
