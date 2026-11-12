/**
 * Generic page UI bridge: AI can open the real create form on a mounted page.
 * Financial modals (pay debt, cash move, return confirm) are intentionally not exposed.
 */
import type { ProductDraftFields } from './productDraft';

export type PageUiPath = '/products' | '/customers' | '/suppliers' | '/purchases';

export interface PageUiHost {
  openCreateForm: (seed?: ProductDraftFields) => boolean;
}

const hosts = new Map<PageUiPath, PageUiHost>();
let pendingCreate: { path: PageUiPath; seed?: ProductDraftFields } | null = null;

export function registerPageUiHost(path: PageUiPath, host: PageUiHost): void {
  hosts.set(path, host);
  if (pendingCreate?.path === path) {
    const seed = pendingCreate.seed;
    pendingCreate = null;
    host.openCreateForm(seed);
  }
}

export function unregisterPageUiHost(path: PageUiPath, host?: PageUiHost): void {
  const current = hosts.get(path);
  if (!host || current === host) hosts.delete(path);
}

/** Open the page's Add/Create form when mounted; otherwise queue until register. */
export function requestOpenCreateForm(path: PageUiPath, seed?: ProductDraftFields): void {
  const host = hosts.get(path);
  if (host) {
    host.openCreateForm(seed);
    return;
  }
  pendingCreate = { path, seed };
}

export function clearPendingOpenCreateForm(path?: PageUiPath): void {
  if (!path || pendingCreate?.path === path) pendingCreate = null;
}

/** @deprecated prefer requestOpenCreateForm('/products') */
export function requestOpenCreateProductForm(): void {
  requestOpenCreateForm('/products');
}

/** @deprecated */
export function clearPendingOpenCreateProductForm(): void {
  clearPendingOpenCreateForm('/products');
}

/** @deprecated — ProductsPage still registers via productsUiBridge wrapper */
export function registerProductsUiHost(host: PageUiHost): void {
  registerPageUiHost('/products', host);
}

/** @deprecated */
export function unregisterProductsUiHost(host?: PageUiHost): void {
  unregisterPageUiHost('/products', host);
}
