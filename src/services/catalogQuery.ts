import {
  documentId,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import {
  CATALOG_PAGE_SIZE,
  emptyProductQuery,
  looksLikeCode,
  planBarcode,
  planParty,
  planProducts,
  type PartyQuery,
  type Planned,
  type ProductQuery,
} from '@/domain/catalogPlan';
import { catalogLoadProblem, mergeKnown } from '@/domain/catalogSession';
import { lowStockScanBound, perItemLowStock } from '@/domain/inventory';
import { emailKey, nameNormalized, phoneKey } from '@/domain/searchKey';
import type { Customer, Product, Supplier } from '@/types/models';
import { paths, toCustomer, toProduct, toSupplier } from './db';
import type { Page } from './salesService';

/**
 * Catalog reads are one-shot cursor pages (strategy A), not a listener on the collection.
 *
 * A listener on only the visible page would keep those tiles live, but load-more and category
 * changes would stack listeners. Checkout already re-reads stock and prices on the server, so a
 * tile can be a moment stale without corrupting a sale. The page is replaced when the query
 * changes. usePagedQuery drops the previous request when its key changes, so a stale search
 * cannot append into the new page.
 *
 * Offline: Firestore persistence returns a page only if that query was cached on this device.
 * A shop with 100,000 products is not available offline. A miss surfaces as a load error.
 * The offline sale queue is unchanged and still retries the same sale id.
 *
 * There is no SKU field. ProductSearch.byCode is the seam a future provider replaces.
 */

export { CATALOG_PAGE_SIZE, emptyProductQuery, type PartyQuery, type ProductQuery } from '@/domain/catalogPlan';

export interface ProductSearch {
  page(tenantId: string, spec: ProductQuery, cursor: QueryDocumentSnapshot | null): Promise<Page<Product>>;
  byBarcode(tenantId: string, barcode: string, activeOnly?: boolean): Promise<Product | null>;
  /** Exact barcode today. A SKU column would be queried here without changing the POS screen. */
  byCode(tenantId: string, code: string): Promise<Product | null>;
}

function constraintsOf(plan: Planned[], cursor: QueryDocumentSnapshot | null): QueryConstraint[] {
  const out: QueryConstraint[] = [];
  for (const step of plan) {
    if (step.op === 'where') out.push(where(step.field, step.cmp, step.value));
    else if (step.op === 'orderBy') out.push(orderBy(step.field === '__name__' ? documentId() : step.field, step.dir));
    else if (step.op === 'startAfter' && cursor) out.push(startAfter(cursor));
    else if (step.op === 'limit') out.push(limit(step.n));
  }
  return out;
}

const pageOf = <T>(docs: QueryDocumentSnapshot[], map: (id: string, data: Record<string, unknown>) => T, size: number): Page<T> => ({
  items: docs.map((d) => map(d.id, d.data() as Record<string, unknown>)),
  cursor: docs.length > 0 ? docs[docs.length - 1]! : null,
  hasMore: docs.length === size,
});

export async function pageProducts(tenantId: string, spec: ProductQuery, cursor: QueryDocumentSnapshot | null): Promise<Page<Product>> {
  if (!cursor && looksLikeCode(spec.search) && spec.mode !== 'expiry') {
    const exact = await findProductByBarcode(tenantId, spec.search.trim(), spec.mode !== 'archived');
    if (exact && (!spec.category || exact.category === spec.category)) return { items: [exact], cursor: null, hasMore: false };
  }
  const snap = await getDocs(query(paths.col(tenantId, 'products'), ...constraintsOf(planProducts(spec, cursor !== null), cursor)));
  return pageOf(snap.docs, (id, data) => toProduct(id, data), CATALOG_PAGE_SIZE);
}

export async function findProductByBarcode(tenantId: string, barcode: string, activeOnly = false): Promise<Product | null> {
  const code = barcode.trim();
  if (!code) return null;
  const snap = await getDocs(query(paths.col(tenantId, 'products'), ...constraintsOf(planBarcode(code, activeOnly), null)));
  const docSnap = snap.docs[0];
  return docSnap ? toProduct(docSnap.id, docSnap.data()) : null;
}

export async function findByNormalizedName(
  tenantId: string,
  collectionName: 'customers' | 'suppliers',
  name: string,
): Promise<{ id: string; name: string } | null> {
  const key = nameNormalized(name);
  if (!key) return null;
  const snap = await getDocs(query(paths.col(tenantId, collectionName), where('nameNormalized', '==', key), limit(1)));
  const docSnap = snap.docs[0];
  return docSnap ? { id: docSnap.id, name: String(docSnap.data().name ?? '') } : null;
}

export async function barcodesInUse(tenantId: string, codes: string[]): Promise<Set<string>> {
  const used = new Set<string>();
  const unique = [...new Set(codes.map((code) => code.trim()).filter(Boolean))];
  for (let i = 0; i < unique.length; i += 10) {
    const part = unique.slice(i, i + 10);
    const snap = await getDocs(query(paths.col(tenantId, 'products'), where('barcode', 'in', part)));
    for (const docSnap of snap.docs) used.add(String(docSnap.data().barcode ?? ''));
  }
  return used;
}

/** Cart lines that are not on the current page. Chunks of 10, which is Firestore's `in` limit. */
export async function getProductsByIds(tenantId: string, ids: string[]): Promise<Product[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  const out: Product[] = [];
  for (let i = 0; i < unique.length; i += 10) {
    const part = unique.slice(i, i + 10);
    const snap = await getDocs(query(paths.col(tenantId, 'products'), where(documentId(), 'in', part)));
    out.push(...snap.docs.map((d) => toProduct(d.id, d.data())));
  }
  return out;
}

export async function countWhere(
  tenantId: string,
  collectionName: 'products' | 'customers' | 'suppliers',
  constraints: QueryConstraint[],
): Promise<number> {
  const snap = await getCountFromServer(query(paths.col(tenantId, collectionName), ...constraints));
  return snap.data().count;
}

/** Pages the low-stock scan reads before it reports an incomplete list. 10 × 50 = 500 products. */
export const LOW_STOCK_MAX_PAGES = 10;

export interface LowStockList {
  /** Active products with stock > 0 that are at or below their own minimum (or the store default). */
  items: Product[];
  /** False when the scan stopped at LOW_STOCK_MAX_PAGES before reading every candidate. */
  complete: boolean;
}

/** Largest per-product minimum stock, or null when no product sets one. */
async function largestMinStock(tenantId: string): Promise<number | null> {
  const snap = await getDocs(query(paths.col(tenantId, 'products'), orderBy('minStock', 'desc'), limit(1)));
  const value = snap.docs[0]?.data().minStock;
  return typeof value === 'number' ? value : null;
}

/**
 * The one low-stock list the dashboard, reports and the assistant share.
 *
 * Firestore cannot compare two fields of the same document, so the scan reads every active
 * product with 0 < stock <= max(store default, largest minStock) and keeps those that are low by
 * their own minimum. Out-of-stock products (stock 0) are a separate list, never counted here.
 */
export async function loadLowStock(tenantId: string, storeDefault: number): Promise<LowStockList> {
  const bound = lowStockScanBound(storeDefault, await largestMinStock(tenantId));
  const spec = emptyProductQuery({ mode: 'low', lowStockAt: bound });
  const items: Product[] = [];
  let cursor: QueryDocumentSnapshot | null = null;
  for (let pageNo = 0; pageNo < LOW_STOCK_MAX_PAGES; pageNo++) {
    const page: Page<Product> = await pageProducts(tenantId, spec, cursor);
    items.push(...perItemLowStock(page.items, storeDefault));
    if (!page.hasMore || !page.cursor) return { items, complete: true };
    cursor = page.cursor;
  }
  return { items, complete: false };
}

async function pageParty<T>(
  tenantId: string,
  collectionName: 'customers' | 'suppliers',
  spec: PartyQuery,
  cursor: QueryDocumentSnapshot | null,
  map: (id: string, data: Record<string, unknown>) => T,
): Promise<Page<T>> {
  const planned = planParty(collectionName, spec, cursor !== null);
  const col = paths.col(tenantId, collectionName);
  if (!Array.isArray(planned)) {
    if (cursor) return { items: [], cursor: null, hasMore: false };
    const field = planned.exact === 'email' ? 'emailKey' : 'phoneKey';
    const snap = await getDocs(query(col, where(field, '==', planned.value), limit(CATALOG_PAGE_SIZE)));
    return pageOf(snap.docs, map, CATALOG_PAGE_SIZE);
  }
  const snap = await getDocs(query(col, ...constraintsOf(planned, cursor)));
  return pageOf(snap.docs, map, CATALOG_PAGE_SIZE);
}

export function pageCustomers(tenantId: string, spec: PartyQuery, cursor: QueryDocumentSnapshot | null): Promise<Page<Customer>> {
  return pageParty(tenantId, 'customers', spec, cursor, (id, data) => toCustomer(id, data));
}

export function pageSuppliers(tenantId: string, spec: PartyQuery, cursor: QueryDocumentSnapshot | null): Promise<Page<Supplier>> {
  return pageParty(tenantId, 'suppliers', spec, cursor, (id, data) => toSupplier(id, data));
}

export async function getCustomer(tenantId: string, id: string): Promise<Customer | null> {
  const snap = await getDoc(paths.doc(tenantId, 'customers', id));
  return snap.exists() ? toCustomer(snap.id, snap.data()) : null;
}

export async function getSupplier(tenantId: string, id: string): Promise<Supplier | null> {
  const snap = await getDoc(paths.doc(tenantId, 'suppliers', id));
  return snap.exists() ? toSupplier(snap.id, snap.data()) : null;
}

export { catalogLoadProblem, mergeKnown };

export const searchKeys = { nameNormalized, phoneKey, emailKey };

/** The Firestore implementation. Swap this object to add a dedicated search provider. */
export const firestoreProductSearch: ProductSearch = {
  page: pageProducts,
  byBarcode: findProductByBarcode,
  byCode: (tenantId, code) => findProductByBarcode(tenantId, code, true),
};
