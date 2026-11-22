/**
 * On-device background removal for product photos (transformers.js + ormbg, Apache-2.0).
 * The photo never leaves the browser; only the model weights are downloaded once (~44 MB,
 * then cached by the browser). Used by the owner to make cut-out photos for the 3D showcase.
 */

import { useLocalOrt } from '@/features/ai/ortAssets';

export const BG_MODEL_ID = 'onnx-community/ormbg-ONNX';

export type BgProgress = { phase: 'loading-model' | 'working'; progress: number | null };

type RawImageLike = { width: number; height: number; channels: number; data: Uint8ClampedArray | Uint8Array };
type Segmenter = (input: string | Blob) => Promise<RawImageLike | RawImageLike[]>;

let segmenterPromise: Promise<Segmenter> | null = null;

async function loadSegmenter(onProgress?: (p: BgProgress) => void): Promise<Segmenter> {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      onProgress?.({ phase: 'loading-model', progress: null });
      const { pipeline, env } = await import('@huggingface/transformers');
      env.allowLocalModels = false;
      useLocalOrt(env);
      // 8-bit weights on WebAssembly: works on every browser (WebGPU hit shader limits on some
      // graphics cards) and keeps the one-time download small.
      const seg = await pipeline('background-removal', BG_MODEL_ID, {
        device: 'wasm',
        dtype: 'q8',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        progress_callback: (item: any) => {
          if (item?.status === 'progress' && typeof item.progress === 'number') {
            onProgress?.({ phase: 'loading-model', progress: Math.min(1, Math.max(0, item.progress / 100)) });
          }
        },
      } as Record<string, unknown>);
      return seg as unknown as Segmenter;
    })().catch((err: unknown) => {
      segmenterPromise = null;
      throw err;
    });
  }
  return segmenterPromise;
}

/** Bounding box of pixels whose alpha is above `min`, so the cut-out can be cropped tight. */
export function alphaBounds(data: ArrayLike<number>, width: number, height: number, min = 24) {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((data[(y * width + x) * 4 + 3] ?? 0) > min) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Returns the product on a transparent background as a WebP/PNG file, trimmed to the product
 * with a small margin. Throws when nothing is found (e.g. a photo with no clear subject).
 */
export async function removeBackground(source: Blob | string, onProgress?: (p: BgProgress) => void): Promise<File> {
  const seg = await loadSegmenter(onProgress);
  onProgress?.({ phase: 'working', progress: null });
  const out = await seg(source);
  const img = Array.isArray(out) ? out[0] : out;
  if (!img || img.channels !== 4) throw new Error('background-removal: no image');
  const box = alphaBounds(img.data, img.width, img.height);
  if (!box || box.w * box.h < img.width * img.height * 0.02) throw new Error('background-removal: no subject');
  const full = document.createElement('canvas');
  full.width = img.width;
  full.height = img.height;
  full.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  const pad = Math.round(Math.max(box.w, box.h) * 0.04);
  const cx = Math.max(0, box.x - pad);
  const cy = Math.max(0, box.y - pad);
  const cw = Math.min(img.width - cx, box.w + pad * 2);
  const ch = Math.min(img.height - cy, box.h + pad * 2);
  const crop = document.createElement('canvas');
  crop.width = cw;
  crop.height = ch;
  crop.getContext('2d')?.drawImage(full, cx, cy, cw, ch, 0, 0, cw, ch);
  const blob =
    (await new Promise<Blob | null>((r) => crop.toBlob(r, 'image/webp', 0.9))) ??
    (await new Promise<Blob | null>((r) => crop.toBlob(r, 'image/png')));
  if (!blob) throw new Error('background-removal: encode failed');
  const type = blob.type === 'image/webp' ? 'image/webp' : 'image/png';
  return new File([blob], `cutout.${type === 'image/webp' ? 'webp' : 'png'}`, { type });
}
