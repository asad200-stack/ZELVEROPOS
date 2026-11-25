/**
 * Shop websites for search engines and shopping catalogues. Pure functions shared with the
 * server (functions/src/storePage.ts serves them):
 *
 *   /s/{slug}               page HTML gets schema.org data (Google reads products and prices)
 *   /s/{slug}/sitemap.xml   every product's own link, so Google finds them all
 *   /s/{slug}/feed.xml      product catalogue for Facebook / Instagram Shopping and Google
 *                           Merchant Center (RSS 2.0 with Google's g: fields, read by both)
 *   /robots.txt             points search engines at every shop's sitemap
 */
import type { PublicProduct } from './onlineStore';

export interface SeoStore {
  name: string;
  description: string;
  /** Absolute URL of the shop page, e.g. https://zelvoropos.web.app/s/todayslook */
  url: string;
  imageUrl: string;
  locale: 'ar' | 'en';
}

type SeoProduct = Pick<
  PublicProduct,
  'id' | 'name' | 'category' | 'priceUsdCents' | 'priceLbp' | 'imageUrl' | 'images' | 'inStock' | 'description' | 'compareAtUsdCents' | 'groupId' | 'groupName'
>;

export const escapeXml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] ?? c);

/** Keeps "</script>" and friends out of a JSON block inside HTML. */
const jsonForHtml = (v: unknown): string => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

export const productUrl = (store: SeoStore, id: string): string => `${store.url}?p=${encodeURIComponent(id)}`;

/* ------------------------------------------------------------------ resized photos */

/** Widths the photo server makes; anything else is refused (keeps the cache small). */
export const STORE_IMAGE_WIDTHS = [320, 640, 960, 1200] as const;
export type StoreImageWidth = (typeof STORE_IMAGE_WIDTHS)[number];
export type StoreImageFormat = 'webp' | 'jpg';

/** Short fingerprint of a photo's address: a new photo gets new links, so caches never show the old one. */
export function imageVersion(url: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Link to a product's main photo at a given width, made by the shop's photo server
 * (/s/{slug}/img/{id}-{width}.{format}). `origin` is '' for links on the same site.
 */
export function storeImageUrl(origin: string, slug: string, productId: string, imageUrl: string, width: StoreImageWidth, format: StoreImageFormat = 'webp'): string {
  return `${origin}/s/${encodeURIComponent(slug)}/img/${encodeURIComponent(productId)}-${width}.${format}?v=${imageVersion(imageUrl)}`;
}

/** Reads /s/{slug}/img/{id}-{width}.{format}; null when it isn't a valid photo link. */
export function parseStoreImagePath(path: string): { slug: string; productId: string; width: StoreImageWidth; format: StoreImageFormat } | null {
  const m = /^\/s\/([a-z0-9-]{3,30})\/img\/([A-Za-z0-9_-]{1,128})-(\d{3,4})\.(webp|jpg)$/.exec(path);
  if (!m) return null;
  const width = Number(m[3]);
  if (!(STORE_IMAGE_WIDTHS as readonly number[]).includes(width)) return null;
  return { slug: m[1] ?? '', productId: m[2] ?? '', width: width as StoreImageWidth, format: m[4] as StoreImageFormat };
}

const httpsOnly = (u: string | null | undefined): string => (u && /^https:\/\//.test(u) ? u : '');

/** Price as the catalogues want it: "12.50 USD", or the Lira price when there is no dollar price. */
export function feedPrice(usdCents: number, lbp: number | null): string {
  if (usdCents > 0) return `${(usdCents / 100).toFixed(2)} USD`;
  if (lbp && lbp > 0) return `${Math.round(lbp)} LBP`;
  return '';
}

function offer(store: SeoStore, p: SeoProduct) {
  const usd = p.priceUsdCents > 0;
  return {
    '@type': 'Offer',
    url: productUrl(store, p.id),
    price: usd ? (p.priceUsdCents / 100).toFixed(2) : String(Math.round(p.priceLbp ?? 0)),
    priceCurrency: usd ? 'USD' : 'LBP',
    availability: p.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    itemCondition: 'https://schema.org/NewCondition',
  };
}

/** schema.org Product, what Google shows as a product result (name, photo, price, stock). */
export function productSchema(store: SeoStore, p: SeoProduct): Record<string, unknown> {
  const images = [httpsOnly(p.imageUrl), ...(p.images ?? []).map(httpsOnly)].filter(Boolean);
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: (p.groupId && p.groupName.trim()) || p.name,
    ...(images.length ? { image: images } : {}),
    description: (p.description || `${p.name} — ${store.name}`).slice(0, 5000),
    sku: p.id,
    ...(p.category.trim() ? { category: p.category.trim() } : {}),
    brand: { '@type': 'Brand', name: store.name },
    offers: offer(store, p),
  };
}

/** schema.org for the shop page: the shop itself and the list of its products. */
export function storeSchema(store: SeoStore, products: readonly SeoProduct[]): Record<string, unknown>[] {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Store',
      name: store.name,
      url: store.url,
      ...(store.description ? { description: store.description } : {}),
      ...(httpsOnly(store.imageUrl) ? { image: store.imageUrl } : {}),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      itemListElement: products.slice(0, 100).map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: productUrl(store, p.id), name: p.name })),
    },
  ];
}

