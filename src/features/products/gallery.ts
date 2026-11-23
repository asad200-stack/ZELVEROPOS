import { setProductGallery } from '@/services/productService';
import { uploadPreparedImage } from '@/services/storageService';
import type { Actor } from '@/services/db';
import type { ProductPhoto } from '@/types/models';

/** A photo already saved on the product, or one just picked (shrunk while the form is filled). */
export type GalleryItem =
  | { kind: 'saved'; key: string; photo: ProductPhoto }
  | { kind: 'new'; key: string; preview: string; blob: Promise<Blob> };

export function galleryFrom(photos: readonly ProductPhoto[] | undefined): GalleryItem[] {
  return (photos ?? []).map((photo) => ({ kind: 'saved', key: photo.path, photo }));
}

/** Whether the owner added, removed or reordered extra photos. */
export function galleryChanged(items: readonly GalleryItem[], original: readonly ProductPhoto[] | undefined): boolean {
  const before = (original ?? []).map((p) => p.path);
  return items.length !== before.length || items.some((it, i) => it.kind !== 'saved' || it.photo.path !== before[i]);
}

/**
 * Uploads the new photos and stores the final list on the product. Photos the owner removed are
 * deleted from storage. Runs after the form has closed.
 */
export async function saveGallery(
  actor: Actor,
  productId: string,
  items: readonly GalleryItem[],
  original: readonly ProductPhoto[] | undefined,
): Promise<void> {
  const photos = await Promise.all(
    items.map(async (it, i) =>
      it.kind === 'saved' ? it.photo : uploadPreparedImage(actor.tenantId, 'products', `${productId}-g${i}`, await it.blob),
    ),
  );
  const kept = new Set(photos.map((p) => p.path));
  const removed = (original ?? []).map((p) => p.path).filter((path) => !kept.has(path));
  await setProductGallery(actor, productId, photos, removed);
}
