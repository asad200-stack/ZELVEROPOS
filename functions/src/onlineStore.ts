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
import { idField, tenantPaths, toProduct } from './pos/common.js';
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
  STORE_TAGLINE_MAX,
  STORE_TEMPLATES,
  cleanVisibleIds,
  normalizeSlug,
  projectPublicProduct,
  projectPublicStore,
  publishBlockers,
  slugProblem,
  toStoreConfig,
  type OnlineStoreConfig,
  type PublicProduct,
  type PublicStore,
} from './shared/onlineStore.js';
import { caller, parse, type Caller } from './validate.js';

/** Products offered to the owner's picker; a larger catalog is truncated (flagged in the reply). */
const OWNER_PICKER_CAP = 2000;
/** Public catalog reads per IP per hour. */
const PUBLIC_CATALOG_PER_HOUR = 300;

/* ------------------------------------------------------------------ authorization */

interface StorePrincipal {
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
async function tenantEntitled(tenantId: string): Promise<boolean> {
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
function stripTransport(data: unknown): unknown {
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
});
const emptySchema = z.strictObject({});
const saveDraftSchema = z.strictObject({ enabled: z.boolean(), draft: brandingSchema });
const slugSchema = z.strictObject({ slug: z.string().min(1).max(64) });
const visibilitySchema = z.strictObject({ productIds: z.array(idField).max(MAX_VISIBLE_PRODUCTS) });

/* ------------------------------------------------------------------ helpers */

const storeRef = (tenantId: string): DocumentReference => db.doc(`onlineStores/${tenantId}`);
const slugRef = (slug: string): DocumentReference => db.doc(`onlineStoreSlugs/${slug}`);

async function storeNameOf(tenantId: string): Promise<string> {
  const settings = await tenantPaths(tenantId).settings.get();
  const name = settings.get('storeName');
  return typeof name === 'string' ? name : '';
}

async function loadConfig(tenantId: string): Promise<OnlineStoreConfig> {
  const [snap, storeName] = await Promise.all([storeRef(tenantId).get(), storeNameOf(tenantId)]);
  return toStoreConfig(snap.data(), storeName);
}

async function ownerCall<T>(request: CallableRequest, run: (p: StorePrincipal, data: unknown) => Promise<T>): Promise<T> {
  try {
    const principal = await resolveStorePrincipal(caller(request));
    return await run(principal, stripTransport(request.data));
  } catch (err) {
    rethrowClientSafe(err);
  }
}

/** Reads products in batches of 100 (getAll limit-friendly), keeping only active ones. */
async function activeProducts(tenantId: string, ids: readonly string[]): Promise<Map<string, DocumentData>> {
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
      .map((d) => projectPublicProduct(toProduct(d.id, d.data())))
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

/* ------------------------------------------------------------------ public catalog */

// App Check stays in monitoring mode platform-wide (see globalOptions.ts); enforcing it is a
// production console change that needs explicit approval, so public reads rely on rate limits,
// strict input, and published-only data for now.
const publicFn = { region: REGION, enforceAppCheck: false as const, cors: true };

function clientIp(request: CallableRequest): string {
  const raw = request.rawRequest;
  return platformClientIp({
    forwardedFor: raw?.headers?.['x-forwarded-for'],
    socketAddress: raw?.socket?.remoteAddress,
  });
}

async function rateLimit(kind: string, ip: string, now: number, max: number): Promise<void> {
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
}

export const publicStoreCatalog = onCall(publicFn, async (request): Promise<PublicCatalogResponse> => {
  try {
    const slug = normalizeSlug(parse(slugSchema, stripTransport(request.data)).slug);
    if (slugProblem(slug)) fail('not-found', 'error.onlineStore.notFound');
    await rateLimit('storeCatalog', clientIp(request), Date.now(), PUBLIC_CATALOG_PER_HOUR);

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
    const found = await activeProducts(tenantId, config.visibleProductIds);
    const products = config.visibleProductIds
      .filter((id) => found.has(id))
      .map((id) => projectPublicProduct(toProduct(id, found.get(id) as DocumentData)));
    return { store: projectPublicStore(slug, config.published), products };
  } catch (err) {
    rethrowClientSafe(err);
  }
});
