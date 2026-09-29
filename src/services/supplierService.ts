import {
  addDoc,
  deleteDoc,
  doc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  updateDoc,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { formatDocNumber } from '@/domain/checkout';
import { weightedAverageCost } from '@/domain/inventory';
import { lbpToUsdCents } from '@/domain/money';
import { allocateSupplierPayment, billStatus } from '@/domain/suppliers';
import { PAGE_SIZE } from '@/constants/app';
import type { Currency, PaymentMethod, Product, Purchase, PurchaseReturn, Supplier, SupplierPayment } from '@/types/models';
import {
  paths,
  toCashbox,
  toProduct,
  toPurchase,
  toPurchaseReturn,
  toSupplier,
  toSupplierPayment,
  type Actor,
} from './db';
import { AppError } from './errors';
import { auditFields, requireOnline, runTx } from './ops';
import type { Page } from './salesService';

/* -------------------------------------------------------------- suppliers */

export interface SupplierInput {
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
}

const supplierFields = (i: SupplierInput) => ({
  name: i.name.trim(),
  contactPerson: i.contactPerson.trim(),
  phone: i.phone.trim(),
  email: i.email.trim(),
  address: i.address.trim(),
  updatedAt: serverTimestamp(),
});

export async function createSupplier(actor: Actor, input: SupplierInput, suppliers: Supplier[]): Promise<string> {
  if (suppliers.some((s) => s.name.trim().toLowerCase() === input.name.trim().toLowerCase())) {
    throw new AppError('error.supplierExists');
  }
  const audit = auditFields(actor);
  const ref = await addDoc(paths.col(actor.tenantId, 'suppliers'), {
    ...supplierFields(input),
    balanceUsdCents: 0,
    createdAt: audit.createdAt,
    createdAtMs: audit.createdAtMs,
    createdBy: actor.uid,
  });
  return ref.id;
}

export async function updateSupplier(actor: Actor, id: string, input: SupplierInput): Promise<void> {
  await updateDoc(paths.doc(actor.tenantId, 'suppliers', id), supplierFields(input));
}

export async function deleteSupplier(actor: Actor, supplier: Supplier): Promise<void> {
  if (supplier.balanceUsdCents !== 0) throw new AppError('error.supplierHasBalance');
  await deleteDoc(paths.doc(actor.tenantId, 'suppliers', supplier.id));
}

/* -------------------------------------------------------------- purchases */

export interface PurchaseInput {
  supplierId: string;
  date: string;
  dueDate: string | null;
  items: { productId: string; quantity: number; unitCostUsdCents: number }[];
  updateCost: boolean;
  paidNowUsdCents: number;
  payFromCashbox: boolean;
  note: string;
}

/** Records a supplier bill: adds stock (optionally re-averaging cost) and the supplier balance. */
export async function createPurchase(actor: Actor, input: PurchaseInput): Promise<string> {
  requireOnline();
  const t = actor.tenantId;
  if (!input.items.length) throw new AppError('error.purchaseEmpty');
  for (const i of input.items) {
    if (!Number.isInteger(i.quantity) || i.quantity <= 0 || i.unitCostUsdCents < 0) throw new AppError('error.invalidQuantity');
  }

  return runTx(async (tx) => {
    const supplierSnap = await tx.get(paths.doc(t, 'suppliers', input.supplierId));
    if (!supplierSnap.exists()) throw new AppError('error.notFound');
    const supplier = toSupplier(supplierSnap.id, supplierSnap.data());
    const counterSnap = await tx.get(paths.counter(t, 'purchases'));
    const ids = [...new Set(input.items.map((i) => i.productId))];
    const productSnaps = await Promise.all(ids.map((id) => tx.get(paths.doc(t, 'products', id))));
    const cashbox = input.payFromCashbox ? toCashbox((await tx.get(paths.cashbox(t))).data()) : null;

    const products = new Map<string, Product>();
    for (const s of productSnaps) {
      if (!s.exists()) throw new AppError('error.productMissing', { name: s.id });
      products.set(s.id, toProduct(s.id, s.data()));
    }

    const total = input.items.reduce((s, i) => s + i.quantity * Math.round(i.unitCostUsdCents), 0);
    const paidNow = Math.max(0, Math.min(total, Math.round(input.paidNowUsdCents)));
    if (cashbox && paidNow > cashbox.usdCents) throw new AppError('error.drawerInsufficient');

    const counterNext = Number(counterSnap.data()?.nextId) || 1;
    const number = formatDocNumber('PU', counterNext);
    const audit = auditFields(actor);
    const purchaseRef = doc(paths.col(t, 'purchases'));

    tx.set(paths.counter(t, 'purchases'), { nextId: counterNext + 1, updatedAt: serverTimestamp() }, { merge: true });

    const running = new Map<string, { stock: number; cost: number }>();
    for (const p of products.values()) running.set(p.id, { stock: p.stock, cost: p.costUsdCents });
    const items = input.items.map((i) => {
      const product = products.get(i.productId)!;
      const r = running.get(i.productId)!;
      const unitCost = Math.round(i.unitCostUsdCents);
      if (input.updateCost) r.cost = weightedAverageCost(r.stock, r.cost, i.quantity, unitCost);
      r.stock += i.quantity;
      return { productId: i.productId, name: product.name, quantity: i.quantity, unitCostUsdCents: unitCost, returnedQty: 0 };
    });

    for (const [productId, r] of running) {
      const product = products.get(productId)!;
      const qty = r.stock - product.stock;
      const movementRef = doc(paths.col(t, 'stockMovements'));
      const update: DocumentData = { stock: increment(qty), lastMovementId: movementRef.id, updatedAt: serverTimestamp() };
      if (input.updateCost) update.costUsdCents = r.cost;
      tx.update(paths.doc(t, 'products', productId), update);
      tx.set(movementRef, {
        productId,
        productName: product.name,
        type: 'purchase',
        quantity: qty,
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
      totalUsdCents: total,
      returnedUsdCents: 0,
      paidUsdCents: paidNow,
      remainingUsdCents: total - paidNow,
      status: billStatus(total, paidNow, 0),
      updateCost: input.updateCost,
      note: input.note.trim().slice(0, 500),
      ...audit,
    });
    tx.update(paths.doc(t, 'suppliers', supplier.id), {
      balanceUsdCents: increment(total - paidNow),
      updatedAt: serverTimestamp(),
    });

    if (paidNow > 0) {
      const paymentRef = doc(paths.col(t, 'supplierPayments'));
      tx.set(paymentRef, {
        supplierId: supplier.id,
        supplierName: supplier.name,
        currency: 'USD',
        amount: paidNow,
        amountUsdCents: paidNow,
        exchangeRate: 0,
        method: input.payFromCashbox ? 'cash' : 'other',
        appliedTo: [{ purchaseId: purchaseRef.id, purchaseNumber: number, amountUsdCents: paidNow }],
        note: '',
        ...audit,
      });
      if (cashbox) {
        const cashRef = doc(paths.col(t, 'cashTransactions'));
        tx.set(cashRef, {
          type: 'supplierPayment',
          usdCents: -paidNow,
          lbp: 0,
          balanceAfter: { usdCents: cashbox.usdCents - paidNow, lbp: cashbox.lbp },
          category: 'supplierPayment',
          note: `${supplier.name} · ${number}`,
          refId: paymentRef.id,
          refNumber: number,
          ...audit,
        });
        tx.set(paths.cashbox(t), { usdCents: increment(-paidNow), lastTxId: cashRef.id, updatedAt: serverTimestamp() }, { merge: true });
      }
    }
    return purchaseRef.id;
  });
}

export interface SupplierPaymentInput {
  supplierId: string;
  currency: Currency;
  /** In the payment currency (cents for USD, pounds for LBP). */
  amount: number;
  rate: number;
  method: PaymentMethod;
  note: string;
}

/** Pays a supplier: applied to open bills oldest first; cash payments come out of the drawer. */
export async function paySupplier(actor: Actor, input: SupplierPaymentInput): Promise<void> {
  requireOnline();
  const t = actor.tenantId;
  const amount = Math.round(input.amount);
  const amountUsdCents = input.currency === 'USD' ? amount : lbpToUsdCents(amount, input.rate);
  if (!(amountUsdCents > 0)) throw new AppError('error.invalidAmount');

  const openSnap = await getDocs(
    query(paths.col(t, 'purchases'), where('supplierId', '==', input.supplierId), where('remainingUsdCents', '>', 0), limit(200)),
  );
  const billRefs = openSnap.docs.map((d) => d.ref);

  await runTx(async (tx) => {
    const supplierSnap = await tx.get(paths.doc(t, 'suppliers', input.supplierId));
    if (!supplierSnap.exists()) throw new AppError('error.notFound');
    const supplier = toSupplier(supplierSnap.id, supplierSnap.data());
    const billSnaps = await Promise.all(billRefs.map((r) => tx.get(r)));
    const cashbox = input.method === 'cash' ? toCashbox((await tx.get(paths.cashbox(t))).data()) : null;

    const bills = billSnaps.filter((s) => s.exists()).map((s) => toPurchase(s.id, s.data()!));
    const result = allocateSupplierPayment(amountUsdCents, bills);
    if (!result.ok) {
      throw new AppError(result.error === 'exceedsBalance' ? 'error.paymentExceedsBalance' : 'error.invalidAmount', {
        balance: (result.openUsdCents / 100).toFixed(2),
      });
    }
    const cashUsd = input.currency === 'USD' ? amount : 0;
    const cashLbp = input.currency === 'LBP' ? amount : 0;
    if (cashbox && (cashUsd > cashbox.usdCents || cashLbp > cashbox.lbp)) throw new AppError('error.drawerInsufficient');

    const audit = auditFields(actor);
    const paymentRef = doc(paths.col(t, 'supplierPayments'));
    for (const a of result.allocations) {
      const bill = bills.find((b) => b.id === a.purchaseId)!;
      const paid = bill.paidUsdCents + a.amountUsdCents;
      tx.update(paths.doc(t, 'purchases', bill.id), {
        paidUsdCents: paid,
        remainingUsdCents: bill.remainingUsdCents - a.amountUsdCents,
        status: billStatus(bill.totalUsdCents, paid, bill.returnedUsdCents),
      });
    }
    tx.set(paymentRef, {
      supplierId: supplier.id,
      supplierName: supplier.name,
      currency: input.currency,
      amount,
      amountUsdCents,
      exchangeRate: input.rate,
      method: input.method,
      appliedTo: result.allocations,
      note: input.note.trim().slice(0, 300),
      ...audit,
    });
    tx.update(paths.doc(t, 'suppliers', supplier.id), { balanceUsdCents: increment(-amountUsdCents), updatedAt: serverTimestamp() });
    if (cashbox) {
      const cashRef = doc(paths.col(t, 'cashTransactions'));
      tx.set(cashRef, {
        type: 'supplierPayment',
        usdCents: -cashUsd,
        lbp: -cashLbp,
        balanceAfter: { usdCents: cashbox.usdCents - cashUsd, lbp: cashbox.lbp - cashLbp },
        category: 'supplierPayment',
        note: supplier.name,
        refId: paymentRef.id,
        refNumber: null,
        ...audit,
      });
      tx.set(
        paths.cashbox(t),
        { usdCents: increment(-cashUsd), lbp: increment(-cashLbp), lastTxId: cashRef.id, updatedAt: serverTimestamp() },
        { merge: true },
      );
    }
  });
}

export interface PurchaseReturnInput {
  purchaseId: string;
  lines: { index: number; quantity: number }[];
  note: string;
}

/**
 * Returns goods to a supplier: removes stock, reduces the bill's remaining amount; any value above
 * the remaining amount (bill already paid) is refunded by the supplier into the drawer.
 */
export async function returnToSupplier(actor: Actor, input: PurchaseReturnInput): Promise<void> {
  requireOnline();
  const t = actor.tenantId;
  await runTx(async (tx) => {
    const purchaseSnap = await tx.get(paths.doc(t, 'purchases', input.purchaseId));
    if (!purchaseSnap.exists()) throw new AppError('error.notFound');
    const purchase = toPurchase(purchaseSnap.id, purchaseSnap.data());
    const ids = [...new Set(purchase.items.map((i) => i.productId))];
    const productSnaps = await Promise.all(ids.map((id) => tx.get(paths.doc(t, 'products', id))));
    const cashbox = toCashbox((await tx.get(paths.cashbox(t))).data());
    const products = new Map<string, Product>();
    for (const s of productSnaps) if (s.exists()) products.set(s.id, toProduct(s.id, s.data()));

    const qtyByIndex = new Map<number, number>();
    const perProduct = new Map<string, number>();
    const items: PurchaseReturn['items'] = [];
    let amount = 0;
    for (const line of input.lines) {
      const qty = Math.floor(line.quantity);
      if (!qty) continue;
      const item = purchase.items[line.index];
      if (!item || qty < 0 || qty > item.quantity - item.returnedQty) throw new AppError('error.return.tooMany');
      qtyByIndex.set(line.index, qty);
      perProduct.set(item.productId, (perProduct.get(item.productId) ?? 0) + qty);
      items.push({ productId: item.productId, name: item.name, quantity: qty, unitCostUsdCents: item.unitCostUsdCents });
      amount += qty * item.unitCostUsdCents;
    }
    if (!items.length) throw new AppError('error.return.empty');
    for (const [productId, qty] of perProduct) {
      const p = products.get(productId);
      if (!p || p.stock < qty) throw new AppError('error.insufficientStock', { name: p?.name ?? productId, available: p?.stock ?? 0 });
    }

    const reduceBill = Math.min(amount, purchase.remainingUsdCents);
    const cashRefund = amount - reduceBill;
    const audit = auditFields(actor);
    const returnRef = doc(paths.col(t, 'purchaseReturns'));
    const returned = purchase.returnedUsdCents + amount;

    tx.set(returnRef, {
      purchaseId: purchase.id,
      purchaseNumber: purchase.number,
      supplierId: purchase.supplierId,
      supplierName: purchase.supplierName,
      items,
      amountUsdCents: amount,
      note: input.note.trim().slice(0, 300),
      ...audit,
    });
    tx.update(paths.doc(t, 'purchases', purchase.id), {
      items: purchase.items.map((it, i) => ({ ...it, returnedQty: it.returnedQty + (qtyByIndex.get(i) ?? 0) })),
      returnedUsdCents: returned,
      remainingUsdCents: purchase.remainingUsdCents - reduceBill,
      status: billStatus(purchase.totalUsdCents, purchase.paidUsdCents, returned),
    });
    for (const [productId, qty] of perProduct) {
      const p = products.get(productId)!;
      const movementRef = doc(paths.col(t, 'stockMovements'));
      tx.update(paths.doc(t, 'products', productId), { stock: increment(-qty), lastMovementId: movementRef.id, updatedAt: serverTimestamp() });
      tx.set(movementRef, {
        productId,
        productName: p.name,
        type: 'purchaseReturn',
        quantity: -qty,
        stockAfter: p.stock - qty,
        refId: returnRef.id,
        refNumber: purchase.number,
        note: purchase.supplierName,
        ...audit,
      });
    }
    if (reduceBill > 0) {
      tx.update(paths.doc(t, 'suppliers', purchase.supplierId), { balanceUsdCents: increment(-reduceBill), updatedAt: serverTimestamp() });
    }
    if (cashRefund > 0) {
      const cashRef = doc(paths.col(t, 'cashTransactions'));
      tx.set(cashRef, {
        type: 'deposit',
        usdCents: cashRefund,
        lbp: 0,
        balanceAfter: { usdCents: cashbox.usdCents + cashRefund, lbp: cashbox.lbp },
        category: 'purchaseReturn',
        note: `${purchase.supplierName} · ${purchase.number}`,
        refId: returnRef.id,
        refNumber: purchase.number,
        ...audit,
      });
      tx.set(paths.cashbox(t), { usdCents: increment(cashRefund), lastTxId: cashRef.id, updatedAt: serverTimestamp() }, { merge: true });
    }
  });
}

/* ---------------------------------------------------------------- queries */

export async function listPurchases(
  tenantId: string,
  filter: { supplierId?: string | null; status?: Purchase['status'] | 'all' },
  cursor: QueryDocumentSnapshot | null,
): Promise<Page<Purchase>> {
  const c = [];
  if (filter.supplierId) c.push(where('supplierId', '==', filter.supplierId));
  if (filter.status && filter.status !== 'all') c.push(where('status', '==', filter.status));
  const snap = await getDocs(
    query(paths.col(tenantId, 'purchases'), ...c, orderBy('createdAtMs', 'desc'), ...(cursor ? [startAfter(cursor)] : []), limit(PAGE_SIZE)),
  );
  return {
    items: snap.docs.map((d) => toPurchase(d.id, d.data())),
    cursor: snap.docs[snap.docs.length - 1] ?? null,
    hasMore: snap.docs.length === PAGE_SIZE,
  };
}

export async function listSupplierPayments(tenantId: string, supplierId: string): Promise<SupplierPayment[]> {
  const snap = await getDocs(
    query(paths.col(tenantId, 'supplierPayments'), where('supplierId', '==', supplierId), orderBy('createdAtMs', 'desc'), limit(200)),
  );
  return snap.docs.map((d) => toSupplierPayment(d.id, d.data()));
}

export async function listPurchaseReturns(tenantId: string, supplierId: string): Promise<PurchaseReturn[]> {
  const snap = await getDocs(
    query(paths.col(tenantId, 'purchaseReturns'), where('supplierId', '==', supplierId), orderBy('createdAtMs', 'desc'), limit(200)),
  );
  return snap.docs.map((d) => toPurchaseReturn(d.id, d.data()));
}