/**
 * Adds the schema.org data and a plain list of product links (inside <noscript>, read by search
 * engines and shown only when scripts are off) to the page HTML.
 */
export function injectSeo(html: string, store: SeoStore, products: readonly SeoProduct[], product: SeoProduct | null): string {
  const data = product ? [productSchema(store, product)] : storeSchema(store, products);
  const ld = data.map((d) => `<script type="application/ld+json">${jsonForHtml(d)}</script>`).join('\n    ');
  const items = products
    .slice(0, 200)
    .map((p) => `<li><a href="${escapeXml(productUrl(store, p.id))}">${escapeXml(p.name)}</a> ${escapeXml(feedPrice(p.priceUsdCents, p.priceLbp))}</li>`)
    .join('');
  const noscript = `<noscript><h1>${escapeXml(store.name)}</h1>${store.description ? `<p>${escapeXml(store.description)}</p>` : ''}<ul>${items}</ul></noscript>`;
  return html.replace(/<\/head>/i, `    ${ld}\n  </head>`).replace(/<body([^>]*)>/i, `<body$1>\n    ${noscript}`);
}

/** sitemap.xml: the shop page and one link per product. */
export function sitemapXml(store: SeoStore, products: readonly SeoProduct[]): string {
  const urls = [store.url, ...products.map((p) => productUrl(store, p.id))];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `  <url><loc>${escapeXml(u)}</loc></url>`)
    .join('\n')}\n</urlset>\n`;
}

/**
 * Path of the list of every published shop's sitemap. robots.txt is a static file pointing here:
 * Google's front end answers /robots.txt itself (an empty 404) before a function can, so the
 * function serves this list on a path under /s/ instead.
 */
export const SITEMAP_INDEX_PATH = '/s/sitemaps.xml';

/** sitemap index: one entry per shop sitemap. */
export function sitemapIndexXml(sitemaps: readonly string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemaps
    .map((u) => `  <sitemap><loc>${escapeXml(u)}</loc></sitemap>`)
    .join('\n')}${sitemaps.length ? '\n' : ''}</sitemapindex>\n`;
}

/**
 * Product catalogue feed (RSS 2.0 + g: fields). Meta Commerce Manager (Facebook / Instagram
 * Shopping) and Google Merchant Center both read it from a scheduled URL. Products without a
 * photo or a price are left out: both catalogues reject them.
 */
export function productFeedXml(store: SeoStore, products: readonly SeoProduct[], jpegOf?: (p: SeoProduct) => string): string {
  const items = products
    .filter((p) => httpsOnly(p.imageUrl) && feedPrice(p.priceUsdCents, p.priceLbp))
    .map((p) => {
      const sale = p.compareAtUsdCents !== null && p.priceUsdCents > 0 && p.compareAtUsdCents > p.priceUsdCents;
      // Extra photos stay WebP: only Google reads them (Meta needs JPEG), so they are left out for Meta.
      const extra = jpegOf ? [] : (p.images ?? []).map(httpsOnly).filter(Boolean).slice(0, 10);
      const fields: [string, string][] = [
        ['g:id', p.id],
        ['g:title', p.name.slice(0, 150)],
        ['g:description', (p.description || `${p.name}${p.category.trim() ? ` — ${p.category.trim()}` : ''}`).slice(0, 5000)],
        ['g:link', productUrl(store, p.id)],
        // Meta's catalogue takes JPEG or PNG only; the shop's photos are WebP.
        ['g:image_link', jpegOf ? jpegOf(p) : httpsOnly(p.imageUrl)],
        ...extra.map((u): [string, string] => ['g:additional_image_link', u]),
        ['g:availability', p.inStock ? 'in stock' : 'out of stock'],
        ['g:condition', 'new'],
        ['g:price', sale ? feedPrice(p.compareAtUsdCents ?? 0, null) : feedPrice(p.priceUsdCents, p.priceLbp)],
        ...(sale ? [['g:sale_price', feedPrice(p.priceUsdCents, null)] as [string, string]] : []),
        ['g:brand', store.name],
        ...(p.category.trim() ? [['g:product_type', p.category.trim()] as [string, string]] : []),
        ...(p.groupId ? [['g:item_group_id', p.groupId] as [string, string]] : []),
      ];
      return `    <item>\n${fields.map(([k, v]) => `      <${k}>${escapeXml(v)}</${k}>`).join('\n')}\n    </item>`;
    });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n  <channel>\n    <title>${escapeXml(store.name)}</title>\n    <link>${escapeXml(store.url)}</link>\n    <description>${escapeXml(store.description || store.name)}</description>\n${items.join('\n')}\n  </channel>\n</rss>\n`;
}

/** robots.txt for the whole site: everything may be read, and here are the shops' sitemaps. */
export function robotsTxt(sitemaps: readonly string[]): string {
  return ['User-agent: *', 'Allow: /', '', ...sitemaps.map((s) => `Sitemap: ${s}`), ''].join('\n');
}
