import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { firebase } from '@/firebase/app';
import { MAX_IMAGE_BYTES } from '@/constants/app';
import { AppError } from './errors';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Downscales an image client-side (max 800px, JPEG/WebP) to keep uploads small and fast. */
async function compressImage(file: File, maxSize = 800): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  return blob && blob.size < file.size ? blob : file;
}

export async function uploadTenantImage(
  tenantId: string,
  folder: 'products' | 'logo',
  name: string,
  file: File,
): Promise<{ url: string; path: string }> {
  if (!ALLOWED_TYPES.includes(file.type)) throw new AppError('error.imageType');
  const blob = await compressImage(file);
  if (blob.size > MAX_IMAGE_BYTES) throw new AppError('error.imageTooLarge');
  const path = `tenants/${tenantId}/${folder}/${name}-${Date.now()}.jpg`;
  const storageRef = ref(firebase.storage, path);
  await uploadBytes(storageRef, blob, { contentType: blob.type || 'image/jpeg', cacheControl: 'public,max-age=31536000' });
  return { url: await getDownloadURL(storageRef), path };
}

export async function deleteStorageFile(path: string): Promise<void> {
  try {
    await deleteObject(ref(firebase.storage, path));
  } catch (e) {
    if ((e as { code?: string }).code !== 'storage/object-not-found') console.warn('[storage] delete failed', e);
  }
}
