/**
 * Online Store — Milestone A: store config, slug, publish/unpublish, product visibility, and a
 * read-only public catalog.
 *
 * Gating (fails closed, re-checked live on every call, mirrors aiCopilot.ts):
 *   1. The platform Super Admin's own internal demo tenant.
 *   2. A real tenant's owner, only while that tenant holds an active Feature Center entitlement for
 *      'online_store', the platform kill switch is off, and the subscription is active.
 * Owner-only: sub-users are never allowed to change the store in Milestone A.
 *
 * The tenant always comes from the caller's own token (owner callables) or from the server-owned
 * slug index (public catalog), never from the request body; strict input schemas reject any
 * tenant/store/uid field. Data lives at onlineStores/{tenantId} and onlineStoreSlugs/{slug}, which
 * Firestore rules deny to every client (no matching rule). No order, stock, or product writes here.
 */
import type { DocumentData, DocumentReference } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { auth, db } from './admin.js';
import { subUntilOf } from './claims.js';
import { REGION } from './config.js';
import { fail, rethrowClientSafe } from './errors.js';
import { businessDate, idField, tenantPaths, toProduct } from './pos/common.js';
import { platformClientIp } from './requestIp.js';
import { ipSignal } from './salesModel.js';
import {
  HEX_COLOR_RE,
  MAX_VISIBLE_PRODUCTS,
  ONLINE_STORE_FEATURE_ID,
  STORE_FONTS,
  STORE_LOCALES,
  STORE_NAME_MAX,
  STORE_PHONE_RE,
  FREE_DELIVERY_MAX_USD_CENTS,
  LISTING_DESC_MAX,
  HHMM_RE,
  STORE_ADDRESS_MAX,
  DELIVERY_FEE_MAX_USD_CENTS,
  DELIVERY_ZONES_MAX,
  ZONE_ID_RE,
  ZONE_NAME_MAX,
  STORE_TAGLINE_MAX,
  STORE_TEMPLATES,
  EVENT_FIELD,
  STATS_RANGES,
  STATS_TOP,
  STORE_EVENTS,
  DOMAIN_MAX,
  HERO_CTA_MAX,
  HERO_PRODUCTS_MAX,
  toHeroProductIds,
  HERO_IMAGE_URL_MAX,
  HERO_SUBTITLE_MAX,
  HERO_TITLE_MAX,
  STORE_SECTIONS,
  STORE_THEMES,
  heroImageOk,
  toSections,
  domainProblem,
  normalizeDomain,
  cleanVisibleIds,
  statDates,
  summarizeStats,
  toDayStats,
  type StoreStatsSummary,
  normalizeSlug,
  projectPublicProduct,
  rankBestSellers,
  projectPublicStore,
  publishBlockers,
  slugProblem,
  toStoreConfig,
  type OnlineStoreConfig,
  type PublicProduct,
  type PublicStore,
} from './shared/onlineStore.js';
import { summarizeSalesSplit, toOnlineOrder, type SalesSplit } from './shared/onlineOrders.js';
import { caller, parse, type Caller } from './validate.js';

/** Products offered to the owner's picker; a larger catalog is truncated (flagged in the reply). */
const OWNER_PICKER_CAP = 2000;
/** Public catalog reads per IP per hour. */
const PUBLIC_CATALOG_PER_HOUR = 300;

/* ------------------------------------------------------------------ authorization */

export interface StorePrincipal {
  uid: string;
  tenantId: string;
}

async function internalDemoPrincipal(c: Caller): Promise<StorePrincipal | null> {
  if (!c.superAdmin) return null;
  const record = await auth.getUser(c.uid);
  if (record.customClaims?.superAdmin !== true || record.emailVerified !== true || record.disabled === true) {
    return null;
  }
  const tenantId = c.uid;
  const [user, subscription, tenant] = await Promise.all([
    db.doc(`users/${c.uid}`).get(),
    db.doc(`subscriptions/${tenantId}`).get(),
    db.doc(`tenants/${tenantId}`).get(),
  ]);
  if (
    user.get('internalDemo') !== true ||
    user.get('tenantId') !== tenantId ||
    user.get('role') !== 'owner' ||
    user.get('isActive') === false ||
    subscription.get('internalDemo') !== true ||
    !tenant.exists ||
    subUntilOf(subscription.data()) <= Date.now()
  ) {
    return null;
  }
  return { uid: c.uid, tenantId };
}

