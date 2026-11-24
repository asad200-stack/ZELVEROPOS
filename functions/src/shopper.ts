/**
 * Shopper accounts on the shop websites (optional; guests still order without one).
 *
 *   shopperAccount        signed-in shopper: saved details, favourites and past orders at one shop
 *   shopperSaveProfile    saves name / phone / address used to fill the checkout next time
 *   shopperSaveWishlist   saves the shopper's favourites at one shop
 *
 * Shoppers sign in on the website with Google, in a Firebase Auth session kept
 * apart from the POS sign-in (see src/features/onlineStore/shopperAuth.ts). The uid always comes
 * from the verified ID token, never from the request body. Data lives at shoppers/{uid} and
 * shoppers/{uid}/wishlists/{tenantId}; Firestore rules give clients no access to either. Orders
 * placed while signed in carry shopperUid (set by publicPlaceOrder), which is how they are found.
 */
import type { CallableRequest } from 'firebase-functions/v2/https';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db } from './admin.js';
import { fail, rethrowClientSafe } from './errors.js';
import { publicFn, publicSlug, rateLimit, resolvePublishedStore, storeRef, stripTransport } from './onlineStore.js';
import { idField } from './pos/common.js';
import { ORDER_ADDRESS_MAX, ORDER_NAME_MAX, type OrderStatus } from './shared/onlineOrders.js';
import {
  cleanShopperProfile,
  cleanWishlist,
  SHOPPER_ORDERS_MAX,
  SHOPPER_WISHLIST_MAX,
  type ShopperAccountView,
  type ShopperOrder,
  type ShopperProfile,
} from './shared/shopperAccount.js';
import { parse } from './validate.js';

const ACCOUNT_PER_HOUR = 240;
const SAVE_PER_HOUR = 240;

const slugField = z.string().min(1).max(64);
const accountSchema = z.strictObject({ slug: slugField });
const profileSchema = z.strictObject({
  name: z.string().max(ORDER_NAME_MAX * 2),
  phone: z.string().max(40),
  address: z.string().max(ORDER_ADDRESS_MAX * 2),
});
const wishlistSchema = z.strictObject({ slug: slugField, ids: z.array(idField).max(SHOPPER_WISHLIST_MAX * 2) });

/** The signed-in shopper's uid, from the verified token only. */
function shopperUid(request: CallableRequest): string {
  const uid = request.auth?.uid;
  if (!uid) fail('unauthenticated', 'error.shopper.signIn');
  return uid;
}

const profileRef = (uid: string) => db.doc(`shoppers/${uid}`);
const wishlistRef = (uid: string, tenantId: string) => db.doc(`shoppers/${uid}/wishlists/${tenantId}`);

/** Saves what the shopper typed at checkout so the next checkout fills itself in. */
export async function rememberShopperDetails(uid: string, details: Partial<ShopperProfile>): Promise<void> {
  const clean = cleanShopperProfile(details);
  const patch: Record<string, string | number> = { updatedAtMs: Date.now() };
  if (clean.name) patch.name = clean.name;
  if (clean.phone) patch.phone = clean.phone;
  if (clean.address) patch.address = clean.address;
  await profileRef(uid).set(patch, { merge: true });
}

function toShopperOrder(data: FirebaseFirestore.DocumentData): ShopperOrder {
  const lines = Array.isArray(data.lines) ? (data.lines as Record<string, unknown>[]) : [];
  return {
    ref: String(data.ref ?? ''),
    status: String(data.status ?? 'pending') as OrderStatus,
    fulfillment: data.fulfillment === 'pickup' ? 'pickup' : 'delivery',
    createdAtMs: Number(data.createdAtMs) || 0,
    totalUsdCents: Number(data.totalUsdCents) || 0,
    totalLbp: Number(data.totalLbp) || 0,
    lines: lines.map((l) => ({ productId: String(l.productId ?? ''), name: String(l.name ?? ''), qty: Number(l.qty) || 0 })),
  };
}

export const shopperAccount = onCall(publicFn, async (request): Promise<ShopperAccountView> => {
  try {
    const uid = shopperUid(request);
    const input = parse(accountSchema, stripTransport(request.data));
    const slug = publicSlug(input.slug);
    await rateLimit('shopperAccount', `uid:${uid}`, Date.now(), ACCOUNT_PER_HOUR);
    const { tenantId } = await resolvePublishedStore(slug);
    // Equality only (single-field index, no composite index needed); newest first in memory.
    const [profile, wish, orders] = await Promise.all([
      profileRef(uid).get(),
      wishlistRef(uid, tenantId).get(),
      storeRef(tenantId).collection('orders').where('shopperUid', '==', uid).limit(SHOPPER_ORDERS_MAX * 4).get(),
    ]);
    return {
      profile: cleanShopperProfile(profile.data()),
      wishlist: cleanWishlist((wish.get('ids') as unknown[] | undefined) ?? []),
      orders: orders.docs
        .map((d) => toShopperOrder(d.data()))
        .sort((a, b) => b.createdAtMs - a.createdAtMs)
        .slice(0, SHOPPER_ORDERS_MAX),
    };
  } catch (err) {
    rethrowClientSafe(err);
  }
});

export const shopperSaveProfile = onCall(publicFn, async (request): Promise<{ profile: ShopperProfile }> => {
  try {
    const uid = shopperUid(request);
    const input = parse(profileSchema, stripTransport(request.data));
    await rateLimit('shopperSave', `uid:${uid}`, Date.now(), SAVE_PER_HOUR);
    const profile = cleanShopperProfile(input);
    await profileRef(uid).set({ ...profile, updatedAtMs: Date.now() }, { merge: true });
    return { profile };
  } catch (err) {
    rethrowClientSafe(err);
  }
});

export const shopperSaveWishlist = onCall(publicFn, async (request): Promise<{ ids: string[] }> => {
  try {
    const uid = shopperUid(request);
    const input = parse(wishlistSchema, stripTransport(request.data));
    const slug = publicSlug(input.slug);
    await rateLimit('shopperSave', `uid:${uid}`, Date.now(), SAVE_PER_HOUR);
    const { tenantId } = await resolvePublishedStore(slug);
    const ids = cleanWishlist(input.ids);
    await wishlistRef(uid, tenantId).set({ ids, updatedAtMs: Date.now() });
    return { ids };
  } catch (err) {
    rethrowClientSafe(err);
  }
});
