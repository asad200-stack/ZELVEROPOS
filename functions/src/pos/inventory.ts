import { FieldValue, type DocumentData } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db, storage } from '../admin.js';
import { fail } from '../errors.js';
import { weightedAverageCost } from '../shared/inventory.js';
import { MAX_VISIBLE_PRODUCTS } from '../shared/onlineStore.js';
import { inheritedPhoto } from '../shared/variants.js';
import { nameNormalized } from '../shared/searchKey.js';
import { parse } from '../validate.js';
import type { Product } from '../shared/models.js';
import { PACK_SIZE_MAX, PACK_SIZE_MIN, STOCK_LINKS_MAX, STOCK_LINK_QTY_MAX, packIssues, planOpenPack, stockLinkIssues } from '../shared/stockUnits.js';
import { assertOwnStock, auditFields, bumpDailyStats, cents, idField, lbpField, posActor, runClientOp, tenantPaths, toCashbox, toProduct } from './common.js';

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
  /** False when $0.00 is stored only because the purchase cost was not provided. */
  costKnown: z.boolean().optional(),
  minStock: z.number().int().min(0).max(1_000_000).nullable(),
  supplierId: idField.nullable(),
  supplierName: z.string().trim().max(200),
  expiryDate: dateField.nullable(),
  imeiTracking: z.boolean(),
});

const createSchema = z.object({
  clientOperationId: idField,
  /** Test-only pause. Honored only inside the Functions emulator; ignored in production. */
  emulatorDelayMs: z.number().int().min(0).max(20_000).optional(),
  product: productFields,
  initialStock: z.number().int().min(0).max(1_000_000),
  initialImeis: z.array(imeiField).max(5000),
});

