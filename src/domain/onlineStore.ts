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

/** Whole-site looks the owner picks from. Each one has its own layout, type and motion. */
export const STORE_THEMES = ['classic', 'perfume', 'atelier', 'studio', 'bistro'] as const;
export type StoreTheme = (typeof STORE_THEMES)[number];

/** Home page blocks between the hero and the footer, in the owner's order. The catalogue always stays. */
export const STORE_SECTIONS = ['categories', 'bestSellers', 'newArrivals', 'catalog'] as const;
export type StoreSection = (typeof STORE_SECTIONS)[number];

export const HERO_TITLE_MAX = 80;
export const HERO_SUBTITLE_MAX = 200;
export const HERO_CTA_MAX = 30;
export const HERO_IMAGE_URL_MAX = 1000;
/** Products the owner pins to the 3D showcase at the top of the page. */
export const HERO_PRODUCTS_MAX = 10;

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
  /** Delivery is free when the cart total reaches this; null means no free-delivery offer. */
  freeDeliveryOverUsdCents: number | null;
  /** Areas the shop delivers to, each with its own fee. Empty = no zones (no fee is charged). */
  deliveryZones: DeliveryZone[];
  /** Smallest cart (USD) accepted for delivery; null = no minimum. */
  minOrderUsdCents: number | null;
  /** Physical shop address shown on the website (with a map link). */
  storeAddress: string;
  /** Opening hours, Sunday first (7 entries), or empty when the owner has not set them. */
  hours: DayHours[];
  theme: StoreTheme;
  /** Owner's own hero text; empty strings fall back to the store name / tagline / "Shop now". */
  heroTitle: string;
  heroSubtitle: string;
  heroCta: string;
  /** Uploaded hero photo (https download URL), or '' to use product photos. */
  heroImageUrl: string;
  /** Products shown in the 3D showcase (clothes rail, perfume shelf...), in order. */
  heroProductIds: string[];
  sections: StoreSection[];
}

export interface DayHours {
  closed: boolean;
  /** "HH:MM", 24-hour. */
  open: string;
  close: string;
}

export const STORE_ADDRESS_MAX = 200;
export const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const STORE_TIMEZONE = 'Asia/Beirut';

export function defaultHours(): DayHours[] {
  return Array.from({ length: 7 }, () => ({ closed: false, open: '09:00', close: '21:00' }));
}

