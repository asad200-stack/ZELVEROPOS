import type { OnlineStoreConfig, ProductListing } from '@/domain/onlineStore';
import { api } from '@/services/functionsClient';
import { deleteStorageFile, storagePathFromUrl, uploadTenantImage } from '@/services/storageService';
import type { BgProgress } from '@/features/products/backgroundRemoval';

/**
 * Makes the 3D-showcase photo for one product: removes the background on this device, uploads
 * the transparent image and stores its link on the product's web listing.
 */
export async function makeCutout(
  tenantId: string,
  product: { id: string; imageUrl: string | null },
  listing: ProductListing | undefined,
  onProgress?: (p: BgProgress) => void,
): Promise<OnlineStoreConfig> {
  if (!product.imageUrl) throw new Error('cutout: no photo');
  const { removeBackground } = await import('@/features/products/backgroundRemoval');
  // Fresh copy: a cached <img> copy of the photo has no CORS header and would be blocked.
  const source = await fetch(product.imageUrl, { cache: 'no-store' }).then((r) => {
    if (!r.ok) throw new Error(`cutout: photo ${r.status}`);
    return r.blob();
  });
  const file = await removeBackground(source, onProgress);
  const up = await uploadTenantImage(tenantId, 'products', `${product.id}-cutout`, file, { keepAlpha: true, maxSize: 900 });
  const res = await api.onlineStoreSaveListing({
    productId: product.id,
    description: listing?.description ?? '',
    compareAtUsdCents: listing?.compareAtUsdCents ?? null,
    cutoutUrl: up.url,
  });
  await removeOldCutout(tenantId, product.id, listing?.cutoutUrl);
  return res.config;
}

/** Deletes a replaced cut-out file, but only one this tool made for this product. */
async function removeOldCutout(tenantId: string, productId: string, url: string | undefined): Promise<void> {
  const path = url ? storagePathFromUrl(url) : null;
  if (path && path.startsWith(`tenants/${tenantId}/products/${productId}-cutout-`)) await deleteStorageFile(path);
}

/** Drops the 3D photo from the listing (the original product photo is untouched). */
export async function clearCutout(tenantId: string, productId: string, listing: ProductListing | undefined): Promise<OnlineStoreConfig> {
  const res = await api.onlineStoreSaveListing({
    productId,
    description: listing?.description ?? '',
    compareAtUsdCents: listing?.compareAtUsdCents ?? null,
    cutoutUrl: '',
  });
  await removeOldCutout(tenantId, productId, listing?.cutoutUrl);
  return res.config;
}
