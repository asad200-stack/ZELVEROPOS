import {
  arrayRemove,
  arrayUnion,
  deleteDoc,
  doc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore';
import { firebase } from '@/firebase/app';
import { weightedAverageCost } from '@/domain/inventory';
import type { ImeiEntry, Product, StockMovement, TierPrices } from '@/types/models';
import { paths, toCashbox, toProduct, toStockMovement, type Actor } from './db';
import { AppError } from './errors';
import { auditFields, requireOnline, runTx } from './ops';
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

function productFields(input: ProductInput): DocumentData {
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
    updatedAt: serverTimestamp(),
  };
}

export async function createProduct(actor: Actor, input: ProductInput): Promise<string> {
  const t = actor.tenantId;
  const ref = doc(paths.col(t, 'products'));
  const audit = auditFields(actor);
  const imeis: ImeiEntry[] = input.imeiTracking
    ? [...new Set(input.initialImeis.map((s) => s.trim()).filter(Boolean))].map((imei) => ({ imei, status: 'available' }))
    : [];
  const stock = input.imeiTracking ? imeis.length : Math.max(0, Math.floor(input.initialStock));

  const batch = writeBatch(firebase.db);
  let lastMovementId: string | null = null;
  if (stock > 0) {
    const movementRef = doc(paths.col(t, 'stockMovements'));
    lastMovementId = movementRef.id;
    batch.set(movementRef, {
      productId: ref.id,
      productName: input.name.trim(),
      type: 'initial',
      quantity: stock,
      stockAfter: stock,
      refId: null,
      refNumber: null,
      note: '',
      ...audit,
    });
  }
  batch.set(ref, {
    ...productFields(input),
    stock,
    imeis,
    imageUrl: null,
    imagePath: null,
    lastMovementId,
    createdAt: audit.createdAt,
    createdAtMs: audit.createdAtMs,
    createdBy: actor.uid,
  });
  if (input.category.trim()) batch.set(paths.categories(t), { names: arrayUnion(input.category.trim()) }, { merge: true });
  await commit(batch);
  return ref.id;
}