/** True while the tenant may run an online store: entitlement active, not killed, subscribed. */
export async function tenantEntitled(tenantId: string): Promise<boolean> {
  const [subscription, control, entitlement] = await Promise.all([
    db.doc(`subscriptions/${tenantId}`).get(),
    db.doc('platformFeatureControl/global').get(),
    db.doc(`platformFeatureEntitlements/${tenantId}__${ONLINE_STORE_FEATURE_ID}`).get(),
  ]);
  if (subUntilOf(subscription.data()) <= Date.now()) return false;
  if (subscription.get('internalDemo') === true) return true;
  return control.get('killed') !== true && entitlement.get('status') === 'active';
}

async function customerPrincipal(c: Caller): Promise<StorePrincipal | null> {
  if (!c.tenantId || c.role !== 'owner' || !c.active || !c.emailVerified) return null;
  const [subscription, control, entitlement] = await Promise.all([
    db.doc(`subscriptions/${c.tenantId}`).get(),
    db.doc('platformFeatureControl/global').get(),
    db.doc(`platformFeatureEntitlements/${c.tenantId}__${ONLINE_STORE_FEATURE_ID}`).get(),
  ]);
  if (
    subUntilOf(subscription.data()) <= Date.now() ||
    control.get('killed') === true ||
    entitlement.get('status') !== 'active'
  ) {
    return null;
  }
  return { uid: c.uid, tenantId: c.tenantId };
}

export async function resolveStorePrincipal(c: Caller): Promise<StorePrincipal> {
  const principal = (await internalDemoPrincipal(c)) ?? (await customerPrincipal(c));
  if (!principal) fail('permission-denied', 'error.fn.notAllowed');
  return principal;
}

/* ------------------------------------------------------------------ input */

/** The web client adds these to every call; they are not part of any store input. */
export function stripTransport(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const copy = { ...(data as Record<string, unknown>) };
  delete copy.clientApiVersion;
  delete copy.clientReleaseVersion;
  return copy;
}

