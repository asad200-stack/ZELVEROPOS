import {
  addDoc,
  deleteDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  updateDoc,
  where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { PAGE_SIZE } from '@/constants/app';
import type { Currency, PaymentMethod, Purchase, PurchaseReturn, Supplier, SupplierPayment } from '@/types/models';
import { paths, toPurchase, toPurchaseReturn, toSupplierPayment, type Actor } from './db';
import { AppError } from './errors';
import { posApi } from './functionsClient';
import { auditFields, requireOnline } from './ops';
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

/** Records a supplier bill server-side: adds stock (optionally re-averaging cost) and the supplier balance. */
export async function createPurchase(input: PurchaseInput): Promise<string> {
  requireOnline();
  if (!input.items.length) throw new AppError('error.purchaseEmpty');
  for (const i of input.items) {
    if (!Number.isInteger(i.quantity) || i.quantity <= 0 || i.unitCostUsdCents < 0) throw new AppError('error.invalidQuantity');
  }
  const { id } = await posApi.createPurchase({
    ...input,
    items: input.items.map((i) => ({ ...i, unitCostUsdCents: Math.round(i.unitCostUsdCents) })),
    paidNowUsdCents: Math.max(0, Math.round(input.paidNowUsdCents)),
    note: input.note.trim().slice(0, 500),
  });
  return id;
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

/** Pays a supplier server-side: applied to open bills oldest first; cash payments come out of the drawer. */
export async function paySupplier(input: SupplierPaymentInput): Promise<void> {
  requireOnline();
  const amount = Math.round(input.amount);
  if (!(amount > 0)) throw new AppError('error.invalidAmount');
  await posApi.paySupplier({ ...input, amount, note: input.note.trim().slice(0, 300) });
}

export interface PurchaseReturnInput {
  purchaseId: string;
  lines: { index: number; quantity: number }[];
  note: string;
}

/**
 * Returns goods to a supplier (server-side): removes stock, reduces the bill's remaining amount; any
 * value above the remaining amount (bill already paid) is refunded by the supplier into the drawer.
 */
export async function returnToSupplier(input: PurchaseReturnInput): Promise<void> {
  requireOnline();
  const lines = input.lines.map((l) => ({ index: l.index, quantity: Math.floor(l.quantity) })).filter((l) => l.quantity > 0);
  if (!lines.length) throw new AppError('error.return.empty');
  await posApi.returnToSupplier({ purchaseId: input.purchaseId, lines, note: input.note.trim().slice(0, 300) });
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