export async function updateProduct(actor: Actor, id: string, input: ProductInput): Promise<void> {
  const t = actor.tenantId;
  const batch = writeBatch(firebase.db);
  batch.update(paths.doc(t, 'products', id), productFields(input));
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

export async function deleteProduct(actor: Actor, product: Product): Promise<void> {
  await deleteDoc(paths.doc(actor.tenantId, 'products', product.id));
  if (product.imagePath) await deleteStorageFile(product.imagePath);
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

/** Adjusts stock in a transaction, keeping cost, IMEIs, movements and the drawer consistent. */
export async function adjustStock(actor: Actor, input: StockAdjustInput): Promise<void> {
  requireOnline();
  const t = actor.tenantId;
  await runTx(async (tx) => {
    const ref = paths.doc(t, 'products', input.productId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new AppError('error.notFound');
    const product = toProduct(snap.id, snap.data());
    const cashSnap = input.payFromCashbox ? await tx.get(paths.cashbox(t)) : null;

    let delta: number;
    let imeis = product.imeis;
    if (product.imeiTracking) {
      const existing = new Set(product.imeis.map((e) => e.imei));
      const toAdd = [...new Set(input.imeisToAdd.map((s) => s.trim()).filter(Boolean))];
      const dupe = toAdd.find((i) => existing.has(i));
      if (dupe) throw new AppError('error.imeiExists', { imei: dupe });
      const toRemove = new Set(input.imeisToRemove);
      const removable = product.imeis.filter((e) => toRemove.has(e.imei) && e.status === 'available');
      imeis = [
        ...product.imeis.filter((e) => !(toRemove.has(e.imei) && e.status === 'available')),
        ...toAdd.map((imei) => ({ imei, status: 'available' as const })),
      ];
      delta = toAdd.length - removable.length;
    } else {
      const qty = Math.floor(input.quantity);
      if (!Number.isFinite(qty) || qty < 0) throw new AppError('error.invalidQuantity');
      if (input.mode === 'add') delta = qty;
      else if (input.mode === 'remove') delta = -qty;
      else delta = qty - product.stock;
    }
    if (delta === 0) throw new AppError('error.noChange');
    const newStock = product.stock + delta;
    if (newStock < 0) throw new AppError('error.insufficientStock', { name: product.name, available: product.stock });

    const audit = auditFields(actor);
    const movementRef = doc(paths.col(t, 'stockMovements'));
    const update: DocumentData = { stock: newStock, lastMovementId: movementRef.id, updatedAt: serverTimestamp() };
    if (product.imeiTracking) update.imeis = imeis;
    const addCost = delta > 0 && input.unitCostUsdCents !== null ? Math.max(0, Math.round(input.unitCostUsdCents)) : null;
    if (addCost !== null) update.costUsdCents = weightedAverageCost(product.stock, product.costUsdCents, delta, addCost);

    tx.update(ref, update);
    tx.set(movementRef, {
      productId: product.id,
      productName: product.name,
      type: 'adjustment',
      quantity: delta,
      stockAfter: newStock,
      refId: null,
      refNumber: null,
      note: input.note.trim().slice(0, 300),
      ...audit,
    });

    if (input.payFromCashbox && addCost !== null && addCost * delta > 0 && cashSnap) {
      const cashbox = toCashbox(cashSnap.data());
      const amount = addCost * delta;
      if (amount > cashbox.usdCents) throw new AppError('error.drawerInsufficient');
      const cashRef = doc(paths.col(t, 'cashTransactions'));
      tx.set(cashRef, {
        type: 'expense',
        usdCents: -amount,
        lbp: 0,
        balanceAfter: { usdCents: cashbox.usdCents - amount, lbp: cashbox.lbp },
        category: 'stockPurchase',
        note: `${product.name} × ${delta}`,
        refId: product.id,
        refNumber: null,
        ...audit,
      });
      tx.set(paths.cashbox(t), { usdCents: increment(-amount), lastTxId: cashRef.id, updatedAt: serverTimestamp() }, { merge: true });
      tx.set(
        paths.doc(t, 'dailyStats', audit.localDate),
        { date: audit.localDate, expensesUsdCents: increment(amount), updatedAt: serverTimestamp() },
        { merge: true },
      );
    }
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

/** Imports new products in chunks of 200 (each product + its initial movement = 2 writes). */
export async function importProducts(actor: Actor, rows: ImportRow[], onProgress?: (done: number) => void): Promise<number> {
  requireOnline();
  const t = actor.tenantId;
  let done = 0;
  const categories = [...new Set(rows.map((r) => r.category.trim()).filter(Boolean))];
  for (let i = 0; i < rows.length; i += 200) {
    const batch = writeBatch(firebase.db);
    for (const row of rows.slice(i, i + 200)) {
      const ref = doc(paths.col(t, 'products'));
      const audit = auditFields(actor);
      let lastMovementId: string | null = null;
      if (row.stock > 0) {
        const movementRef = doc(paths.col(t, 'stockMovements'));
        lastMovementId = movementRef.id;
        batch.set(movementRef, {
          productId: ref.id,
          productName: row.name,
          type: 'initial',
          quantity: row.stock,
          stockAfter: row.stock,
          refId: null,
          refNumber: null,
          note: 'import',
          ...audit,
        });
      }
      batch.set(ref, {
        name: row.name,
        category: row.category,
        barcode: row.barcode,
        prices: row.prices,
        costUsdCents: row.costUsdCents,
        minStock: row.minStock,
        supplierId: null,
        supplierName: '',
        expiryDate: row.expiryDate,
        imeiTracking: false,
        imeis: [],
        stock: row.stock,
        imageUrl: null,
        imagePath: null,
        lastMovementId,
        createdAt: audit.createdAt,
        createdAtMs: audit.createdAtMs,
        createdBy: actor.uid,
        updatedAt: serverTimestamp(),
      });
    }
    if (i === 0 && categories.length) batch.set(paths.categories(t), { names: arrayUnion(...categories) }, { merge: true });
    await batch.commit();
    done = Math.min(rows.length, i + 200);
    onProgress?.(done);
  }
  return done;
}