const phoneField = z.union([z.literal(''), z.string().regex(STORE_PHONE_RE)]);
const brandingSchema = z.strictObject({
  storeName: z.string().trim().max(STORE_NAME_MAX),
  tagline: z.string().trim().max(STORE_TAGLINE_MAX),
  template: z.enum(STORE_TEMPLATES),
  primaryColor: z.string().regex(HEX_COLOR_RE),
  accentColor: z.string().regex(HEX_COLOR_RE),
  font: z.enum(STORE_FONTS),
  defaultLocale: z.enum(STORE_LOCALES),
  enabledLocales: z.array(z.enum(STORE_LOCALES)).min(1).max(STORE_LOCALES.length),
  contactPhone: phoneField,
  whatsapp: phoneField,
  // Optional so older clients that do not send it still validate; null = no free-delivery offer.
  freeDeliveryOverUsdCents: z.number().int().min(1).max(FREE_DELIVERY_MAX_USD_CENTS).nullable().default(null),
  // Optional for older clients. Zone ids must be unique (checked below).
  deliveryZones: z
    .array(
      z.strictObject({
        id: z.string().regex(ZONE_ID_RE),
        name: z.string().trim().min(1).max(ZONE_NAME_MAX),
        feeUsdCents: z.number().int().min(0).max(DELIVERY_FEE_MAX_USD_CENTS),
      }),
    )
    .max(DELIVERY_ZONES_MAX)
    .default([])
    .refine((zones) => new Set(zones.map((z) => z.id)).size === zones.length),
  minOrderUsdCents: z.number().int().min(1).max(FREE_DELIVERY_MAX_USD_CENTS).nullable().default(null),
  storeAddress: z.string().trim().max(STORE_ADDRESS_MAX).default(''),
  // Either not set (empty) or one entry per weekday, Sunday first.
  hours: z
    .array(z.strictObject({ closed: z.boolean(), open: z.string().regex(HHMM_RE), close: z.string().regex(HHMM_RE) }))
    .max(7)
    .default([])
    .refine((h) => h.length === 0 || h.length === 7),
  // Theme and hero (optional for older clients).
  theme: z.enum(STORE_THEMES).default('classic'),
  heroTitle: z.string().trim().max(HERO_TITLE_MAX).default(''),
  heroSubtitle: z.string().trim().max(HERO_SUBTITLE_MAX).default(''),
  heroCta: z.string().trim().max(HERO_CTA_MAX).default(''),
  heroImageUrl: z
    .string()
    .max(HERO_IMAGE_URL_MAX)
    .default('')
    .refine((u) => u === '' || heroImageOk(u)),
  sections: z.array(z.enum(STORE_SECTIONS)).max(STORE_SECTIONS.length).default([...STORE_SECTIONS]).transform(toSections),
  heroProductIds: z.array(idField).max(HERO_PRODUCTS_MAX).default([]).transform(toHeroProductIds),
});
const emptySchema = z.strictObject({});
const saveDraftSchema = z.strictObject({ enabled: z.boolean(), draft: brandingSchema });
const slugSchema = z.strictObject({ slug: z.string().min(1).max(64) });
const visibilitySchema = z.strictObject({ productIds: z.array(idField).max(MAX_VISIBLE_PRODUCTS) });
const listingSchema = z.strictObject({
  productId: idField,
  description: z.string().max(LISTING_DESC_MAX * 2),
  compareAtUsdCents: z.number().int().min(1).max(FREE_DELIVERY_MAX_USD_CENTS).nullable(),
  // Optional: older clients don't send it, and then the stored cut-out is kept as is.
  cutoutUrl: z
    .string()
    .max(HERO_IMAGE_URL_MAX)
    .refine((u) => u === '' || heroImageOk(u))
    .optional(),
  lookUrl: z
    .string()
    .max(HERO_IMAGE_URL_MAX)
    .refine((u) => u === '' || heroImageOk(u))
    .optional(),
});

/* ------------------------------------------------------------------ helpers */

export const storeRef = (tenantId: string): DocumentReference => db.doc(`onlineStores/${tenantId}`);
export const slugRef = (slug: string): DocumentReference => db.doc(`onlineStoreSlugs/${slug}`);

async function storeNameOf(tenantId: string): Promise<string> {
  const settings = await tenantPaths(tenantId).settings.get();
  const name = settings.get('storeName');
  return typeof name === 'string' ? name : '';
}

async function loadConfig(tenantId: string): Promise<OnlineStoreConfig> {
  const [snap, storeName] = await Promise.all([storeRef(tenantId).get(), storeNameOf(tenantId)]);
  return toStoreConfig(snap.data(), storeName);
}

export async function ownerCall<T>(request: CallableRequest, run: (p: StorePrincipal, data: unknown) => Promise<T>): Promise<T> {
  try {
    const principal = await resolveStorePrincipal(caller(request));
    return await run(principal, stripTransport(request.data));
  } catch (err) {
    rethrowClientSafe(err);
  }
}

