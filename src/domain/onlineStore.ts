// Online Store (Milestone A): pure rules shared by the settings screen and the Cloud Functions.
// Framework-free: copied into functions/src/shared by functions/scripts/copy-shared.mjs.
import type { Product } from '@/types/models';

export const ONLINE_STORE_FEATURE_ID = 'online_store';

export const STORE_TEMPLATES = ['retail', 'grocery', 'restaurant'] as const;
export type StoreTemplate = (typeof STORE_TEMPLATES)[number];

export const STORE_LOCALES = ['ar', 'en'] as const;
export type StoreLocale = (typeof STORE_LOCALES)[number];

export const STORE_FONTS = ['system', 'cairo', 'tajawal', 'inter'] as const;
export type StoreFont = (typeof STORE_FONTS)[number];

/** Max products the owner can show online in Milestone A (one Firestore doc holds the list). */
export const MAX_VISIBLE_PRODUCTS = 500;
export const STORE_NAME_MAX = 80;
export const STORE_TAGLINE_MAX = 160;

/** Same shape as a tenant subdomain: 3-30 chars, lowercase letters, digits, inner dashes. */
export const STORE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;
export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
/** Lebanese and international phone numbers, digits with an optional leading +. */
export const STORE_PHONE_RE = /^\+?[0-9]{6,15}$/;

export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'admin', 'api', 'app', 'apps', 'www', 'mail', 'email', 'smtp', 'ftp', 'cdn', 'static', 'assets',
  'zelvero', 'zelvoro', 'zelveropos', 'zelvoropos', 'store', 'stores', 'shop', 'shops', 'help',
  'support', 'status', 'docs', 'blog', 'preview', 'staging', 'stage', 'dev', 'test', 'demo',
  'login', 'signup', 'register', 'account', 'accounts', 'billing', 'pay', 'payment', 'payments',
  'checkout', 'cart', 'orders', 'order', 'dashboard', 'pos', 'root', 'system', 'security',
  'superadmin', 'partner', 'partners', 'online-store', 'website', 'websites',
]);

export type SlugProblem = 'format' | 'reserved';

export function normalizeSlug(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Null when the slug can be claimed (uniqueness is checked on the server). */
export function slugProblem(slug: string): SlugProblem | null {
  if (!STORE_SLUG_RE.test(slug) || slug.includes('--')) return 'format';
  if (RESERVED_SLUGS.has(slug)) return 'reserved';
  return null;
}

export interface StoreBranding {
  storeName: string;
  tagline: string;
  template: StoreTemplate;
  primaryColor: string;
  accentColor: string;
  font: StoreFont;
  defaultLocale: StoreLocale;
  enabledLocales: StoreLocale[];
  contactPhone: string;
  whatsapp: string;
}

export type StorePublication = 'draft' | 'published';

/** What the owner sees in settings. Stored at onlineStores/{tenantId}; never readable by clients. */
export interface OnlineStoreConfig {
  enabled: boolean;
  slug: string | null;
  publication: StorePublication;
  draft: StoreBranding;
  /** Snapshot copied from draft at publish time. Public pages only ever read this. */
  published: StoreBranding | null;
  visibleProductIds: string[];
  publishedAt: number | null;
  updatedAt: number | null;
}

export function defaultBranding(storeName = ''): StoreBranding {
  return {
    storeName: storeName.slice(0, STORE_NAME_MAX),
    tagline: '',
    template: 'retail',
    primaryColor: '#1F6FEB',
    accentColor: '#F59E0B',
    font: 'system',
    defaultLocale: 'ar',
    enabledLocales: ['ar', 'en'],
    contactPhone: '',
    whatsapp: '',
  };
}

export function emptyStoreConfig(storeName = ''): OnlineStoreConfig {
  return {
    enabled: false,
    slug: null,
    publication: 'draft',
    draft: defaultBranding(storeName),
    published: null,
    visibleProductIds: [],
    publishedAt: null,
    updatedAt: null,
  };
}

export type BrandingProblem = 'storeName' | 'colors' | 'locales' | 'phone';

/** Problems that block publishing; a draft may be saved with them. */
export function brandingProblems(b: StoreBranding): BrandingProblem[] {
  const out: BrandingProblem[] = [];
  if (!b.storeName.trim()) out.push('storeName');
  if (!HEX_COLOR_RE.test(b.primaryColor) || !HEX_COLOR_RE.test(b.accentColor)) out.push('colors');
  if (b.enabledLocales.length === 0 || !b.enabledLocales.includes(b.defaultLocale)) out.push('locales');
  if ((b.contactPhone && !STORE_PHONE_RE.test(b.contactPhone)) || (b.whatsapp && !STORE_PHONE_RE.test(b.whatsapp))) {
    out.push('phone');
  }
  return out;
}

export type PublishBlocker = 'disabled' | 'noSlug' | 'branding' | 'noProducts';

export function publishBlockers(config: OnlineStoreConfig): PublishBlocker[] {
  const out: PublishBlocker[] = [];
  if (!config.enabled) out.push('disabled');
  if (!config.slug) out.push('noSlug');
  if (brandingProblems(config.draft).length > 0) out.push('branding');
  if (config.visibleProductIds.length === 0) out.push('noProducts');
  return out;
}

export function isRtl(locale: StoreLocale): boolean {
  return locale === 'ar';
}

/**
 * The only product shape a public visitor ever receives. Built from an explicit whitelist so a
 * new Product field can never leak: no cost, supplier, barcode, IMEIs, wholesale/VIP price, or
 * exact stock count.
 */
export interface PublicProduct {
  id: string;
  name: string;
  category: string;
  priceUsdCents: number;
  priceLbp: number | null;
  imageUrl: string | null;
  inStock: boolean;
}

export function projectPublicProduct(p: Pick<Product, 'id' | 'name' | 'category' | 'prices' | 'imageUrl' | 'stock'>): PublicProduct {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    priceUsdCents: p.prices.retail.usdCents,
    priceLbp: p.prices.retail.lbp,
    imageUrl: p.imageUrl || null,
    inStock: p.stock > 0,
  };
}

