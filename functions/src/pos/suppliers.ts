import { FieldValue, type DocumentData } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db } from '../admin.js';
import { fail } from '../errors.js';
import { formatDocNumber } from '../shared/checkout.js';
import { weightedAverageCost } from '../shared/inventory.js';
import { lbpToUsdCents } from '../shared/money.js';
import type { Product, PurchaseReturn } from '../shared/models.js';
import { allocateSupplierPayment, billStatus } from '../shared/suppliers.js';
import { parse } from '../validate.js';
import {
  auditFields,
  cents,
  exchangeRateOf,
  idField,
  noteField,
  posActor,
  tenantPaths,
  toCashbox,
  toProduct,
  toPurchase,
} from './common.js';

const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const purchaseSchema = z.object({
  supplierId: idField,
  date: dateField,
  dueDate: dateField.nullable(),
  items: z
    .array(z.object({ productId: idField, quantity: z.number().int().min(1).max(1_000_000), unitCostUsdCents: cents }))
    .min(1)
    .max(300),
  updateCost: z.boolean(),
  paidNowUsdCents: cents,
  payFromCashbox: z.boolean(),
  note: z.string().trim().max(500).default(''),
});

/** Records a supplier bill: adds stock (optionally re-averaging cost) and the supplier balance. */
export const posCreatePurchase = onCall(async (request) => {
  const input = parse(purchaseSchema, request.data);
  const actor = await posActor(request, ['canViewSuppliers']);
  if (input.payFromCashbox && input.paidNowUsdCents > 0 && !actor.can('canManageCashDrawer')) {
    fail('permission-denied', 'error.permissionDenied');
  }
  const p = tenantPaths(actor.tenantId);
  const atMs = Date.now();

  const id = await db.runTransaction(async (tx) => {
    const ids = [...new Set(input.items.map((i) => i.productId))];
    const [supplierSnap, counterSnap, cashSnap, ...productSnaps] = await Promise.all([
      tx.get(p.doc('suppliers', input.supplierId)),
      tx.get(p.counter('purchases')),
      tx.get(p.cashbox),
      ...ids.map((pid) => tx.get(p.doc('products', pid))),
    ]);
    if (!supplierSnap.exists) fail('not-found', 'error.notFound');
    const supplier = { id: supplierSnap.id, name: String(supplierSnap.data()!.name ?? ''), balance: Number(supplierSnap.data()!.balanceUsdCents) || 0 };
    const products = new Map<string, Product>();
    for (const s of productSnaps) {
      if (!s.exists) fail('not-found', 'error.productMissing', { name: s.id });
      const product = toProduct(s.id, s.data()!);
      if (product.status === 'archived') fail('failed-precondition', 'error.productArchived', { name: product.name });
      products.set(s.id, product);
    }

    const total = input.items.reduce((s, i) => s + i.quantity * i.unitCostUsdCents, 0);
    const paidNow = Math.min(total, input.paidNowUsdCents);
    const cashbox = input.payFromCashbox ? toCashbox(cashSnap.data()) : null;
    if (cashbox && paidNow > cashbox.usdCents) fail('failed-precondition', 'error.drawerInsufficient');

    const counterNext = Number(counterSnap.data()?.nextId) || 1;
    const number = formatDocNumber('PU', counterNext);
    const audit = auditFields(actor, atMs);
    const purchaseRef = p.newRef('purchases');
    tx.set(p.counter('purchases'), { nextId: counterNext + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

    const running = new Map<string, { stock: number; cost: number }>();
    for (const prod of products.values()) running.set(prod.id, { stock: prod.stock, cost: prod.costUsdCents });
    const items = input.items.map((i) => {
      const r = running.get(i.productId)!;
      if (input.updateCost) r.cost = weightedAverageCost(r.stock, r.cost, i.quantity, i.unitCostUsdCents);
      r.stock += i.quantity;
      return { productId: i.productId, name: products.get(i.productId)!.name, quantity: i.quantity, unitCostUsdCents: i.unitCostUsdCents, returnedQty: 0 };
    });

    for (const [productId, r] of running) {
      const product = products.get(productId)!;
      const movementRef = p.newRef('stockMovements');
      const update: DocumentData = { stock: r.stock, lastMovementId: movementRef.id, updatedAt: FieldValue.serverTimestamp() };
      if (input.updateCost) update.costUsdCents = r.cost;
      tx.update(p.doc('products', productId), update);
      tx.set(movementRef, {
        productId,
        productName: product.name,
        type: 'purchase',
        quantity: r.stock - product.stock,
        stockAfter: r.stock,
        refId: purchaseRef.id,
        refNumber: number,
        note: supplier.name,
        ...audit,
      });
    }

    tx.set(purchaseRef, {
      number,
      supplierId: supplier.id,
      supplierName: supplier.name,
      date: input.date,
      dueDate: input.dueDate,
      items,
      productIds: ids,
      totalUsdCents: total,
      returnedUsdCents: 0,
      paidUsdCents: paidNow,
      remainingUsdCents: total - paidNow,
      status: billStatus(total, paidNow, 0),
      updateCost: input.updateCost,
      note: input.note,
      ...audit,
    });
    tx.update(p.doc('suppliers', supplier.id), { balanceUsdCents: supplier.balance + total - paidNow, updatedAt: FieldValue.serverTimestamp() });

    if (paidNow > 0) {
      const paymentRef = p.newRef('supplierPayments');
      tx.set(paymentRef, {
        supplierId: supplier.id,
        supplierName: supplier.name,
        currency: 'USD',
        amount: paidNow,
        amountUsdCents: paidNow,
        exchangeRate: 0,
        method: cashbox ? 'cash' : 'other',
        appliedTo: [{ purchaseId: purchaseRef.id, purchaseNumber: number, amountUsdCents: paidNow }],
        note: '',
        ...audit,
      });
      if (cashbox) {
        const cashRef = p.newRef('cashTransactions');
        const after = { usdCents: cashbox.usdCents - paidNow, lbp: cashbox.lbp };
        tx.set(cashRef, {
          type: 'supplierPayment',
          usdCents: -paidNow,
          lbp: 0,
          balanceAfter: after,
          category: 'supplierPayment',
          note: `${supplier.name} · ${number}`,
          refId: paymentRef.id,
          refNumber: number,
          ...audit,
        });
        tx.set(p.cashbox, { ...after, lastTxId: cashRef.id, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
    }
    return purchaseRef.id;
  });
  return { id };
});

const paySchema = z.object({
  supplierId: idField,
  currency: z.enum(['USD', 'LBP']),
  /** In the payment currency (cents for USD, pounds for LBP). */
  amount: z.number().int().positive().max(1_000_000_000_000),
  rate: z.number().int().positive(),
  method: z.enum(['cash', 'card', 'transfer', 'other']),
  note: noteField,
});

/** Pays a supplier: applied to open bills oldest first; cash payments come out of the drawer. */
export const posPaySupplier = onCall(async (request) => {
  const input = parse(paySchema, request.data);
  const actor = await posActor(request, ['canViewSuppliers']);
  if (input.method === 'cash' && !actor.can('canManageCashDrawer')) fail('permission-denied', 'error.permissionDenied');
  const p = tenantPaths(actor.tenantId);
  const atMs = Date.now();

  await db.runTransaction(async (tx) => {
    const supplierRef = p.doc('suppliers', input.supplierId);
    const [supplierSnap, cashSnap, settingsSnap, billsSnap] = await Promise.all([
      tx.get(supplierRef),
      tx.get(p.cashbox),
      tx.get(p.settings),
      tx.get(p.col('purchases').where('supplierId', '==', input.supplierId).where('remainingUsdCents', '>', 0).limit(200)),
    ]);
    if (!supplierSnap.exists) fail('not-found', 'error.notFound');
    const supplierName = String(supplierSnap.data()!.name ?? '');
    const balance = Number(supplierSnap.data()!.balanceUsdCents) || 0;
    const rate = exchangeRateOf(settingsSnap.data());
    if (input.currency === 'LBP' && rate !== input.rate) fail('failed-precondition', 'error.rateChanged');
    const amountUsdCents = input.currency === 'USD' ? input.amount : lbpToUsdCents(input.amount, rate);
    if (!(amountUsdCents > 0)) fail('invalid-argument', 'error.invalidAmount');

    const bills = billsSnap.docs.map((d) => toPurchase(d.id, d.data()));
    const result = allocateSupplierPayment(amountUsdCents, bills);
    if (!result.ok) {
      fail('failed-precondition', result.error === 'exceedsBalance' ? 'error.paymentExceedsBalance' : 'error.invalidAmount', {
        balance: (result.openUsdCents / 100).toFixed(2),
      });
    }
    const cashUsd = input.currency === 'USD' ? input.amount : 0;
    const cashLbp = input.currency === 'LBP' ? input.amount : 0;
    const cashbox = input.method === 'cash' ? toCashbox(cashSnap.data()) : null;
    if (cashbox && (cashUsd > cashbox.usdCents || cashLbp > cashbox.lbp)) fail('failed-precondition', 'error.drawerInsufficient');

    const audit = auditFields(actor, atMs);
    const paymentRef = p.newRef('supplierPayments');
    for (const a of result.allocations) {
      const bill = bills.find((b) => b.id === a.purchaseId)!;
      const paid = bill.paidUsdCents + a.amountUsdCents;
      tx.update(p.doc('purchases', bill.id), {
        paidUsdCents: paid,
        remainingUsdCents: bill.remainingUsdCents - a.amountUsdCents,
        status: billStatus(bill.totalUsdCents, paid, bill.returnedUsdCents),
      });
    }
    tx.set(paymentRef, {
      supplierId: input.supplierId,
      supplierName,
      currency: input.currency,
      amount: input.amount,
      amountUsdCents,
      exchangeRate: input.currency === 'LBP' ? rate : 0,
      method: input.method,
      appliedTo: result.allocations,
      note: input.note,
      ...audit,
    });
    tx.update(supplierRef, { balanceUsdCents: balance - amountUsdCents, updatedAt: FieldValue.serverTimestamp() });
    if (cashbox) {
      const cashRef = p.newRef('cashTransactions');
      const after = { usdCents: cashbox.usdCents - cashUsd, lbp: cashbox.lbp - cashLbp };
      tx.set(cashRef, {
        type: 'supplierPayment',
        usdCents: -cashUsd,
        lbp: -cashLbp,
        balanceAfter: after,
        category: 'supplierPayment',
        note: supplierName,
        refId: paymentRef.id,
        refNumber: null,
        ...audit,
      });
      tx.set(p.cashbox, { ...after, lastTxId: cashRef.id, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
  });
  return { ok: true };
});

const returnSchema = z.object({
  purchaseId: idField,
  lines: z.array(z.object({ index: z.number().int().min(0).max(299), quantity: z.number().int().min(0).max(1_000_000) })).min(1).max(300),
  note: noteField,
});

/**
 * Returns goods to a supplier: removes stock and reduces the bill's remaining amount; any value above
 * the remaining amount (bill already paid) is refunded by the supplier into the drawer.
 */
export const posReturnToSupplier = onCall(async (request) => {
  const input = parse(returnSchema, request.data);
  const actor = await posActor(request, ['canViewSuppliers']);
  const p = tenantPaths(actor.tenantId);
  const atMs = Date.now();

  await db.runTransaction(async (tx) => {
    const purchaseSnap = await tx.get(p.doc('purchases', input.purchaseId));
    if (!purchaseSnap.exists) fail('not-found', 'error.notFound');
    const purchase = toPurchase(purchaseSnap.id, purchaseSnap.data()!);
    const ids = [...new Set(purchase.items.map((i) => i.productId))];
    const [cashSnap, supplierSnap, ...productSnaps] = await Promise.all([
      tx.get(p.cashbox),
      tx.get(p.doc('suppliers', purchase.supplierId)),
      ...ids.map((pid) => tx.get(p.doc('products', pid))),
    ]);
    const cashbox = toCashbox(cashSnap.data());
    const products = new Map<string, Product>();
    for (const s of productSnaps) if (s.exists) products.set(s.id, toProduct(s.id, s.data()!));

    const qtyByIndex = new Map<number, number>();
    const perProduct = new Map<string, number>();
    const items: PurchaseReturn['items'] = [];
    let amount = 0;
    for (const line of input.lines) {
      if (!line.quantity) continue;
      const item = purchase.items[line.index];
      const already = qtyByIndex.get(line.index) ?? 0;
      if (!item || already + line.quantity > item.quantity - item.returnedQty) fail('failed-precondition', 'error.return.tooMany');
      qtyByIndex.set(line.index, already + line.quantity);
      perProduct.set(item.productId, (perProduct.get(item.productId) ?? 0) + line.quantity);
      items.push({ productId: item.productId, name: item.name, quantity: line.quantity, unitCostUsdCents: item.unitCostUsdCents });
      amount += line.quantity * item.unitCostUsdCents;
    }
    if (!items.length) fail('failed-precondition', 'error.return.empty');
    for (const [productId, qty] of perProduct) {
      const prod = products.get(productId);
      if (!prod || prod.stock < qty) fail('failed-precondition', 'error.insufficientStock', { name: prod?.name ?? productId, available: prod?.stock ?? 0 });
    }

    const reduceBill = Math.min(amount, purchase.remainingUsdCents);
    const cashRefund = amount - reduceBill;
    const audit = auditFields(actor, atMs);
    const returnRef = p.newRef('purchaseReturns');
    const returned = purchase.returnedUsdCents + amount;

    tx.set(returnRef, {
      purchaseId: purchase.id,
      purchaseNumber: purchase.number,
      supplierId: purchase.supplierId,
      supplierName: purchase.supplierName,
      items,
      productIds: [...perProduct.keys()],
      amountUsdCents: amount,
      note: input.note,
      ...audit,
    });
    tx.update(purchaseSnap.ref, {
      items: purchase.items.map((it, i) => ({ ...it, returnedQty: it.returnedQty + (qtyByIndex.get(i) ?? 0) })),
      returnedUsdCents: returned,
      remainingUsdCents: purchase.remainingUsdCents - reduceBill,
      status: billStatus(purchase.totalUsdCents, purchase.paidUsdCents, returned),
    });
    for (const [productId, qty] of perProduct) {
      const prod = products.get(productId)!;
      const movementRef = p.newRef('stockMovements');
      tx.update(p.doc('products', productId), { stock: prod.stock - qty, lastMovementId: movementRef.id, updatedAt: FieldValue.serverTimestamp() });
      tx.set(movementRef, {
        productId,
        productName: prod.name,
        type: 'purchaseReturn',
        quantity: -qty,
        stockAfter: prod.stock - qty,
        refId: returnRef.id,
        refNumber: purchase.number,
        note: purchase.supplierName,
        ...audit,
      });
    }
    if (reduceBill > 0 && supplierSnap.exists) {
      const balance = Number(supplierSnap.data()!.balanceUsdCents) || 0;
      tx.update(supplierSnap.ref, { balanceUsdCents: balance - reduceBill, updatedAt: FieldValue.serverTimestamp() });
    }
    if (cashRefund > 0) {
      const cashRef = p.newRef('cashTransactions');
      const after = { usdCents: cashbox.usdCents + cashRefund, lbp: cashbox.lbp };
      tx.set(cashRef, {
        type: 'deposit',
        usdCents: cashRefund,
        lbp: 0,
        balanceAfter: after,
        category: 'purchaseReturn',
        note: `${purchase.supplierName} · ${purchase.number}`,
        refId: returnRef.id,
        refNumber: purchase.number,
        ...audit,
      });
      tx.set(p.cashbox, { ...after, lastTxId: cashRef.id, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
  });
  return { ok: true };
});