/** Reads products in batches of 100 (getAll limit-friendly), keeping only active ones. */
export async function activeProducts(tenantId: string, ids: readonly string[]): Promise<Map<string, DocumentData>> {
  const out = new Map<string, DocumentData>();
  const paths = tenantPaths(tenantId);
  for (let i = 0; i < ids.length; i += 100) {
    const refs = ids.slice(i, i + 100).map((id) => paths.doc('products', id));
    if (refs.length === 0) continue;
    const snaps = await db.getAll(...refs);
    for (const s of snaps) {
      const data = s.data();
      if (data && data.status !== 'archived') out.set(s.id, data);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ owner callables */

export interface OwnerConfigResponse {
  config: OnlineStoreConfig;
  products: PublicProduct[];
  productsTruncated: boolean;
}

export const onlineStoreGetConfig = onCall({ region: REGION }, (request) =>
  ownerCall(request, async ({ tenantId }, data): Promise<OwnerConfigResponse> => {
    parse(emptySchema, data);
    const [config, snap] = await Promise.all([
      loadConfig(tenantId),
      tenantPaths(tenantId).col('products').where('status', '==', 'active').limit(OWNER_PICKER_CAP + 1).get(),
    ]);
    const docs = snap.docs.slice(0, OWNER_PICKER_CAP);
    const products = docs
      .map((d) => projectPublicProduct(toProduct(d.id, d.data()), config.listings[d.id], config.ratings[d.id]))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { config, products, productsTruncated: snap.docs.length > OWNER_PICKER_CAP };
  }),
);

export const onlineStoreSaveDraft = onCall({ region: REGION }, (request) =>
  ownerCall(request, async ({ tenantId }, data): Promise<{ config: OnlineStoreConfig }> => {
    const input = parse(saveDraftSchema, data);
    const draft = { ...input.draft, enabledLocales: STORE_LOCALES.filter((l) => input.draft.enabledLocales.includes(l)) };
    const ref = storeRef(tenantId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const patch: DocumentData = { enabled: input.enabled, draft, updatedAt: Date.now() };
      // Disabling the store also takes it offline; re-enabling never auto-publishes.
      if (!input.enabled) {
        patch.publication = 'draft';
        patch.published = null;
      }
      if (!snap.exists) {
        tx.set(ref, { slug: null, publication: 'draft', published: null, visibleProductIds: [], publishedAt: null, ...patch });
      } else {
        tx.set(ref, patch, { merge: true });
      }
    });
    return { config: await loadConfig(tenantId) };
  }),
);

export const onlineStoreSetSlug = onCall({ region: REGION }, (request) =>
  ownerCall(request, async ({ tenantId }, data): Promise<{ config: OnlineStoreConfig }> => {
    const slug = normalizeSlug(parse(slugSchema, data).slug);
    const problem = slugProblem(slug);
    if (problem === 'format') fail('invalid-argument', 'error.onlineStore.slugInvalid');
    if (problem === 'reserved') fail('invalid-argument', 'error.onlineStore.slugReserved');
    const sRef = storeRef(tenantId);
    const newRef = slugRef(slug);
    await db.runTransaction(async (tx) => {
      const [store, claimed] = await Promise.all([tx.get(sRef), tx.get(newRef)]);
      const owner = claimed.get('tenantId');
      if (claimed.exists && owner !== tenantId) fail('already-exists', 'error.onlineStore.slugTaken');
      const previous = store.get('slug');
      if (typeof previous === 'string' && previous !== slug) {
        const oldRef = slugRef(previous);
        const oldSnap = await tx.get(oldRef);
        if (oldSnap.get('tenantId') === tenantId) tx.delete(oldRef);
      }
      tx.set(newRef, { tenantId, updatedAt: Date.now() });
      if (store.exists) {
        tx.set(sRef, { slug, updatedAt: Date.now() }, { merge: true });
      } else {
        const fresh = toStoreConfig(undefined);
        tx.set(sRef, { ...fresh, slug, updatedAt: Date.now() });
      }
    });
    return { config: await loadConfig(tenantId) };
  }),
);

export const onlineStorePublish = onCall({ region: REGION }, (request) =>
  ownerCall(request, async ({ tenantId }, data): Promise<{ config: OnlineStoreConfig }> => {
    parse(emptySchema, data);
    const ref = storeRef(tenantId);
    const storeName = await storeNameOf(tenantId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const config = toStoreConfig(snap.data(), storeName);
      if (!snap.exists || publishBlockers(config).length > 0) fail('failed-precondition', 'error.onlineStore.notReady');
      const now = Date.now();
      tx.set(ref, { publication: 'published', published: config.draft, publishedAt: now, updatedAt: now }, { merge: true });
    });
    return { config: await loadConfig(tenantId) };
  }),
);

export const onlineStoreUnpublish = onCall({ region: REGION }, (request) =>
  ownerCall(request, async ({ tenantId }, data): Promise<{ config: OnlineStoreConfig }> => {
    parse(emptySchema, data);
    const ref = storeRef(tenantId);
    const snap = await ref.get();
    if (snap.exists) await ref.set({ publication: 'draft', published: null, updatedAt: Date.now() }, { merge: true });
    return { config: await loadConfig(tenantId) };
  }),
);

export const onlineStoreSetProductVisibility = onCall({ region: REGION }, (request) =>
  ownerCall(request, async ({ tenantId }, data): Promise<{ config: OnlineStoreConfig }> => {
    const ids = cleanVisibleIds(parse(visibilitySchema, data).productIds);
    const found = await activeProducts(tenantId, ids);
    if (found.size !== ids.length) fail('invalid-argument', 'error.onlineStore.unknownProduct');
    const ref = storeRef(tenantId);
    const snap = await ref.get();
    if (snap.exists) {
      await ref.set({ visibleProductIds: ids, updatedAt: Date.now() }, { merge: true });
    } else {
      await ref.set({ ...toStoreConfig(undefined), visibleProductIds: ids, updatedAt: Date.now() });
    }
    return { config: await loadConfig(tenantId) };
  }),
);

/** Owner sets the web description and price-before-discount of one product (live, no publish step). */
export const onlineStoreSaveListing = onCall({ region: REGION }, (request) =>
  ownerCall(request, async ({ tenantId }, data): Promise<{ config: OnlineStoreConfig }> => {
    const input = parse(listingSchema, data);
    const description = input.description.trim();
    if (description.length > LISTING_DESC_MAX) fail('invalid-argument', 'error.onlineStore.description');
    const found = await activeProducts(tenantId, [input.productId]);
    if (!found.has(input.productId)) fail('invalid-argument', 'error.onlineStore.unknownProduct');
    const ref = storeRef(tenantId);
    const snap = await ref.get();
    if (!snap.exists) await ref.set({ ...toStoreConfig(undefined), updatedAt: Date.now() });
    const stored = toStoreConfig(snap.data()).listings[input.productId];
    // Photos the request leaves out are kept as they are (older clients don't send them).
    const cutoutUrl = input.cutoutUrl ?? stored?.cutoutUrl ?? '';
    const lookUrl = input.lookUrl ?? stored?.lookUrl ?? '';
    const empty = !description && input.compareAtUsdCents === null && !cutoutUrl && !lookUrl;
    await ref.update({
      [`listings.${input.productId}`]: empty ? FieldValue.delete() : { description, compareAtUsdCents: input.compareAtUsdCents, cutoutUrl, lookUrl },
      updatedAt: Date.now(),
    });
    return { config: await loadConfig(tenantId) };
  }),
);

/* ------------------------------------------------------------------ public catalog */

// App Check stays in monitoring mode platform-wide (see globalOptions.ts); enforcing it is a
// production console change that needs explicit approval, so public reads rely on rate limits,
// strict input, and published-only data for now.
export const publicFn = { region: REGION, enforceAppCheck: false as const, cors: true };

export function clientIp(request: CallableRequest): string {
  const raw = request.rawRequest;
  return platformClientIp({
    forwardedFor: raw?.headers?.['x-forwarded-for'],
    socketAddress: raw?.socket?.remoteAddress,
  });
}

export async function rateLimit(kind: string, ip: string, now: number, max: number): Promise<void> {
  const ref = db.doc(`platformRateLimits/${kind}_${ipSignal(ip)}_${Math.floor(now / 3_600_000)}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = Number(snap.get('count') ?? 0);
    if (count >= max) fail('resource-exhausted', 'error.tooManyRequests');
    tx.set(ref, { count: count + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}

export interface PublicCatalogResponse {
  store: PublicStore;
  products: PublicProduct[];
  /** Visible products that sold most in the last 30 days, best first (may be empty). */
  bestSellerIds: string[];
  /** Online payment options the shop has switched on (cash is always available). */
  payments: { whish: boolean };
}

/** Whether the shop has a complete, switched-on Whish connection (see whish.ts). */
async function whishReady(tenantId: string): Promise<boolean> {
  const w = (await db.doc(`onlinePaymentConfigs/${tenantId}`).get()).get('whish') as Record<string, unknown> | undefined;
  return !!w && w.enabled === true && !!w.channel && !!w.secret && !!w.websiteUrl;
}

const BEST_TTL_MS = 6 * 3_600_000;
const BEST_DAYS = 30;
const BEST_SCAN = 400;
const BEST_KEEP = 24;
const BEST_SHOW = 8;

/**
 * Best sellers from the shop's real POS sales (and nothing else). Recomputed at most every
 * 6 hours and cached on the store doc, so public page loads never scan sales on every visit.
 */
async function bestSellerIds(tenantId: string): Promise<string[]> {
  const ref = storeRef(tenantId);
  const cached = (await ref.get()).get('bestSellers') as { ids?: unknown; atMs?: unknown } | undefined;
  const cachedIds = Array.isArray(cached?.ids) ? cached.ids.filter((x): x is string => typeof x === 'string') : [];
  if (typeof cached?.atMs === 'number' && Date.now() - cached.atMs < BEST_TTL_MS) return cachedIds;
  try {
    const from = businessDate(Date.now() - BEST_DAYS * 86_400_000);
    const snap = await tenantPaths(tenantId).col('sales').where('localDate', '>=', from).orderBy('localDate', 'desc').limit(BEST_SCAN).get();
    const items = snap.docs.flatMap((d) => {
      const raw = d.get('items');
      return Array.isArray(raw)
        ? raw.map((it: DocumentData) => ({ productId: String(it?.productId ?? ''), quantity: Number(it?.quantity) || 0 }))
        : [];
    });
    const ids = rankBestSellers(items, BEST_KEEP);
    await ref.set({ bestSellers: { ids, atMs: Date.now() } }, { merge: true });
    return ids;
  } catch (err) {
    console.warn('[onlineStore] best sellers unavailable', err);
    return cachedIds;
  }
}

export interface PublishedStore {
  tenantId: string;
  config: OnlineStoreConfig;
  published: NonNullable<OnlineStoreConfig['published']>;
}

/**
 * Resolves a normalized slug to a live, entitled, published store, or fails with a uniform
 * not-found (never reveals whether the slug exists, is unpublished, or lost its entitlement).
 */
export async function resolvePublishedStore(slug: string): Promise<PublishedStore> {
  const tenantId = (await slugRef(slug).get()).get('tenantId');
  if (typeof tenantId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(tenantId)) {
    fail('not-found', 'error.onlineStore.notFound');
  }
  const [storeSnap, entitled] = await Promise.all([storeRef(tenantId).get(), tenantEntitled(tenantId)]);
  const config = toStoreConfig(storeSnap.data());
  if (
    !entitled ||
    !storeSnap.exists ||
    !config.enabled ||
    config.publication !== 'published' ||
    !config.published ||
    config.slug !== slug
  ) {
    fail('not-found', 'error.onlineStore.notFound');
  }
  return { tenantId, config, published: config.published };
}

/** Parses and normalizes a public slug; malformed slugs get the same not-found as unknown ones. */
export function publicSlug(raw: string): string {
  const slug = normalizeSlug(raw);
  if (slugProblem(slug)) fail('not-found', 'error.onlineStore.notFound');
  return slug;
}

export const publicStoreCatalog = onCall(publicFn, async (request): Promise<PublicCatalogResponse> => {
  try {
    const slug = publicSlug(parse(slugSchema, stripTransport(request.data)).slug);
    await rateLimit('storeCatalog', clientIp(request), Date.now(), PUBLIC_CATALOG_PER_HOUR);
    const { tenantId, config, published } = await resolvePublishedStore(slug);
    const found = await activeProducts(tenantId, config.visibleProductIds);
    const products = config.visibleProductIds
      .filter((id) => found.has(id))
      .map((id) => toProduct(id, found.get(id) as DocumentData))
      // Same rules as publicPlaceOrder: IMEI-tracked or unpriced items can't be ordered online.
      .filter((p) => !p.imeiTracking)
      .map((p) => projectPublicProduct(p, config.listings[p.id], config.ratings[p.id], Date.now()))
      .filter((p) => p.priceUsdCents > 0 || (p.priceLbp ?? 0) > 0);
    const shown = new Set(products.filter((p) => p.inStock).map((p) => p.id));
    const [bestAll, whish] = await Promise.all([bestSellerIds(tenantId), whishReady(tenantId)]);
    const best = bestAll.filter((id) => shown.has(id)).slice(0, BEST_SHOW);
    return { store: projectPublicStore(slug, published), products, bestSellerIds: best, payments: { whish } };
  } catch (err) {
    rethrowClientSafe(err);
  }
});

/* ------------------------------------------------------------------ store analytics */

const TRACK_PER_HOUR = 600;
const TRACK_CACHE_MS = 60_000;
const trackSchema = z.strictObject({
  slug: z.string().min(1).max(64),
  type: z.enum(STORE_EVENTS),
  productId: idField.optional(),
});
const statsSchema = z.strictObject({ days: z.union([z.literal(STATS_RANGES[0]), z.literal(STATS_RANGES[1])]) });

/** Per-instance slug→tenant cache so a burst of storefront events doesn't re-read the store doc. */
const trackTenants = new Map<string, { tenantId: string; atMs: number }>();

async function trackTenant(slug: string, now: number): Promise<string> {
  const hit = trackTenants.get(slug);
  if (hit && now - hit.atMs < TRACK_CACHE_MS) return hit.tenantId;
  const { tenantId } = await resolvePublishedStore(slug);
  if (trackTenants.size > 500) trackTenants.clear();
  trackTenants.set(slug, { tenantId, atMs: now });
  return tenantId;
}

export const statsRef = (tenantId: string, date: string): DocumentReference =>
  storeRef(tenantId).collection('stats').doc(date);

/**
 * Counts one storefront event (visit, product view, add to cart, checkout start) on today's
 * counter doc. No visitor ids are stored. Product views are only counted for real, active
 * products so the per-product map can't be filled with junk keys.
 */
export const publicTrackEvent = onCall(publicFn, async (request): Promise<{ ok: true }> => {
  try {
    const input = parse(trackSchema, stripTransport(request.data));
    const slug = publicSlug(input.slug);
    const now = Date.now();
    await rateLimit('storeTrack', clientIp(request), now, TRACK_PER_HOUR);
    const tenantId = await trackTenant(slug, now);
    const field = EVENT_FIELD[input.type];
    const update: Record<string, unknown> = { [field]: FieldValue.increment(1), updatedAt: now };
    if (input.type === 'view' && input.productId) {
      const found = await activeProducts(tenantId, [input.productId]);
      if (found.has(input.productId)) update.viewsBy = { [input.productId]: FieldValue.increment(1) };
    }
    await statsRef(tenantId, businessDate(now)).set(update, { merge: true });
    return { ok: true };
  } catch (err) {
    rethrowClientSafe(err);
  }
});

export interface StoreStatsResponse extends StoreStatsSummary {
  /** Names for topViewed, keyed by product id (archived products are left out). */
  names: Record<string, string>;
  /** Website orders vs sales at the till over the same days. */
  sales: SalesSplit;
}

const SPLIT_ORDERS_MAX = 2000;

/** Website orders vs till sales over the given shop days (orders by time, till sales by day totals). */
async function salesSplit(tenantId: string, dates: readonly string[], days: number): Promise<SalesSplit> {
  const since = Date.now() - days * 86_400_000;
  const [orderSnap, daySnaps] = await Promise.all([
    storeRef(tenantId).collection('orders').where('createdAtMs', '>=', since).limit(SPLIT_ORDERS_MAX).get(),
    db.getAll(...dates.map((d) => tenantPaths(tenantId).dailyStats(d))),
  ]);
  const store = { revenueUsdCents: 0, returnsUsdCents: 0, salesCount: 0 };
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  for (const d of daySnaps) {
    const x = d.data() ?? {};
    store.revenueUsdCents += n(x.revenueUsdCents);
    store.returnsUsdCents += n(x.returnsUsdCents);
    store.salesCount += n(x.salesCount);
  }
  return summarizeSalesSplit(orderSnap.docs.map((d) => toOnlineOrder(d.id, d.data())), store, STATS_TOP);
}

/** Owner view of the storefront counters for the last 7 or 30 shop days. */
export const onlineStoreStats = onCall({ region: REGION }, (request) =>
  ownerCall(request, async ({ tenantId }, data): Promise<StoreStatsResponse> => {
    const input = parse(statsSchema, data);
    const dates = statDates(businessDate(Date.now()), input.days);
    const snaps = await db.getAll(...dates.map((d) => statsRef(tenantId, d)));
    const summary = summarizeStats(snaps.map((s, i) => toDayStats(dates[i] ?? s.id, s.data())), STATS_TOP);
    const [products, sales] = await Promise.all([
      activeProducts(tenantId, summary.topViewed.map((t) => t.productId)),
      salesSplit(tenantId, dates, input.days),
    ]);
    const names: Record<string, string> = {};
    for (const [id, p] of products) names[id] = typeof p.name === 'string' ? p.name : '';
    return { ...summary, names, sales };
  }),
);

/* ------------------------------------------------------------------ custom domains */

const domainRef = (domain: string): DocumentReference => db.doc(`onlineStoreDomains/${domain}`);
const domainSchema = z.strictObject({ domain: z.string().max(DOMAIN_MAX + 20) });
const DOMAIN_LOOKUPS_PER_HOUR = 300;

/**
 * Saves (or clears, with '') the shop's own domain. One domain belongs to one shop: the
 * mapping doc onlineStoreDomains/{domain} is claimed in the same transaction. Pointing DNS
 * and connecting the domain in Firebase Hosting stay manual platform steps (see the guide in
 * .claude/storefront-progress.md); until then the domain simply doesn't reach us.
 */
export const onlineStoreSetDomain = onCall({ region: REGION }, (request) =>
  ownerCall(request, async ({ tenantId }, data): Promise<{ config: OnlineStoreConfig }> => {
    const domain = normalizeDomain(parse(domainSchema, data).domain);
    if (domain) {
      const problem = domainProblem(domain);
      if (problem) fail('invalid-argument', `error.onlineStore.domain.${problem}`);
    }
    const ref = storeRef(tenantId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const before = toStoreConfig(snap.data()).customDomain;
      if (before === domain) return;
      if (domain) {
        const claimed = await tx.get(domainRef(domain));
        const owner = claimed.get('tenantId');
        if (claimed.exists && owner !== tenantId) fail('already-exists', 'error.onlineStore.domain.taken');
        tx.set(domainRef(domain), { tenantId, updatedAt: Date.now() });
      }
      if (before) tx.delete(domainRef(before));
      if (snap.exists) tx.update(ref, { customDomain: domain, updatedAt: Date.now() });
      else tx.set(ref, { ...toStoreConfig(undefined), customDomain: domain, updatedAt: Date.now() });
    });
    return { config: await loadConfig(tenantId) };
  }),
);

/** Which published shop a custom domain opens. Unknown or unpublished → not-found. */
export const publicStoreByDomain = onCall(publicFn, async (request): Promise<{ slug: string }> => {
  try {
    const domain = normalizeDomain(parse(domainSchema, stripTransport(request.data)).domain);
    if (!domain || domainProblem(domain)) fail('not-found', 'error.onlineStore.notFound');
    await rateLimit('storeDomain', clientIp(request), Date.now(), DOMAIN_LOOKUPS_PER_HOUR);
    const tenantId = (await domainRef(domain).get()).get('tenantId');
    if (typeof tenantId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(tenantId)) fail('not-found', 'error.onlineStore.notFound');
    const config = toStoreConfig((await storeRef(tenantId).get()).data());
    if (config.customDomain !== domain || !config.slug) fail('not-found', 'error.onlineStore.notFound');
    const slug = config.slug;
    await resolvePublishedStore(slug); // same published + entitled checks as the catalog
    return { slug };
  } catch (err) {
    rethrowClientSafe(err);
  }
});