/** Defensive read: exactly 7 valid days, otherwise "not set". */
export function toStoreHours(v: unknown): DayHours[] {
  if (!Array.isArray(v) || v.length !== 7) return [];
  const out: DayHours[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') return [];
    const d = raw as Record<string, unknown>;
    const open = typeof d.open === 'string' && HHMM_RE.test(d.open) ? d.open : null;
    const close = typeof d.close === 'string' && HHMM_RE.test(d.close) ? d.close : null;
    if (open === null || close === null) return [];
    out.push({ closed: d.closed === true, open, close });
  }
  return out;
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Day of week (0 = Sunday) and minutes since midnight at the shop's local time. */
export function shopClock(at: Date, timeZone = STORE_TIMEZONE): { day: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { day: day < 0 ? 0 : day, minute: (Number(get('hour')) % 24) * 60 + Number(get('minute')) };
}

export interface OpenState {
  open: boolean;
  /** "HH:MM" the shop closes (when open) or next opens (when closed); null if unknown. */
  until: string | null;
  /** Day index of `until` when it is not today (closed shops opening another day). */
  untilDay: number | null;
}

/** Is the shop open at `clock`? Handles hours that run past midnight (close earlier than open). */
export function openState(hours: readonly DayHours[], clock: { day: number; minute: number }): OpenState | null {
  if (hours.length !== 7) return null;
  const today = hours[clock.day]!;
  const yesterday = hours[(clock.day + 6) % 7]!;
  // Still inside yesterday's overnight shift?
  if (!yesterday.closed && minutes(yesterday.close) < minutes(yesterday.open) && clock.minute < minutes(yesterday.close)) {
    return { open: true, until: yesterday.close, untilDay: null };
  }
  if (!today.closed) {
    const o = minutes(today.open);
    const c = minutes(today.close);
    const overnight = c < o;
    if (o === c) return { open: true, until: null, untilDay: null };
    if (clock.minute >= o && (overnight || clock.minute < c)) return { open: true, until: today.close, untilDay: null };
    if (clock.minute < o) return { open: false, until: today.open, untilDay: null };
  }
  for (let i = 1; i <= 7; i += 1) {
    const d = (clock.day + i) % 7;
    if (!hours[d]!.closed) return { open: false, until: hours[d]!.open, untilDay: d };
  }
  return { open: false, until: null, untilDay: null };
}

/** Google Maps search link for the shop address (opens the Maps app on phones). */
export function mapLink(address: string): string | null {
  const q = address.trim();
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
}

export interface DeliveryZone {
  /** Short stable id chosen when the owner adds the zone (lowercase letters and digits). */
  id: string;
  name: string;
  feeUsdCents: number;
}

export const DELIVERY_ZONES_MAX = 30;
export const ZONE_NAME_MAX = 40;
export const DELIVERY_FEE_MAX_USD_CENTS = 1_000_000;
export const ZONE_ID_RE = /^[a-z0-9]{1,12}$/;

/** A fresh zone id for the settings screen. */
export function newZoneId(): string {
  return Math.random().toString(36).slice(2, 10) || 'z1';
}

/** Defensive read of stored zones: valid entries only, unique ids, capped. */
export function toDeliveryZones(v: unknown): DeliveryZone[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: DeliveryZone[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue;
    const z = raw as Record<string, unknown>;
    const id = typeof z.id === 'string' ? z.id : '';
    const name = typeof z.name === 'string' ? z.name.trim().slice(0, ZONE_NAME_MAX) : '';
    const fee = z.feeUsdCents;
    if (!ZONE_ID_RE.test(id) || seen.has(id) || !name) continue;
    if (typeof fee !== 'number' || !Number.isInteger(fee) || fee < 0 || fee > DELIVERY_FEE_MAX_USD_CENTS) continue;
    seen.add(id);
    out.push({ id, name, feeUsdCents: fee });
    if (out.length >= DELIVERY_ZONES_MAX) break;
  }
  return out;
}

export type DeliveryProblem = 'zone' | 'minOrder';

export interface DeliveryQuote {
  feeUsdCents: number;
  zone: DeliveryZone | null;
  /** True when the free-delivery offer removed the zone fee. */
  free: boolean;
  problem: DeliveryProblem | null;
}

/**
 * What delivery costs for a cart. Used by the storefront to show the fee before ordering and by
 * the server to charge it, so both always agree. Pickup never pays a fee or needs a zone.
 */
export function deliveryQuote(
  b: Pick<StoreBranding, 'deliveryZones' | 'freeDeliveryOverUsdCents' | 'minOrderUsdCents'>,
  subtotalUsdCents: number,
  fulfillment: 'delivery' | 'pickup',
  zoneId: string | null | undefined,
): DeliveryQuote {
  if (fulfillment !== 'delivery') return { feeUsdCents: 0, zone: null, free: false, problem: null };
  const subtotal = Math.max(0, subtotalUsdCents);
  if (b.minOrderUsdCents !== null && subtotal < b.minOrderUsdCents) {
    return { feeUsdCents: 0, zone: null, free: false, problem: 'minOrder' };
  }
  if (b.deliveryZones.length === 0) return { feeUsdCents: 0, zone: null, free: false, problem: null };
  const zone = b.deliveryZones.find((z) => z.id === zoneId) ?? null;
  if (!zone) return { feeUsdCents: 0, zone: null, free: false, problem: 'zone' };
  const free = b.freeDeliveryOverUsdCents !== null && subtotal >= b.freeDeliveryOverUsdCents;
  return { feeUsdCents: free ? 0 : zone.feeUsdCents, zone, free: free && zone.feeUsdCents > 0, problem: null };
}

export const FREE_DELIVERY_MAX_USD_CENTS = 100_000_000;

/** Defensive read of the free-delivery threshold: a positive whole number of cents, or null. */
export function toFreeDeliveryThreshold(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= FREE_DELIVERY_MAX_USD_CENTS ? v : null;
}

/** Progress toward free delivery for a cart total; null when the store has no offer. */
export function freeDeliveryProgress(
  thresholdUsdCents: number | null,
  cartUsdCents: number,
): { remainingUsdCents: number; ratio: number; reached: boolean } | null {
  if (thresholdUsdCents === null || thresholdUsdCents <= 0) return null;
  const total = Math.max(0, cartUsdCents);
  const remaining = Math.max(0, thresholdUsdCents - total);
  return { remainingUsdCents: remaining, ratio: Math.min(1, total / thresholdUsdCents), reached: remaining === 0 };
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
  /** Per-product web details (description, price before discount). Applies live, like visibility. */
  listings: Record<string, ProductListing>;
  /** Running totals of approved reviews per product (kept by the server when reviews are moderated). */
  ratings: Record<string, RatingTotals>;
  /** Shop's own domain (e.g. shop.example.com) once mapped by the owner; '' when none. */
  customDomain: string;
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
    freeDeliveryOverUsdCents: null,
    deliveryZones: [],
    minOrderUsdCents: null,
    storeAddress: '',
    hours: [],
    theme: 'classic',
    heroTitle: '',
    heroSubtitle: '',
    heroCta: '',
    heroImageUrl: '',
    heroProductIds: [],
    sections: [...STORE_SECTIONS],
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
    listings: {},
    ratings: {},
    customDomain: '',
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
  /** Owner-written web description ('' when none). */
  description: string;
  /** Price before discount; only set when it is above the current USD price. */
  compareAtUsdCents: number | null;
  /** Approved-review average (one decimal) and count; null when there are no reviews yet. */
  rating: { average: number; count: number } | null;
  /** Added to the catalogue recently (see NEW_PRODUCT_DAYS). */
  isNew: boolean;
  /** Same product on a transparent background, when the owner made one; else null. */
  cutoutUrl: string | null;
}

export const NEW_PRODUCT_DAYS = 21;
const DAY_MS = 86_400_000;

/** Products sold most (by quantity) first; ties keep the order they were first seen. */
export function rankBestSellers(items: readonly { productId: string; quantity: number }[], max: number): string[] {
  const qty = new Map<string, number>();
  for (const it of items) {
    if (!it.productId || !Number.isFinite(it.quantity) || it.quantity <= 0) continue;
    qty.set(it.productId, (qty.get(it.productId) ?? 0) + it.quantity);
  }
  return [...qty.entries()]
    .map(([id, q], i) => ({ id, q, i }))
    .sort((a, b) => b.q - a.q || a.i - b.i)
    .slice(0, max)
    .map((x) => x.id);
}

export interface RatingTotals {
  count: number;
  sum: number;
}

/** Defensive read of the per-product rating totals map. */
export function toRatingTotals(v: unknown): Record<string, RatingTotals> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, RatingTotals> = {};
  for (const [id, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!LISTING_ID_RE.test(id) || !raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    const count = typeof o.count === 'number' && Number.isInteger(o.count) ? o.count : 0;
    const sum = typeof o.sum === 'number' && Number.isFinite(o.sum) ? o.sum : 0;
    if (count > 0 && sum >= count && sum <= count * 5) out[id] = { count, sum };
  }
  return out;
}

/** Average rounded to one decimal, or null with no reviews. */
export function ratingOf(t: RatingTotals | undefined): { average: number; count: number } | null {
  if (!t || t.count <= 0) return null;
  return { average: Math.round((t.sum / t.count) * 10) / 10, count: t.count };
}

export const LISTING_DESC_MAX = 600;

export interface ProductListing {
  description: string;
  compareAtUsdCents: number | null;
  /** Product photo with the background removed (for the 3D showcase), or '' when none. */
  cutoutUrl: string;
}

const LISTING_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** Defensive read of the stored listings map: known-shaped entries only, empty ones dropped. */
export function toListings(v: unknown): Record<string, ProductListing> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, ProductListing> = {};
  for (const [id, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!LISTING_ID_RE.test(id) || !raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    const description = typeof o.description === 'string' ? o.description.trim().slice(0, LISTING_DESC_MAX) : '';
    const compareAtUsdCents = toFreeDeliveryThreshold(o.compareAtUsdCents);
    const cutoutUrl = heroImageOk(o.cutoutUrl) ? o.cutoutUrl : '';
    if (!description && compareAtUsdCents === null && !cutoutUrl) continue;
    out[id] = { description, compareAtUsdCents, cutoutUrl };
  }
  return out;
}

export function projectPublicProduct(
  p: Pick<Product, 'id' | 'name' | 'category' | 'prices' | 'imageUrl' | 'stock'> & { createdAt?: number | null },
  listing?: ProductListing,
  totals?: RatingTotals,
  nowMs?: number,
): PublicProduct {
  const created = typeof p.createdAt === 'number' ? p.createdAt : 0;
  const price = p.prices.retail.usdCents;
  const compareAt = listing?.compareAtUsdCents ?? null;
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    priceUsdCents: price,
    priceLbp: p.prices.retail.lbp,
    imageUrl: p.imageUrl || null,
    inStock: p.stock > 0,
    description: listing?.description ?? '',
    compareAtUsdCents: compareAt !== null && price > 0 && compareAt > price ? compareAt : null,
    rating: ratingOf(totals),
    isNew: nowMs !== undefined && created > 0 && nowMs - created < NEW_PRODUCT_DAYS * DAY_MS,
    cutoutUrl: listing?.cutoutUrl || null,
  };
}

