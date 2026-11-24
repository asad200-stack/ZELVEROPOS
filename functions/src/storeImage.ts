/**
 * Photo server for shop websites:  GET /s/{slug}/img/{productId}-{width}.{webp|jpg}?v=…
 *
 * Returns the product's main photo resized to one of a few widths: small copies for phones
 * (cards load ~5-10x fewer bytes) and JPEG copies for Facebook / Instagram catalogues, which
 * don't take WebP. Only photos of products shown on a published shop are served, and only from
 * that shop's own folder in our Storage bucket. Responses are cached by the Hosting CDN for a year
 * (the ?v= fingerprint changes with the photo), so each copy is made once.
 */
import { onRequest } from 'firebase-functions/v2/https';
import sharp from 'sharp';
import { storage } from './admin.js';
import { REGION } from './config.js';
import { activeProducts, resolvePublishedStore } from './onlineStore.js';
import { parseStoreImagePath } from './shared/storeSeo.js';

const MAX_SOURCE_BYTES = 15 * 1024 * 1024;

/** Storage path of a Firebase download URL of our own bucket, else null. */
export function bucketPathOf(url: string, bucket: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === 'firebasestorage.googleapis.com') {
      const m = /^\/v0\/b\/([^/]+)\/o\/([^/]+)$/.exec(u.pathname);
      return m && m[1] === bucket ? decodeURIComponent(m[2] ?? '') : null;
    }
    if (u.hostname === 'storage.googleapis.com') {
      const [, b, ...rest] = u.pathname.split('/');
      return b === bucket && rest.length ? decodeURIComponent(rest.join('/')) : null;
    }
  } catch {
    // not a URL
  }
  return null;
}

export const publicStoreImage = onRequest(
  { region: REGION, memory: '512MiB', timeoutSeconds: 30, concurrency: 8, maxInstances: 5 },
  async (req, res) => {
    const notFound = () => res.status(404).set('Cache-Control', 'public, max-age=60').send('');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).set('Allow', 'GET, HEAD').send('');
      return;
    }
    const want = parseStoreImagePath(req.path);
    if (!want) return void notFound();
    try {
      const { tenantId, config } = await resolvePublishedStore(want.slug);
      if (!config.visibleProductIds.includes(want.productId)) return void notFound();
      const data = (await activeProducts(tenantId, [want.productId])).get(want.productId);
      const imageUrl = typeof data?.imageUrl === 'string' ? data.imageUrl : '';
      const bucket = storage();
      const path = bucketPathOf(imageUrl, bucket.name);
      if (!path || !path.startsWith(`tenants/${tenantId}/`)) return void notFound();
      const file = bucket.file(path);
      const [meta] = await file.getMetadata();
      if (Number(meta.size ?? 0) > MAX_SOURCE_BYTES) return void notFound();
      const [source] = await file.download();

      let img = sharp(source, { failOn: 'none' }).rotate().resize({ width: want.width, withoutEnlargement: true });
      let body: Buffer;
      let type: string;
      if (want.format === 'jpg') {
        // JPEG has no transparency: cut-out style photos go on white, like a product page.
        body = await img.flatten({ background: '#ffffff' }).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
        type = 'image/jpeg';
      } else {
        img = img.webp({ quality: 78, effort: 4 });
        body = await img.toBuffer();
        type = 'image/webp';
      }
      res
        .status(200)
        .set('Content-Type', type)
        .set('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable')
        .send(body);
    } catch {
      notFound();
    }
  },
);
