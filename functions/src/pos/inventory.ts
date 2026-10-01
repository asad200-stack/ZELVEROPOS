import { FieldValue, type DocumentData } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db, storage } from '../admin.js';
import { fail } from '../errors.js';
import { weightedAverageCost } from '../shared/inventory.js';
import { parse } from '../validate.js';
import { auditFields, bumpDailyStats, cents, idField, lbpField, posActor, tenantPaths, toCashbox, toProduct } from './common.js';

const tierPrice = z.object({ usdCents: cents, lbp: lbpField.nullable() });
const prices = z.object({ retail: tierPrice, wholesale: tierPrice, vip: tierPrice });
const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const imeiField = z.string().trim().min(1).max(64);

const productFields = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().max(100),
  barcode: z.string().trim().max(100),
  prices,
  costUsdCents: cents,
  minStock: z.number().int().min(0).max(1_000_000).nullable(),
  supplierId: idField.nullable(),
  supplierName: z.string().trim().max(200),
  expiryDate: dateField.nullable(),
  imeiTracking: z.boolean(),
});

const createSchema = z.object({
  product: productFields,
  initialStock: z.number().int().min(0).max(1_000_000),
  initialImeis: z.array(imeiField).max(5000),
});

async function assertBarcodeFree(t: string, barcode: string): Promise<void> {
  if (!barcode) return;
  const dup = await tenantPaths(t).col('products').where('barcode', '==', barcode).limit(1).get();
  const hit = dup.docs[0];
  if (hit) fail('already-exists', 'error.barcodeInUse', { name: String(hit.data().name ?? '') });
}

/** Creates a product; initial stock is recorded as an 'initial' stock movement. */
export const posCreateProduct = onCall(async (request) => {
  const input = parse(createSchema, request.data);
  const actor = await posActor(request, ['canAddProducts']);
  const t = actor.tenantId;
  const p = tenantPaths(t);
  const f = input.product;
  await assertBarcodeFree(t, f.barcode);

  const imeis = f.imeiTracking ? [...new Set(input.initialImeis)].map((imei) => ({ imei, status: 'available' })) : [];
  const stock = f.imeiTracking ? imeis.length : input.initialStock;
  const atMs = Date.now();
  const audit = auditFields(actor, atMs);
  const ref = p.newRef('products');
  const batch = db.batch();
  let lastMovementId: string | null = null;
  if (stock > 0) {
    const movementRef = p.newRef('stockMovements');
    lastMovementId = movementRef.id;
    batch.set(movementRef, {
      productId: ref.id,
      productName: f.name,
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
    ...f,
    stock,
    imeis,
    imageUrl: null,
    imagePath: null,
    lastMovementId,
    status: 'active',
    archivedAt: null,
    createdAt: audit.createdAt,
    createdAtMs: atMs,
    createdBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp(),
  });
  if (f.category) batch.set(p.categories, { names: FieldValue.arrayUnion(f.category) }, { merge: true });
  await batch.commit();
  return { id: ref.id };
});

const importSchema = z.object({
  rows: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        barcode: z.string().trim().max(100),
        category: z.string().trim().max(100),
        prices,
        costUsdCents: cents,
        stock: z.number().int().min(0).max(1_000_000),
        minStock: z.number().int().min(0).max(1_000_000).nullable(),
        expiryDate: dateField.nullable(),
      }),
    )
    .min(1)
    .max(200),
});

