import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * In-process binding for one preview callable. It is set only after the preview
 * credential has been checked. Customer requests never enter this store, and a
 * client cannot set it.
 */
export interface PreviewBinding {
  uid: string;
  tenantId: string;
}

const storage = new AsyncLocalStorage<PreviewBinding>();

export function previewBinding(): PreviewBinding | undefined {
  return storage.getStore();
}

export function runWithPreviewBinding<T>(binding: PreviewBinding, fn: () => Promise<T>): Promise<T> {
  return storage.run(binding, fn);
}
