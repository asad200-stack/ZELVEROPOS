import {
  arrayRemove,
  arrayUnion,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { firebase } from '@/firebase/app';
import type { Product, ProductStatus, StockMovement, TierPrices } from '@/types/models';
import { paths, toStockMovement, type Actor } from './db';
import { AppError } from './errors';
import { posApi, type ProductFieldsCall } from './functionsClient';
import { requireOnline } from './ops';
import { deleteStorageFile } from './storageService';

export interface ProductInput {
  name: string;
  category: string;
  barcode: string;
  prices: TierPrices;
  costUsdCents: number;
  minStock: number | null;
  supplierId: string | null;
  supplierName: string;
  expiryDate: string | null;
  imeiTracking: boolean;
  /** Only used on creation. */
  initialStock: number;
  initialImeis: string[];
}

export function assertUniqueBarcode(barcode: string, products: Product[], selfId?: string): void {
  const code = barcode.trim();
  if (!code) return;
  const dup = products.find((p) => p.id !== selfId && p.barcode.trim() === code);
  if (dup) throw new AppError('error.barcodeInUse', { name: dup.name });
}

function productFields(input: ProductInput): ProductFieldsCall {
  return {
    name: input.name.trim(),
    category: input.category.trim(),
    barcode: input.barcode.trim(),
    prices: input.prices,
    costUsdCents: Math.max(0, Math.round(input.costUsdCents)),
    minStock: input.minStock,
    supplierId: input.supplierId,
    supplierName: input.supplierName,
    expiryDate: input.expiryDate || null,
    imeiTracking: input.imeiTracking,
  };
}

/** Creates a product server-side (initial stock is recorded as a stock movement). */
export async function createProduct(input: ProductInput): Promise<string> {
  requireOnline();
  const initialImeis = [...new Set(input.initialImeis.map((s) => s.trim()).filter(Boolean))];
  const { id } = await posApi.createProduct({
    product: productFields(input),
    initialStock: input.imeiTracking ? 0 : Math.max(0, Math.floor(input.initialStock)),
    initialImeis: input.imeiTracking ? initialImeis : [],
  });
  return id;
}

/** Edits master data only; stock and IMEIs change exclusively through server-side operations. */
export async function updateProduct(actor: Actor, id: string, input: ProductInput, current: Product): Promise<void> {
  if (input.imeiTracking !== current.imeiTracking && (current.stock !== 0 || current.imeis.length > 0)) {
    throw new AppError('error.imeiTrackingLocked');
  }
  const t = actor.tenantId;
  const batch = writeBatch(firebase.db);
  batch.update(paths.doc(t, 'products', id), { ...productFields(input), updatedAt: serverTimestamp() });
  if (input.category.trim()) batch.set(paths.categories(t), { names: arrayUnion(input.category.trim()) }, { merge: true });
  await commit(batch);
}

export async function setProductImage(actor: Actor, id: string, image: { url: string; path: string } | null, previousPath: string | null) {
  await updateDoc(paths.doc(actor.tenantId, 'products', id), {
    imageUrl: image?.url ?? null,
    imagePath: image?.path ?? null,
    updatedAt: serverTimestamp(),
  });
  if (previousPath && previousPath !== image?.path) await deleteStorageFile(previousPath);
}

/** Archives (hides from POS and purchases, keeps stock and history) or restores a product. */
export async function setProductStatus(productId: string, status: ProductStatus): Promise<void> {
  requireOnline();
  await posApi.setProductStatus({ productId, status });
}

/** Permanent deletion; the server refuses it for any product with stock or history. */
export async function deleteProductPermanently(productId: string): Promise<void> {
  requireOnline();
  await posApi.deleteProduct({ productId });
}

/** Offline-friendly write: resolves immediately when offline (the SDK syncs later). */
async function commit(batch: ReturnType<typeof writeBatch>): Promise<void> {
  if (!navigator.onLine) {
    batch.commit().catch((e) => console.error('[productService] offline write rejected', e));
    return;
  }
  await batch.commit();
}

/* ---------------------------------------------------------- stock adjust */

export interface StockAdjustInput {
  productId: string;
  mode: 'add' | 'remove' | 'set';
  quantity: number;
  /** Unit cost of added stock → weighted average cost (add mode only). */
  unitCostUsdCents: number | null;
  /** Record the purchase cost as a drawer expense (add mode only). */
  payFromCashbox: boolean;
  imeisToAdd: string[];
  imeisToRemove: string[];
  note: string;
}

/** Adjusts stock server-side, keeping cost, IMEIs, movements and the drawer consistent. */
export async function adjustStock(input: StockAdjustInput): Promise<void> {
  requireOnline();
  const quantity = Math.floor(input.quantity);
  if (!Number.isFinite(quantity) || quantity < 0) throw new AppError('error.invalidQuantity');
  await posApi.adjustStock({
    productId: input.productId,
    mode: input.mode,
    quantity,
    unitCostUsdCents: input.unitCostUsdCents === null ? null : Math.max(0, Math.round(input.unitCostUsdCents)),
    payFromCashbox: input.payFromCashbox,
    imeisToAdd: [...new Set(input.imeisToAdd.map((s) => s.trim()).filter(Boolean))],
    imeisToRemove: input.imeisToRemove,
    note: input.note.trim().slice(0, 300),
  });
}

export async function listMovements(tenantId: string, productId: string): Promise<StockMovement[]> {
  const snap = await getDocs(
    query(paths.col(tenantId, 'stockMovements'), where('productId', '==', productId), orderBy('createdAtMs', 'desc'), limit(100)),
  );
  return snap.docs.map((d) => toStockMovement(d.id, d.data()));
}

/* ------------------------------------------------------------ categories */

export async function addCategory(tenantId: string, name: string): Promise<void> {
  const clean = name.trim();
  if (!clean) throw new AppError('error.required');
  await setDoc(paths.categories(tenantId), { names: arrayUnion(clean) }, { merge: true });
}

export async function deleteCategory(tenantId: string, name: string, products: Product[]): Promise<void> {
  if (products.some((p) => p.category === name)) throw new AppError('error.categoryInUse');
  await setDoc(paths.categories(tenantId), { names: arrayRemove(name) }, { merge: true });
}

export async function renameCategory(tenantId: string, from: string, to: string, products: Product[]): Promise<void> {
  requireOnline();
  const clean = to.trim();
  if (!clean) throw new AppError('error.required');
  await setDoc(paths.categories(tenantId), { names: arrayUnion(clean) }, { merge: true });
  const affected = products.filter((p) => p.category === from);
  for (let i = 0; i < affected.length; i += 400) {
    const batch = writeBatch(firebase.db);
    for (const p of affected.slice(i, i + 400)) {
      batch.update(paths.doc(tenantId, 'products', p.id), { category: clean, updatedAt: serverTimestamp() });
    }
    await batch.commit();
  }
  await setDoc(paths.categories(tenantId), { names: arrayRemove(from) }, { merge: true });
}

/* ---------------------------------------------------------------- import */

export interface ImportRow {
  name: string;
  barcode: string;
  category: string;
  prices: TierPrices;
  costUsdCents: number;
  stock: number;
  minStock: number | null;
  expiryDate: string | null;
}

const IMPORT_CHUNK = 200;

/** Imports new products server-side in chunks of 200 (initial stock recorded as movements). */
export async function importProducts(rows: ImportRow[], onProgress?: (done: number) => void): Promise<number> {
  requireOnline();
  let done = 0;
  for (let i = 0; i < rows.length; i += IMPORT_CHUNK) {
    const chunk = rows.slice(i, i + IMPORT_CHUNK);
    await posApi.importProducts({ rows: chunk });
    done += chunk.length;
    onProgress?.(done);
  }
  return done;
}