/** Whole-percent discount shown on the badge, or null when there is no real discount. */
export function discountPercent(p: Pick<PublicProduct, 'priceUsdCents' | 'compareAtUsdCents'>): number | null {
  if (p.compareAtUsdCents === null || p.priceUsdCents <= 0 || p.compareAtUsdCents <= p.priceUsdCents) return null;
  const pct = Math.round((1 - p.priceUsdCents / p.compareAtUsdCents) * 100);
  return pct >= 1 ? pct : null;
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
    theme: pick(STORE_THEMES, o.theme, base.theme),
    heroTitle: text(o.heroTitle, HERO_TITLE_MAX),
    heroSubtitle: text(o.heroSubtitle, HERO_SUBTITLE_MAX),
    heroCta: text(o.heroCta, HERO_CTA_MAX),
    heroImageUrl: heroImageOk(o.heroImageUrl) ? o.heroImageUrl : '',
    heroProductIds: toHeroProductIds(o.heroProductIds),
    sections: toSections(o.sections),
    primaryColor: color(o.primaryColor, base.primaryColor),
    accentColor: color(o.accentColor, base.accentColor),
    font: pick(STORE_FONTS, o.font, base.font),
    defaultLocale: pick(STORE_LOCALES, o.defaultLocale, base.defaultLocale),
    enabledLocales: locales,
    contactPhone: text(o.contactPhone, 16),
    whatsapp: text(o.whatsapp, 16),
    freeDeliveryOverUsdCents: toFreeDeliveryThreshold(o.freeDeliveryOverUsdCents),
    deliveryZones: toDeliveryZones(o.deliveryZones),
    minOrderUsdCents: toFreeDeliveryThreshold(o.minOrderUsdCents),
    storeAddress: text(o.storeAddress, STORE_ADDRESS_MAX),
    hours: toStoreHours(o.hours),
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
    listings: toListings(d.listings),
    ratings: toRatingTotals(d.ratings),
    customDomain: typeof d.customDomain === 'string' && !domainProblem(d.customDomain) ? d.customDomain : '',
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
  freeDeliveryOverUsdCents: number | null;
  deliveryZones: DeliveryZone[];
  minOrderUsdCents: number | null;
  storeAddress: string;
  hours: DayHours[];
  theme: StoreTheme;
  heroTitle: string;
  heroSubtitle: string;
  heroCta: string;
  heroImageUrl: string;
  heroProductIds: string[];
  sections: StoreSection[];
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
    freeDeliveryOverUsdCents: b.freeDeliveryOverUsdCents,
    deliveryZones: b.deliveryZones.map((z) => ({ ...z })),
    minOrderUsdCents: b.minOrderUsdCents,
    storeAddress: b.storeAddress,
    hours: b.hours.map((h) => ({ ...h })),
    theme: b.theme,
    heroTitle: b.heroTitle,
    heroSubtitle: b.heroSubtitle,
    heroCta: b.heroCta,
    heroImageUrl: b.heroImageUrl,
    heroProductIds: [...b.heroProductIds],
    sections: [...b.sections],
  };
}

