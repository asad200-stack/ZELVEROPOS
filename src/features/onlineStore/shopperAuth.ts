import { useEffect, useState } from 'react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { API_COMPAT_VERSION, APP_RELEASE_VERSION } from '@/constants/app';
import type { ShopperAccountView, ShopperProfile } from '@/domain/shopperAccount';
import { getShopperFirebase } from '@/firebase/app';
import { withoutUndefined } from '@/services/callableData';
import type { api } from '@/services/functionsClient';

/** The shopper signed in on the shop website (separate from any POS sign-in). */
export interface Shopper {
  uid: string;
  name: string;
  email: string;
  phone: string;
}

/** Follows the shopper's sign-in; `ready` turns true once the saved session has been checked. */
export function useShopper(): { shopper: Shopper | null; ready: boolean } {
  const [state, setState] = useState<{ shopper: Shopper | null; ready: boolean }>({ shopper: null, ready: false });
  useEffect(() => {
    try {
      return onAuthStateChanged(getShopperFirebase().auth, (u) =>
        setState({
          ready: true,
          shopper: u ? { uid: u.uid, name: u.displayName ?? '', email: u.email ?? '', phone: u.phoneNumber ?? '' } : null,
        }),
      );
    } catch (err) {
      // No shopper sign-in here (setup error): the shop keeps working for guests.
      console.warn('[shopper] sign-in unavailable', err);
      return undefined;
    }
  }, []);
  return state;
}

/** Google sign-in in a popup; phones that block popups go to Google and come back. */
export async function signInShopperWithGoogle(): Promise<void> {
  const { auth } = getShopperFirebase();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, provider);
      return;
    }
    throw err;
  }
}

export async function signOutShopper(): Promise<void> {
  await signOut(getShopperFirebase().auth);
}

/** Sign-in failures in the shopper's words. */
export function shopperAuthError(err: unknown): string {
  const code = (err as { code?: string }).code ?? '';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'storefront.account.cancelled';
  if (code === 'auth/too-many-requests' || code === 'auth/quota-exceeded') return 'storefront.account.tooMany';
  if (code === 'auth/operation-not-allowed' || code === 'auth/unauthorized-domain') return 'storefront.account.unavailable';
  if (code === 'auth/network-request-failed') return 'storefront.account.offline';
  return 'storefront.account.failed';
}

function shopperCallable<Req, Res>(name: string) {
  return async (data: Req): Promise<Res> => {
    type Sent = Req & { clientApiVersion: number; clientReleaseVersion: string };
    const fn = httpsCallable<Sent, Res>(getShopperFirebase().functions, name, { timeout: 60_000 });
    const sent = withoutUndefined({ ...(data as object), clientApiVersion: API_COMPAT_VERSION, clientReleaseVersion: APP_RELEASE_VERSION } as Sent);
    return (await fn(sent)).data;
  };
}

/**
 * Website calls that carry the shopper's sign-in (or none). The order goes through here too, so a
 * POS sign-in in the same browser is never attached to a customer's order.
 */
export const shopperApi = {
  account: shopperCallable<{ slug: string }, ShopperAccountView>('shopperAccount'),
  saveProfile: shopperCallable<ShopperProfile, { profile: ShopperProfile }>('shopperSaveProfile'),
  saveWishlist: shopperCallable<{ slug: string; ids: string[] }, { ids: string[] }>('shopperSaveWishlist'),
  placeOrder: shopperCallable<Parameters<typeof api.publicPlaceOrder>[0], Awaited<ReturnType<typeof api.publicPlaceOrder>>>('publicPlaceOrder'),
};