/** Distinct ids, original order, capped. Used before writing the owner's visibility list. */
export function cleanVisibleIds(ids: readonly string[], max = MAX_VISIBLE_PRODUCTS): string[] {
  return [...new Set(ids)].slice(0, max);
}

/* ---------------------------------------------------------------- stored-doc normalizers */

function pick<T extends string>(allowed: readonly T[], v: unknown, fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const color = (v: unknown, fallback: string): string => (typeof v === 'string' && HEX_COLOR_RE.test(v) ? v : fallback);

/** Defensive read of a stored branding map; unknown or broken values fall back to defaults. */
export function toStoreBranding(v: unknown, storeName = ''): StoreBranding {
  const base = defaultBranding(storeName);
  if (!v || typeof v !== 'object') return base;
  const o = v as Record<string, unknown>;
  const locales = Array.isArray(o.enabledLocales)
    ? STORE_LOCALES.filter((l) => (o.enabledLocales as unknown[]).includes(l))
    : base.enabledLocales;
  return {
    storeName: typeof o.storeName === 'string' ? text(o.storeName, STORE_NAME_MAX) : base.storeName,
    tagline: text(o.tagline, STORE_TAGLINE_MAX),
    template: pick(STORE_TEMPLATES, o.template, base.template),
    primaryColor: color(o.primaryColor, base.primaryColor),
    accentColor: color(o.accentColor, base.accentColor),
    font: pick(STORE_FONTS, o.font, base.font),
    defaultLocale: pick(STORE_LOCALES, o.defaultLocale, base.defaultLocale),
    enabledLocales: locales,
    contactPhone: text(o.contactPhone, 16),
    whatsapp: text(o.whatsapp, 16),
  };
}

/** Defensive read of onlineStores/{tenantId}. A missing doc is a fresh, disabled store. */
export function toStoreConfig(d: Record<string, unknown> | undefined, storeName = ''): OnlineStoreConfig {
  if (!d) return emptyStoreConfig(storeName);
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    enabled: d.enabled === true,
    slug: typeof d.slug === 'string' && slugProblem(d.slug) !== 'format' ? d.slug : null,
    publication: d.publication === 'published' ? 'published' : 'draft',
    draft: toStoreBranding(d.draft, storeName),
    published: d.published && typeof d.published === 'object' ? toStoreBranding(d.published, storeName) : null,
    visibleProductIds: Array.isArray(d.visibleProductIds)
      ? cleanVisibleIds(d.visibleProductIds.filter((x): x is string => typeof x === 'string'))
      : [],
    publishedAt: num(d.publishedAt),
    updatedAt: num(d.updatedAt),
  };
}

/** The public-facing store header. Only fields from the published snapshot. */
export interface PublicStore {
  slug: string;
  storeName: string;
  tagline: string;
  template: StoreTemplate;
  primaryColor: string;
  accentColor: string;
  font: StoreFont;
  defaultLocale: StoreLocale;
  enabledLocales: StoreLocale[];
  contactPhone: string;
  whatsapp: string;
}

export function projectPublicStore(slug: string, b: StoreBranding): PublicStore {
  return {
    slug,
    storeName: b.storeName,
    tagline: b.tagline,
    template: b.template,
    primaryColor: b.primaryColor,
    accentColor: b.accentColor,
    font: b.font,
    defaultLocale: b.defaultLocale,
    enabledLocales: [...b.enabledLocales],
    contactPhone: b.contactPhone,
    whatsapp: b.whatsapp,
  };
}