/* ------------------------------------------------------------------ themes & hero */

/** Hero photos must be https (any host the page's CSP allows); plain http only for local emulators. */
export function heroImageOk(v: unknown): v is string {
  if (typeof v !== 'string' || !v || v.length > HERO_IMAGE_URL_MAX) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost'));
  } catch {
    return false;
  }
}

/** Unique, well-formed product ids, capped at HERO_PRODUCTS_MAX. */
export function toHeroProductIds(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(x) && !out.includes(x)) out.push(x);
    if (out.length >= HERO_PRODUCTS_MAX) break;
  }
  return out;
}

/** Known, unique sections in the given order; the catalogue is always kept (added last if missing). */
export function toSections(v: unknown): StoreSection[] {
  if (!Array.isArray(v)) return [...STORE_SECTIONS];
  const out: StoreSection[] = [];
  for (const x of v) {
    if ((STORE_SECTIONS as readonly unknown[]).includes(x) && !out.includes(x as StoreSection)) out.push(x as StoreSection);
  }
  if (!out.includes('catalog')) out.push('catalog');
  return out;
}

/* ------------------------------------------------------------------ store analytics */

/**
 * Privacy-friendly storefront analytics: one counter document per shop day, no visitor ids,
 * no cookies. The storefront reports at most one visit per browser session, one view per
 * product per session, one add per product and one checkout start; orders are counted by the
 * server when an order is actually placed.
 */
