import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { firebase } from '@/firebase/app';
import { MAX_IMAGE_BYTES } from '@/constants/app';
import { AppError } from './errors';
export { storagePathFromUrl } from '@/utils/storagePath';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Aim for photos that load quickly on slow mobile data; quality steps down until they fit. */
const TARGET_BYTES = 160 * 1024;
const QUALITIES = [0.82, 0.72, 0.62];

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Downscales an image client-side (max 800px) and re-encodes it as WebP where the browser can
 * (about a third smaller than JPEG), otherwise JPEG. Transparent PNGs get a white background so
 * they don't turn black as JPEG. Keeps the original if re-encoding wouldn't make it smaller.
 */
async function compressImage(file: File, maxSize = 800, keepAlpha = false): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  if (!keepAlpha) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let best: Blob | null = null;
  for (const quality of QUALITIES) {
    const webp = await encode(canvas, 'image/webp', quality);
    // Browsers without WebP encoding silently return PNG; use JPEG there instead.
    // Cut-outs keep their transparency: PNG where WebP can't be encoded (JPEG has no alpha).
    const blob = webp && webp.type === 'image/webp' ? webp : await encode(canvas, keepAlpha ? 'image/png' : 'image/jpeg', quality);
    if (blob && (!best || blob.size < best.size)) best = blob;
    if (best && best.size <= TARGET_BYTES) break;
  }
  return best && best.size < file.size ? best : file;
}

function extensionOf(type: string): string {
  return type === 'image/webp' ? 'webp' : type === 'image/png' ? 'png' : 'jpg';
}

export async function uploadTenantImage(
  tenantId: string,
  folder: 'products' | 'logo',
  name: string,
  file: File,
  opts: { keepAlpha?: boolean; maxSize?: number } = {},
): Promise<{ url: string; path: string }> {
  if (!ALLOWED_TYPES.includes(file.type)) throw new AppError('error.imageType');
  const blob = await compressImage(file, opts.maxSize ?? 800, opts.keepAlpha ?? false);
  if (blob.size > MAX_IMAGE_BYTES) throw new AppError('error.imageTooLarge');
  const type = blob.type || file.type || 'image/jpeg';
  const path = `tenants/${tenantId}/${folder}/${name}-${Date.now()}.${extensionOf(type)}`;
  const storageRef = ref(firebase.storage, path);
  await uploadBytes(storageRef, blob, { contentType: type, cacheControl: 'public,max-age=31536000' });
  return { url: await getDownloadURL(storageRef), path };
}

export async function deleteStorageFile(path: string): Promise<void> {
  try {
    await deleteObject(ref(firebase.storage, path));
  } catch (e) {
    if ((e as { code?: string }).code !== 'storage/object-not-found') console.warn('[storage] delete failed', e);
  }
}
