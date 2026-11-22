import {
  arrayRemove,
  arrayUnion,
  getDocs,
  limit,
  documentId,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
  writeBatch,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { nameNormalized } from '@/domain/searchKey';
import { firebase } from '@/firebase/app';
import type { Product, ProductStatus, StockMovement, TierPrices } from '@/types/models';
import { paths, toProduct, toStockMovement, type Actor } from './db';
import { newClientOperationId, retryOnTransport } from './clientOperation';
import { AppError } from './errors';
import { posApi, type ProductFieldsCall } from './functionsClient';
import { findProductByBarcode } from './catalogQuery';
import { requireOnline } from './ops';
import { deleteStorageFile } from './storageService';

export interface ProductInput {
  name: string;
  category: string;
  barcode: string;
  prices: TierPrices;
  costUsdCents: number;
  /** False when costUsdCents is $0.00 only because the purchase cost was not provided. */
  costKnown?: boolean;
  minStock: number | null;
  supplierId: string | null;
  supplierName: string;
  expiryDate: string | null;
  imeiTracking: boolean;
  /** Only used on creation. */
  initialStock: number;
  initialImeis: string[];
}

export async function assertUniqueBarcode(tenantId: string, barcode: string, selfId?: string): Promise<void> {
  const code = barcode.trim();
  if (!code) return;
  const dup = await findProductByBarcode(tenantId, code);
  if (dup && dup.id !== selfId) throw new AppError('error.barcodeInUse', { name: dup.name });
}

function productFields(input: ProductInput): ProductFieldsCall {
  return {
    name: input.name.trim(),
    category: input.category.trim(),
    barcode: input.barcode.trim(),
    prices: input.prices,
    costUsdCents: Math.max(0, Math.round(input.costUsdCents)),
    costKnown: input.costKnown !== false,
    minStock: input.minStock,
    supplierId: input.supplierId,
    supplierName: input.supplierName,
    expiryDate: input.expiryDate || null,
    imeiTracking: input.imeiTracking,
  };
}

/** Creates a product server-side (initial stock is recorded as a stock movement). */
export async function createProduct(
  input: ProductInput,
  clientOperationId = newClientOperationId(),
): Promise<{ id: string; duplicate: boolean }> {
  requireOnline();
  const trimmed = input.initialImeis.map((s) => s.trim()).filter(Boolean);
  const initialImeis = [...new Set(trimmed)];
  const duplicateSerial = trimmed.find((serial, index) => trimmed.indexOf(serial) !== index);
  if (duplicateSerial) throw new AppError('error.imeiExists', { imei: duplicateSerial });
  const stock = Math.max(0, Math.floor(input.initialStock));
  // Stock 0 still means "use the serial count" for older clients. Any other count must match.
  if (input.imeiTracking && stock !== 0 && stock !== initialImeis.length) {
    throw new AppError('error.initialImeiCount', { stock });
  }
  return retryOnTransport(() =>
    posApi.createProduct({
      clientOperationId,
      product: productFields(input),
      initialStock: stock,
      initialImeis: input.imeiTracking ? initialImeis : [],
    }),
  );
}

export interface VariantRowInput {
  values: string[];
  stock: number;
  barcode: string;
  /** Retail price for this option only; null = the item's price. */
  retailUsdCents: number | null;
}

/** Creates an item sold in sizes/colours: one product per option, each with its own stock. */
export async function createProductGroup(
  input: ProductInput,
  axes: { name: string; values: string[] }[],
  rows: VariantRowInput[],
  clientOperationId = newClientOperationId(),
): Promise<{ groupId: string; ids: string[] }> {
  requireOnline();
  const { barcode: _barcode, imeiTracking: _imei, ...product } = productFields(input);
  return retryOnTransport(() =>
    posApi.createProductGroup({
      clientOperationId,
      product,
      axes,
      rows: rows.map((r) => ({ ...r, stock: Math.max(0, Math.floor(r.stock)), barcode: r.barcode.trim() })),
    }),
  );
}

/** Every option (size/colour) of an item, archived ones included. */
export async function listGroupOptions(tenantId: string, groupId: string): Promise<Product[]> {
  const snap = await getDocs(query(paths.col(tenantId, 'products'), where('groupId', '==', groupId), limit(200)));
  return snap.docs.map((d) => toProduct(d.id, d.data()));
}

/** Adds new sizes/colours to an item that already has some. */
export async function addProductOptions(groupId: string, rows: VariantRowInput[], clientOperationId = newClientOperationId()): Promise<{ ids: string[] }> {
  requireOnline();
  return retryOnTransport(() =>
    posApi.addProductOptions({
      clientOperationId,
      groupId,
      rows: rows.map((r) => ({ ...r, stock: Math.max(0, Math.floor(r.stock)), barcode: r.barcode.trim() })),
    }),
  );
}

/** Edits master data only; stock and IMEIs change exclusively through server-side operations. */
export async function updateProduct(actor: Actor, id: string, input: ProductInput, current: Product): Promise<void> {
  if (input.imeiTracking !== current.imeiTracking && (current.stock !== 0 || current.imeis.length > 0)) {
    throw new AppError('error.imeiTrackingLocked');
  }
  const t = actor.tenantId;
  const batch = writeBatch(firebase.db);
  batch.update(paths.doc(t, 'products', id), {
    ...productFields(input),
    nameNormalized: nameNormalized(input.name),
    updatedAt: serverTimestamp(),
  });
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
  const clientOperationId = newClientOperationId();
  await retryOnTransport(() =>
    posApi.adjustStock({
      clientOperationId,
      productId: input.productId,
      mode: input.mode,
      quantity,
      unitCostUsdCents: input.unitCostUsdCents === null ? null : Math.max(0, Math.round(input.unitCostUsdCents)),
      payFromCashbox: input.payFromCashbox,
      imeisToAdd: [...new Set(input.imeisToAdd.map((s) => s.trim()).filter(Boolean))],
      imeisToRemove: input.imeisToRemove,
      note: input.note.trim().slice(0, 300),
    }),
  );
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

/** True when at least one product has an unknown cost. A stored zero is not treated as a known cost. */
export async function catalogHasUnknownCost(tenantId: string): Promise<boolean> {
  const snap = await getDocs(query(paths.col(tenantId, 'products'), where('costKnown', '==', false), limit(1)));
  return !snap.empty;
}

async function categoryPage(tenantId: string, name: string, cursor: QueryDocumentSnapshot | null, size: number) {
  const constraints: QueryConstraint[] = [where('category', '==', name), orderBy(documentId()), limit(size)];
  if (cursor) constraints.push(startAfter(cursor));
  return getDocs(query(paths.col(tenantId, 'products'), ...constraints));
}

export async function deleteCategory(tenantId: string, name: string): Promise<void> {
  const used = await categoryPage(tenantId, name, null, 1);
  if (!used.empty) throw new AppError('error.categoryInUse');
  await setDoc(paths.categories(tenantId), { names: arrayRemove(name) }, { merge: true });
}

export async function renameCategory(tenantId: string, from: string, to: string): Promise<void> {
  requireOnline();
  const clean = to.trim();
  if (!clean) throw new AppError('error.required');
  await setDoc(paths.categories(tenantId), { names: arrayUnion(clean) }, { merge: true });
  let cursor: QueryDocumentSnapshot | null = null;
  for (;;) {
    const snap = await categoryPage(tenantId, from, cursor, 400);
    if (snap.empty) break;
    const batch = writeBatch(firebase.db);
    for (const docSnap of snap.docs) batch.update(docSnap.ref, { category: clean, updatedAt: serverTimestamp() });
    await batch.commit();
    if (snap.size < 400) break;
    cursor = snap.docs[snap.docs.length - 1] ?? null;
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
  imageUrl?: string | null;
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