export const STORE_EVENTS = ['visit', 'view', 'add', 'checkout'] as const;
export type StoreEvent = (typeof STORE_EVENTS)[number];
export const STATS_RANGES = [7, 30] as const;
export type StatsRange = (typeof STATS_RANGES)[number];
export const STATS_TOP = 8;

export interface StoreDayStats {
  date: string;
  visits: number;
  views: number;
  adds: number;
  checkouts: number;
  orders: number;
  revenueUsdCents: number;
  viewsBy: Record<string, number>;
}

export interface StoreStatsTotals {
  visits: number;
  views: number;
  adds: number;
  checkouts: number;
  orders: number;
  revenueUsdCents: number;
}

export interface StoreStatsSummary {
  /** Oldest first, one row per day in the range (empty days are zeros). */
  days: (StoreStatsTotals & { date: string })[];
  totals: StoreStatsTotals;
  /** Orders per visit, as a whole percent; null with no visits. */
  conversionPct: number | null;
  topViewed: { productId: string; views: number }[];
}

/** The counter field each storefront event increments. */
export const EVENT_FIELD: Record<StoreEvent, keyof StoreStatsTotals> = {
  visit: 'visits',
  view: 'views',
  add: 'adds',
  checkout: 'checkouts',
};

function count(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

export function toDayStats(date: string, raw: unknown): StoreDayStats {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const by = d.viewsBy && typeof d.viewsBy === 'object' ? (d.viewsBy as Record<string, unknown>) : {};
  const viewsBy: Record<string, number> = {};
  for (const [id, n] of Object.entries(by)) if (count(n) > 0) viewsBy[id] = count(n);
  return {
    date,
    visits: count(d.visits),
    views: count(d.views),
    adds: count(d.adds),
    checkouts: count(d.checkouts),
    orders: count(d.orders),
    revenueUsdCents: count(d.revenueUsdCents),
    viewsBy,
  };
}

/** The `days` calendar dates ending at `endDate` (YYYY-MM-DD), oldest first. */
export function statDates(endDate: string, days: number): string[] {
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(end) || days < 1) return [];
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(new Date(end - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

export function summarizeStats(days: readonly StoreDayStats[], top = STATS_TOP): StoreStatsSummary {
  const totals: StoreStatsTotals = { visits: 0, views: 0, adds: 0, checkouts: 0, orders: 0, revenueUsdCents: 0 };
  const views = new Map<string, number>();
  const rows = days.map((d) => {
    totals.visits += d.visits;
    totals.views += d.views;
    totals.adds += d.adds;
    totals.checkouts += d.checkouts;
    totals.orders += d.orders;
    totals.revenueUsdCents += d.revenueUsdCents;
    for (const [id, n] of Object.entries(d.viewsBy)) views.set(id, (views.get(id) ?? 0) + n);
    return {
      date: d.date,
      visits: d.visits,
      views: d.views,
      adds: d.adds,
      checkouts: d.checkouts,
      orders: d.orders,
      revenueUsdCents: d.revenueUsdCents,
    };
  });
  const topViewed = [...views.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, top)
    .map(([productId, n]) => ({ productId, views: n }));
  const conversionPct = totals.visits > 0 ? Math.round((totals.orders / totals.visits) * 100) : null;
  return { days: rows, totals, conversionPct, topViewed };
}

/* ------------------------------------------------------------------ share previews & install */

export interface StoreShareMeta {
  slug: string;
  title: string;
  description: string;
  /** Absolute https URL of the preview image, or '' for none. */
  imageUrl: string;
  /** Absolute URL of the store page. */
  url: string;
  themeColor: string;
  locale: StoreLocale;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/** What WhatsApp, Facebook, Instagram and Google show when the store link is shared. */
export function storeShareMeta(slug: string, b: StoreBranding, origin: string, imageUrl: string): StoreShareMeta {
  const title = b.storeName.trim() || slug;
  const fallback = b.defaultLocale === 'ar' ? `اطلب أونلاين من ${title}` : `Order online from ${title}`;
  return {
    slug,
    title,
    description: (b.tagline.trim() || fallback).slice(0, 200),
    imageUrl: /^https:\/\//.test(imageUrl) ? imageUrl : '',
    url: `${origin.replace(/\/+$/, '')}/s/${encodeURIComponent(slug)}`,
    themeColor: HEX_COLOR_RE.test(b.primaryColor) ? b.primaryColor : '#0f172a',
    locale: b.defaultLocale,
  };
}

/**
 * Puts the store's own title, description, preview image and install manifest into the app's
 * HTML shell, replacing the generic ones. Everything inserted is HTML-escaped.
 */
export function injectShareMeta(html: string, m: StoreShareMeta): string {
  const e = escapeHtml;
  const tags = [
    `<meta name="description" content="${e(m.description)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${e(m.title)}" />`,
    `<meta property="og:description" content="${e(m.description)}" />`,
    `<meta property="og:url" content="${e(m.url)}" />`,
    `<meta property="og:locale" content="${m.locale === 'ar' ? 'ar_LB' : 'en_US'}" />`,
    m.imageUrl ? `<meta property="og:image" content="${e(m.imageUrl)}" />` : '',
    `<meta name="twitter:card" content="${m.imageUrl ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="apple-mobile-web-app-title" content="${e(m.title)}" />`,
    `<link rel="canonical" href="${e(m.url)}" />`,
    `<link rel="manifest" href="/s/${encodeURIComponent(m.slug)}/manifest.webmanifest" />`,
  ]
    .filter(Boolean)
    .join('\n    ');
  let out = html
    .replace(/<meta\s+name="description"[^>]*>\s*/i, '')
    .replace(/<link\s+rel="manifest"[^>]*>\s*/i, '')
    .replace(/<meta\s+name="theme-color"[^>]*>/i, '');
  out = /<title>[\s\S]*?<\/title>/i.test(out)
    ? out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${e(m.title)}</title>`)
    : out.replace(/<\/head>/i, `<title>${e(m.title)}</title>\n</head>`);
  return out.replace(/<\/head>/i, `    <meta name="theme-color" content="${e(m.themeColor)}" />\n    ${tags}\n  </head>`);
}

/** Per-store web app manifest so "Add to home screen" installs the shop, not the POS. */
export function storeManifest(m: StoreShareMeta): Record<string, unknown> {
  const start = `/s/${encodeURIComponent(m.slug)}`;
  return {
    name: m.title,
    short_name: m.title.slice(0, 24),
    description: m.description,
    id: start,
    start_url: start,
    scope: start,
    display: 'standalone',
    dir: m.locale === 'ar' ? 'rtl' : 'ltr',
    lang: m.locale,
    theme_color: m.themeColor,
    background_color: '#ffffff',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}

/* ------------------------------------------------------------------ custom domains */

export const DOMAIN_MAX = 120;
/** Hosts that belong to the platform itself and can never be claimed as a shop domain. */
const PLATFORM_HOST_RE = /(^|\.)(web\.app|firebaseapp\.com|localhost|zelvero\.com|zelveropos\.com)$/i;
const DOMAIN_RE = /^(?=.{4,120}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

export type DomainProblem = 'format' | 'reserved';

/** Lower-cases and strips scheme, path, port and a trailing dot from what the owner typed. */
export function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
}

export function domainProblem(domain: string): DomainProblem | null {
  if (!DOMAIN_RE.test(domain)) return 'format';
  if (PLATFORM_HOST_RE.test(domain) || /^\d+(\.\d+){3}$/.test(domain)) return 'reserved';
  return null;
}