/** Imports up to 200 new products per call (the client sends larger files in chunks). */
export const posImportProducts = onCall(async (request) => {
  const input = parse(importSchema, request.data);
  const actor = await posActor(request, ['canImportProducts']);
  const p = tenantPaths(actor.tenantId);
  const atMs = Date.now();
  const audit = auditFields(actor, atMs);
  const batch = db.batch();
  for (const row of input.rows) {
    const ref = p.newRef('products');
    let lastMovementId: string | null = null;
    if (row.stock > 0) {
      const movementRef = p.newRef('stockMovements');
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
      ...row,
      supplierId: null,
      supplierName: '',
      imeiTracking: false,
      imeis: [],
      imageUrl: null,
      imagePath: null,
      lastMovementId,
      status: 'active',
      archivedAt: null,
      createdAt: audit.createdAt,
      createdAtMs: atMs,
      createdBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  const categories = [...new Set(input.rows.map((r) => r.category).filter(Boolean))];
  if (categories.length) batch.set(p.categories, { names: FieldValue.arrayUnion(...categories) }, { merge: true });
  await batch.commit();
  return { imported: input.rows.length };
});

const statusSchema = z.object({ productId: idField, status: z.enum(['active', 'archived']) });

/** Archives (hides from selling/purchasing, keeps stock and history) or restores a product. */
export const posSetProductStatus = onCall(async (request) => {
  const input = parse(statusSchema, request.data);
  const actor = await posActor(request, ['canDeleteProducts']);
  const ref = tenantPaths(actor.tenantId).doc('products', input.productId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not-found', 'error.notFound');
    const current = snap.data()!.status === 'archived' ? 'archived' : 'active';
    if (current === input.status) fail('failed-precondition', 'error.noChange');
    tx.update(ref, {
      status: input.status,
      archivedAt: input.status === 'archived' ? FieldValue.serverTimestamp() : null,
      archivedBy: input.status === 'archived' ? actor.uid : null,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return { ok: true };
});

/** Collections whose documents keep a `productIds` array of every product they reference. */
const REFERENCING = ['sales', 'returns', 'purchases', 'purchaseReturns'] as const;

/**
 * Permanently deletes a product ONLY when nothing depends on it: zero stock, no IMEIs, no stock
 * movement and no sale/return/purchase/supplier return referencing it. Otherwise it must be archived.
 */
export const posDeleteProduct = onCall(async (request) => {
  const input = parse(z.object({ productId: idField }), request.data);
  const actor = await posActor(request, ['canDeleteProducts']);
  const p = tenantPaths(actor.tenantId);
  const ref = p.doc('products', input.productId);

  const imagePath = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not-found', 'error.notFound');
    const product = toProduct(snap.id, snap.data()!);
    if (product.stock !== 0 || product.imeis.length > 0) fail('failed-precondition', 'error.productInUse', { name: product.name });
    const checks = await Promise.all([
      tx.get(p.col('stockMovements').where('productId', '==', product.id).limit(1)),
      ...REFERENCING.map((name) => tx.get(p.col(name).where('productIds', 'array-contains', product.id).limit(1))),
    ]);
    if (checks.some((q) => !q.empty)) fail('failed-precondition', 'error.productInUse', { name: product.name });
    tx.delete(ref);
    return product.imagePath;
  });

  if (imagePath) {
    try {
      await storage().file(imagePath).delete({ ignoreNotFound: true });
    } catch (e) {
      console.warn('[posDeleteProduct] image cleanup failed', imagePath, e);
    }
  }
  return { ok: true };
});

const adjustSchema = z.object({
  productId: idField,
  mode: z.enum(['add', 'remove', 'set']),
  quantity: z.number().int().min(0).max(1_000_000),
  unitCostUsdCents: cents.nullable(),
  payFromCashbox: z.boolean(),
  imeisToAdd: z.array(imeiField).max(5000),
  imeisToRemove: z.array(imeiField).max(5000),
  note: z.string().trim().max(300).default(''),
});

/** Manual stock correction: always recorded as a movement; stock never goes below zero. */
export const posAdjustStock = onCall(async (request) => {
  const input = parse(adjustSchema, request.data);
  const actor = await posActor(request, ['canEditProducts']);
  if (input.payFromCashbox && !actor.can('canManageCashDrawer')) fail('permission-denied', 'error.permissionDenied');
  const t = actor.tenantId;
  const p = tenantPaths(t);
  const atMs = Date.now();

  await db.runTransaction(async (tx) => {
    const ref = p.doc('products', input.productId);
    const [snap, cashSnap] = await Promise.all([tx.get(ref), input.payFromCashbox ? tx.get(p.cashbox) : Promise.resolve(null)]);
    if (!snap.exists) fail('not-found', 'error.notFound');
    const product = toProduct(snap.id, snap.data()!);

    let delta: number;
    let imeis = product.imeis;
    if (product.imeiTracking) {
      const existing = new Set(product.imeis.map((e) => e.imei));
      const toAdd = [...new Set(input.imeisToAdd)];
      const dupe = toAdd.find((i) => existing.has(i));
      if (dupe) fail('already-exists', 'error.imeiExists', { imei: dupe });
      const toRemove = new Set(input.imeisToRemove);
      const removable = product.imeis.filter((e) => toRemove.has(e.imei) && e.status === 'available');
      imeis = [
        ...product.imeis.filter((e) => !(toRemove.has(e.imei) && e.status === 'available')),
        ...toAdd.map((imei) => ({ imei, status: 'available' as const })),
      ];
      delta = toAdd.length - removable.length;
    } else if (input.mode === 'add') delta = input.quantity;
    else if (input.mode === 'remove') delta = -input.quantity;
    else delta = input.quantity - product.stock;
    if (delta === 0) fail('failed-precondition', 'error.noChange');
    const newStock = product.stock + delta;
    if (newStock < 0) fail('failed-precondition', 'error.insufficientStock', { name: product.name, available: product.stock });

    const audit = auditFields(actor, atMs);
    const movementRef = p.newRef('stockMovements');
    const update: DocumentData = { stock: newStock, lastMovementId: movementRef.id, updatedAt: FieldValue.serverTimestamp() };
    if (product.imeiTracking) update.imeis = imeis;
    const addCost = delta > 0 && input.unitCostUsdCents !== null ? input.unitCostUsdCents : null;
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
      note: input.note,
      ...audit,
    });

    const amount = addCost !== null ? addCost * delta : 0;
    if (input.payFromCashbox && amount > 0 && cashSnap) {
      const cashbox = toCashbox(cashSnap.data());
      if (amount > cashbox.usdCents) fail('failed-precondition', 'error.drawerInsufficient');
      const cashRef = p.newRef('cashTransactions');
      const after = { usdCents: cashbox.usdCents - amount, lbp: cashbox.lbp };
      tx.set(cashRef, {
        type: 'expense',
        usdCents: -amount,
        lbp: 0,
        balanceAfter: after,
        category: 'stockPurchase',
        note: `${product.name} × ${delta}`,
        refId: product.id,
        refNumber: null,
        ...audit,
      });
      tx.set(p.cashbox, { ...after, lastTxId: cashRef.id, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      bumpDailyStats(tx, t, audit.localDate, { expensesUsdCents: amount });
    }
  });
  return { ok: true };
});