async function emulatorDelay(ms: number | undefined): Promise<void> {
  if (process.env.FUNCTIONS_EMULATOR !== 'true' || !ms) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Creates a product once per clientOperationId. A timeout, a retry, or a late completion of the
 * same operation returns the original product instead of writing a second one.
 */
export const posCreateProduct = onCall(async (request) => {
  const input = parse(createSchema, request.data);
  const f = input.product;
  const trimmedImeis = input.initialImeis.map((imei) => imei.trim()).filter(Boolean);
  if (f.imeiTracking) {
    const seen = new Set<string>();
    for (const imei of trimmedImeis) {
      if (seen.has(imei)) fail('already-exists', 'error.imeiExists', { imei });
      seen.add(imei);
    }
    // Opening quantity is the serial list. A non-zero requested count that disagrees is refused
    // so the product cannot claim more devices than it has serial numbers. Zero keeps the
    // previous client behavior: stock equals the number of serials.
    if (input.initialStock !== 0 && input.initialStock !== trimmedImeis.length) {
      fail('invalid-argument', 'error.initialImeiCount', { stock: input.initialStock, count: trimmedImeis.length });
    }
  }
  const imeis = f.imeiTracking ? trimmedImeis.map((imei) => ({ imei, status: 'available' as const })) : [];
  const stock = f.imeiTracking ? imeis.length : input.initialStock;
  // Pause before the write so a repeated request can commit first and this call replays it.
  await emulatorDelay(input.emulatorDelayMs);
  return runClientOp(request, input.clientOperationId, 'posCreateProduct', ['canAddProducts'], async (tx, actor) => {
    const p = tenantPaths(actor.tenantId);
    if (f.barcode) {
      const taken = await tx.get(p.col('products').where('barcode', '==', f.barcode).limit(1));
      const hit = taken.docs[0];
      if (hit) fail('already-exists', 'error.barcodeInUse', { name: String(hit.data().name ?? '') });
    }
    const atMs = Date.now();
    const audit = auditFields(actor, atMs);
    const ref = p.newRef('products');
    let lastMovementId: string | null = null;
    if (stock > 0) {
      const movementRef = p.newRef('stockMovements');
      lastMovementId = movementRef.id;
      tx.set(movementRef, {
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
    const { costKnown, ...fields } = f;
    tx.set(ref, {
      ...fields,
      costKnown: costKnown !== false,
      nameNormalized: nameNormalized(f.name),
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
    if (f.category) tx.set(p.categories, { names: FieldValue.arrayUnion(f.category) }, { merge: true });
    return { id: ref.id };
  });
});

const optionText = z.string().trim().min(1).max(30);
const groupSchema = z.object({
  clientOperationId: idField,
  /** Shared fields; `name` is the item's own name, the barcode is per option. */
  product: productFields.omit({ barcode: true, imeiTracking: true }),
  axes: z.array(z.object({ name: optionText, values: z.array(optionText).min(1).max(60) })).min(1).max(2),
  rows: z
    .array(
      z.object({
        /** One value per axis, in axis order. */
        values: z.array(optionText).min(1).max(2),
        stock: z.number().int().min(0).max(1_000_000),
        barcode: z.string().trim().max(100),
        /** Retail price for this option when it differs from the item's (e.g. XXL costs more). */
        retailUsdCents: cents.nullable(),
      }),
    )
    .min(1)
    .max(60),
});

/**
 * Creates an item sold in sizes/colours: one product per option, each with its own stock, all
 * sharing a groupId. Once per clientOperationId, like posCreateProduct.
 */
export const posCreateProductGroup = onCall(async (request) => {
  const input = parse(groupSchema, request.data);
  const f = input.product;
  const axes = input.axes;
  const seen = new Set<string>();
  const codes = new Set<string>();
  for (const row of input.rows) {
    if (row.values.length !== axes.length) fail('invalid-argument', 'error.invalidInput');
    row.values.forEach((v, i) => {
      if (!axes[i]!.values.includes(v)) fail('invalid-argument', 'error.invalidInput');
    });
    const key = row.values.join('\u0001').toLowerCase();
    if (seen.has(key)) fail('invalid-argument', 'error.invalidInput');
    seen.add(key);
    if (row.barcode) {
      if (codes.has(row.barcode)) fail('already-exists', 'error.barcodeInUse', { name: row.barcode });
      codes.add(row.barcode);
    }
  }
  return runClientOp(request, input.clientOperationId, 'posCreateProductGroup', ['canAddProducts'], async (tx, actor) => {
    const p = tenantPaths(actor.tenantId);
    for (const code of codes) {
      const taken = await tx.get(p.col('products').where('barcode', '==', code).limit(1));
      const hit = taken.docs[0];
      if (hit) fail('already-exists', 'error.barcodeInUse', { name: String(hit.data().name ?? '') });
    }
    const atMs = Date.now();
    const audit = auditFields(actor, atMs);
    const groupId = p.newRef('products').id;
    const { costKnown, ...fields } = f;
    const ids: string[] = [];
    for (const row of input.rows) {
      const ref = p.newRef('products');
      ids.push(ref.id);
      const name = `${f.name} - ${row.values.join(' / ')}`.slice(0, 200);
      let lastMovementId: string | null = null;
      if (row.stock > 0) {
        const movementRef = p.newRef('stockMovements');
        lastMovementId = movementRef.id;
        tx.set(movementRef, {
          productId: ref.id,
          productName: name,
          type: 'initial',
          quantity: row.stock,
          stockAfter: row.stock,
          refId: null,
          refNumber: null,
          note: '',
          ...audit,
        });
      }
      const prices =
        row.retailUsdCents === null ? f.prices : { ...f.prices, retail: { usdCents: row.retailUsdCents, lbp: null } };
      tx.set(ref, {
        ...fields,
        prices,
        name,
        barcode: row.barcode,
        imeiTracking: false,
        costKnown: costKnown !== false,
        nameNormalized: nameNormalized(name),
        groupId,
        groupName: f.name,
        options: row.values.map((value, i) => ({ name: axes[i]!.name, value })),
        stock: row.stock,
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
    if (f.category) tx.set(p.categories, { names: FieldValue.arrayUnion(f.category) }, { merge: true });
    return { groupId, ids };
  });
});

const addOptionsSchema = z.object({
  clientOperationId: idField,
  groupId: idField,
  rows: groupSchema.shape.rows,
});

/**
 * Adds new sizes/colours to an existing item (e.g. XL after S/M/L). The new options copy the
 * item's shared fields from an existing option; a combination that already exists is refused.
 */
export const posAddProductOptions = onCall(async (request) => {
  const input = parse(addOptionsSchema, request.data);
  const codes = new Set<string>();
  for (const row of input.rows) {
    if (!row.barcode) continue;
    if (codes.has(row.barcode)) fail('already-exists', 'error.barcodeInUse', { name: row.barcode });
    codes.add(row.barcode);
  }
  return runClientOp(request, input.clientOperationId, 'posAddProductOptions', ['canAddProducts'], async (tx, actor) => {
    const p = tenantPaths(actor.tenantId);
    const siblings = await tx.get(p.col('products').where('groupId', '==', input.groupId).limit(200));
    const template = siblings.docs.find((d) => d.data().status !== 'archived') ?? siblings.docs[0];
    if (!template) fail('not-found', 'error.notFound');
    const t = template.data();
    const axisNames = (Array.isArray(t.options) ? (t.options as { name?: unknown }[]) : []).map((o) => String(o.name ?? ''));
    if (axisNames.length === 0) fail('failed-precondition', 'error.invalidInput');
    if (siblings.size + input.rows.length > 200) fail('invalid-argument', 'error.invalidInput');
    const have = new Set(
      siblings.docs.map((d) =>
        (Array.isArray(d.data().options) ? (d.data().options as { value?: unknown }[]) : []).map((o) => String(o.value ?? '').toLowerCase()).join('\u0001'),
      ),
    );
    for (const row of input.rows) {
      if (row.values.length !== axisNames.length) fail('invalid-argument', 'error.invalidInput');
      const key = row.values.map((v) => v.toLowerCase()).join('\u0001');
      if (have.has(key)) fail('already-exists', 'error.alreadyExists');
      have.add(key);
    }
    for (const code of codes) {
      const taken = await tx.get(p.col('products').where('barcode', '==', code).limit(1));
      const hit = taken.docs[0];
      if (hit) fail('already-exists', 'error.barcodeInUse', { name: String(hit.data().name ?? '') });
    }
    // When the item is already on the online store, its new sizes go online with it.
    const storeDoc = db.doc(`onlineStores/${actor.tenantId}`);
    const store = await tx.get(storeDoc);
    const shown: unknown[] = Array.isArray(store.get('visibleProductIds')) ? (store.get('visibleProductIds') as unknown[]) : [];
    const itemOnline = siblings.docs.some((d) => shown.includes(d.id));
    const atMs = Date.now();
    const audit = auditFields(actor, atMs);
    const base = String(t.groupName ?? '') || String(t.name ?? '');
    const looks = siblings.docs
      .filter((d) => d.data().status !== 'archived')
      .map((d) => toProduct(d.id, d.data()));
    const ids: string[] = [];
    for (const row of input.rows) {
      const ref = p.newRef('products');
      ids.push(ref.id);
      const name = `${base} - ${row.values.join(' / ')}`.slice(0, 200);
      let lastMovementId: string | null = null;
      if (row.stock > 0) {
        const movementRef = p.newRef('stockMovements');
        lastMovementId = movementRef.id;
        tx.set(movementRef, {
          productId: ref.id,
          productName: name,
          type: 'initial',
          quantity: row.stock,
          stockAfter: row.stock,
          refId: null,
          refNumber: null,
          note: '',
          ...audit,
        });
      }
      const prices = t.prices as DocumentData;
      tx.set(ref, {
        name,
        nameNormalized: nameNormalized(name),
        category: String(t.category ?? ''),
        barcode: row.barcode,
        prices: row.retailUsdCents === null ? prices : { ...prices, retail: { usdCents: row.retailUsdCents, lbp: null } },
        costUsdCents: typeof t.costUsdCents === 'number' ? t.costUsdCents : 0,
        costKnown: t.costKnown !== false,
        minStock: typeof t.minStock === 'number' ? t.minStock : null,
        supplierId: typeof t.supplierId === 'string' ? t.supplierId : null,
        supplierName: String(t.supplierName ?? ''),
        expiryDate: typeof t.expiryDate === 'string' ? t.expiryDate : null,
        imeiTracking: false,
        groupId: input.groupId,
        groupName: base,
        options: row.values.map((value, i) => ({ name: axisNames[i]!, value })),
        stock: row.stock,
        imeis: [],
        // A new size starts with the photo of its colour. The file is shared; deleting or
        // replacing one option's photo keeps a file another option still uses.
        imageUrl: inheritedPhoto(looks, row.values)?.imageUrl ?? null,
        imagePath: inheritedPhoto(looks, row.values)?.imagePath ?? null,
        lastMovementId,
        status: 'active',
        archivedAt: null,
        createdAt: audit.createdAt,
        createdAtMs: atMs,
        createdBy: actor.uid,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    if (itemOnline && shown.length + ids.length <= MAX_VISIBLE_PRODUCTS) {
      tx.update(storeDoc, { visibleProductIds: FieldValue.arrayUnion(...ids), updatedAt: atMs });
    }
    return { ids, online: itemOnline };
  });
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
        imageUrl: z.string().trim().url().max(2000).nullable().optional(),
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
    const { imageUrl, ...rowFields } = row;
    batch.set(ref, {
      ...rowFields,
      nameNormalized: nameNormalized(row.name),
      supplierId: null,
      supplierName: '',
      imeiTracking: false,
      imeis: [],
      imageUrl: imageUrl ?? null,
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

/** Cartons and sets are released per store from the Feature Center; turning links off is always allowed. */
async function stockLinksEntitled(tenantId: string): Promise<boolean> {
  const [subscription, control, entitlement] = await Promise.all([
    db.doc(`subscriptions/${tenantId}`).get(),
    db.doc('platformFeatureControl/global').get(),
    db.doc(`platformFeatureEntitlements/${tenantId}__stock_links`).get(),
  ]);
  if (subscription.get('internalDemo') === true) return true;
  return control.get('killed') !== true && entitlement.get('status') === 'active';
}

const stockLinksSchema = z.object({
  productId: idField,
  /** Empty list turns the product back into an ordinary one (allowed only while its stock is 0). */
  links: z.array(z.object({ productId: idField, quantity: z.number().int().min(1).max(STOCK_LINK_QTY_MAX) })).max(STOCK_LINKS_MAX),
});

/**
 * Makes a product sell from other products' stock: a carton (one link: piece × 10) or a set
 * (several links). Validated here because Firestore rules cannot check the linked products;
 * clients cannot write `stockLinks` directly.
 */
export const posSetStockLinks = onCall(async (request) => {
  const input = parse(stockLinksSchema, request.data);
  const actor = await posActor(request, ['canEditProducts']);
  if (input.links.length > 0 && !(await stockLinksEntitled(actor.tenantId))) fail('permission-denied', 'error.featureNotActive');
  const p = tenantPaths(actor.tenantId);
  const ref = p.doc('products', input.productId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not-found', 'error.notFound');
    const self = toProduct(snap.id, snap.data()!);
    const targetSnaps = await Promise.all(input.links.map((l) => tx.get(p.doc('products', l.productId))));
    // A product that others already sell from cannot itself become a carton or set (one level only).
    const linkedBy = input.links.length ? await tx.get(p.col('products').where('stockLinkIds', 'array-contains', self.id).limit(1)) : null;
    const catalog = new Map<string, Product>();
    for (const t of targetSnaps) if (t.exists) catalog.set(t.id, toProduct(t.id, t.data()!));
    const issues = stockLinkIssues(self, input.links, catalog);
    if (linkedBy && !linkedBy.empty) issues.push('nested');
    // A carton that opens into pieces keeps its own stock: it cannot also be a set.
    if (input.links.length && self.packOf) issues.push('nested');
    if (issues.length) fail('failed-precondition', 'error.linkedInvalid', { name: self.name, issues: issues.join(',') });
    tx.update(ref, {
      stockLinks: input.links.length ? input.links : null,
      stockLinkIds: input.links.map((l) => l.productId),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return { ok: true };
});

const packOfSchema = z.object({
  productId: idField,
  /** null turns the carton back into an ordinary product. */
  packOf: z.object({ productId: idField, quantity: z.number().int().min(PACK_SIZE_MIN).max(PACK_SIZE_MAX) }).nullable(),
});

/** "This carton holds N of that piece." The carton keeps its own stock; see posOpenPack. */
export const posSetPackOf = onCall(async (request) => {
  const input = parse(packOfSchema, request.data);
  const actor = await posActor(request, ['canEditProducts']);
  if (input.packOf && !(await stockLinksEntitled(actor.tenantId))) fail('permission-denied', 'error.featureNotActive');
  const p = tenantPaths(actor.tenantId);
  const ref = p.doc('products', input.productId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not-found', 'error.notFound');
    const self = toProduct(snap.id, snap.data()!);
    if (input.packOf) {
      const targetSnap = await tx.get(p.doc('products', input.packOf.productId));
      const target = targetSnap.exists ? toProduct(targetSnap.id, targetSnap.data()!) : undefined;
      // A piece that is itself opened from another carton would make "open" ambiguous.
      const isPieceOfOther = await tx.get(p.col('products').where('packOfId', '==', self.id).limit(1));
      const issues = packIssues(self, input.packOf, target);
      if (!isPieceOfOther.empty) issues.push('selfKind');
      if (issues.length) fail('failed-precondition', 'error.packInvalid', { name: self.name, issues: issues.join(',') });
    }
    tx.update(ref, {
      packOf: input.packOf,
      packOfId: input.packOf?.productId ?? null,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return { ok: true };
});

const openPackSchema = z.object({
  clientOperationId: idField,
  productId: idField,
  count: z.number().int().min(1).max(10_000),
});

/**
 * Opens cartons at the shop: carton stock − count, piece stock + count × size, in one transaction,
 * with a "packOpen" movement on both products. A cashier can do it at the counter.
 */
export const posOpenPack = onCall(async (request) => {
  const input = parse(openPackSchema, request.data);
  return runClientOp(request, input.clientOperationId, 'posOpenPack', ['canEditProducts', 'canSell'], async (tx, actor) => {
    const p = tenantPaths(actor.tenantId);
    const atMs = Date.now();
    const cartonRef = p.doc('products', input.productId);
    const cartonSnap = await tx.get(cartonRef);
    if (!cartonSnap.exists) fail('not-found', 'error.notFound');
    const carton = toProduct(cartonSnap.id, cartonSnap.data()!);
    if (!carton.packOf) fail('failed-precondition', 'error.packInvalid', { name: carton.name, issues: 'notPack' });
    if (carton.status === 'archived') fail('failed-precondition', 'error.productArchived', { name: carton.name });
    const pieceRef = p.doc('products', carton.packOf.productId);
    const pieceSnap = await tx.get(pieceRef);
    if (!pieceSnap.exists) fail('not-found', 'error.productMissing', { name: carton.packOf.productId });
    const piece = toProduct(pieceSnap.id, pieceSnap.data()!);
    const plan = planOpenPack(carton, piece, input.count);
    if (!plan.ok) {
      if (plan.reason === 'insufficient') fail('failed-precondition', 'error.insufficientStock', { name: carton.name, available: carton.stock });
      fail('failed-precondition', 'error.packInvalid', { name: carton.name, issues: plan.reason });
    }
    const audit = auditFields(actor, atMs);
    const note = `${input.count} × ${carton.packOf.quantity}`;
    const cartonMove = p.newRef('stockMovements');
    const pieceMove = p.newRef('stockMovements');
    tx.update(cartonRef, { stock: plan.cartonStockAfter, lastMovementId: cartonMove.id, updatedAt: FieldValue.serverTimestamp() });
    tx.update(pieceRef, {
      stock: plan.pieceStockAfter,
      costUsdCents: plan.pieceCostAfter,
      lastMovementId: pieceMove.id,
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(cartonMove, { productId: carton.id, productName: carton.name, type: 'packOpen', quantity: -input.count, stockAfter: plan.cartonStockAfter, refId: piece.id, refNumber: null, note, ...audit });
    tx.set(pieceMove, { productId: piece.id, productName: piece.name, type: 'packOpen', quantity: plan.pieces, stockAfter: plan.pieceStockAfter, refId: carton.id, refNumber: null, note, ...audit });
    return { ok: true, pieces: plan.pieces, cartonStock: plan.cartonStockAfter, pieceStock: plan.pieceStockAfter };
  });
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
    // Options of one colour share their photo file: keep it while another option uses it.
    const sharing = product.imagePath && product.groupId ? await tx.get(p.col('products').where('imagePath', '==', product.imagePath).limit(2)) : null;
    tx.delete(ref);
    if (sharing?.docs.some((d) => d.id !== product.id)) return null;
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
  clientOperationId: idField,
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
  return runClientOp(
    request,
    input.clientOperationId,
    'posAdjustStock',
    ['canEditProducts'],
    async (tx, actor) => {
      const t = actor.tenantId;
      const p = tenantPaths(t);
      const atMs = Date.now();

    const ref = p.doc('products', input.productId);
    const [snap, cashSnap] = await Promise.all([tx.get(ref), input.payFromCashbox ? tx.get(p.cashbox) : Promise.resolve(null)]);
    if (!snap.exists) fail('not-found', 'error.notFound');
    const product = toProduct(snap.id, snap.data()!);
    assertOwnStock(product);

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
      return { ok: true, movementId: movementRef.id, stock: newStock };
    },
    (actor) => {
      if (input.payFromCashbox && !actor.can('canManageCashDrawer')) fail('permission-denied', 'error.permissionDenied');
    },
  );
});
