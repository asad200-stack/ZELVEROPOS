import type { OnlineStoreConfig, ProductListing } from '@/domain/onlineStore';
import { api } from '@/services/functionsClient';
import { deleteStorageFile, storagePathFromUrl, uploadTenantImage } from '@/services/storageService';
import type { BgProgress } from '@/features/products/backgroundRemoval';

/**
 * Fitting-room photos: the model or mannequin wearing a piece, background removed on this
 * device (free), uploaded once and shown in the store's fitting room.
 */
export async function makeLook(
  tenantId: string,
  product: { id: string; imageUrl: string | null },
  listing: ProductListing | undefined,
  /** A photo the owner took on the mannequin; null uses the product's own photo. */
  photo: Blob | null,
  onProgress?: (p: BgProgress) => void,
): Promise<OnlineStoreConfig> {
  const source: Blob =
    photo ??
    (await (async () => {
      if (!product.imageUrl) throw new Error('look: no photo');
      const r = await fetch(product.imageUrl);
      if (!r.ok) throw new Error(`look: photo ${r.status}`);
      return r.blob();
    })());
  const { removeBackground } = await import('@/features/products/backgroundRemoval');
  const file = await removeBackground(source, onProgress);
  const up = await uploadTenantImage(tenantId, 'products', `${product.id}-look`, file, { keepAlpha: true, maxSize: 1400 });
  const res = await api.onlineStoreSaveListing({
    productId: product.id,
    description: listing?.description ?? '',
    compareAtUsdCents: listing?.compareAtUsdCents ?? null,
    lookUrl: up.url,
  });
  await removeOldLook(tenantId, product.id, listing?.lookUrl);
  return res.config;
}

/** Takes the piece out of the fitting room (its product photos are untouched). */
export async function clearLook(tenantId: string, productId: string, listing: ProductListing | undefined): Promise<OnlineStoreConfig> {
  const res = await api.onlineStoreSaveListing({
    productId,
    description: listing?.description ?? '',
    compareAtUsdCents: listing?.compareAtUsdCents ?? null,
    lookUrl: '',
  });
  await removeOldLook(tenantId, productId, listing?.lookUrl);
  return res.config;
}

/** Deletes a replaced fitting-room file, but only one this tool made for this product. */
async function removeOldLook(tenantId: string, productId: string, url: string | undefined): Promise<void> {
  const path = url ? storagePathFromUrl(url) : null;
  if (path && path.startsWith(`tenants/${tenantId}/products/${productId}-look-`)) await deleteStorageFile(path).catch(() => undefined);
}
