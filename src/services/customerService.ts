import {
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
  writeBatch,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { firebase } from '@/firebase/app';
import { lbpToUsdCents } from '@/domain/money';
import { PAGE_SIZE } from '@/constants/app';
import type { Customer, CustomerLedgerEntry } from '@/types/models';
import { paths, toCashbox, toCustomer, toLedgerEntry, type Actor } from './db';
import { AppError } from './errors';
import { auditFields, requireOnline, runTx } from './ops';
import type { Page } from './salesService';

export interface CustomerInput {
  name: string;
  phone: string;
  email: string;
  address: string;
  creditLimitUsdCents: number;
}

export function assertUniqueCustomer(input: CustomerInput, customers: Customer[], selfId?: string): void {
  const name = input.name.trim().toLowerCase();
  const phone = input.phone.replace(/\D/g, '');
  const dup = customers.find(
    (c) => c.id !== selfId && (c.name.trim().toLowerCase() === name || (!!phone && c.phone.replace(/\D/g, '') === phone)),
  );
  if (dup) throw new AppError('error.customerExists', { name: dup.name });
}

const fields = (input: CustomerInput) => ({
  name: input.name.trim(),
  phone: input.phone.trim(),
  email: input.email.trim(),
  address: input.address.trim(),
  creditLimitUsdCents: Math.max(0, Math.round(input.creditLimitUsdCents)),
  updatedAt: serverTimestamp(),
});

export async function createCustomer(actor: Actor, input: CustomerInput, openingDebtUsdCents = 0): Promise<string> {
  const t = actor.tenantId;
  const ref = doc(paths.col(t, 'customers'));
  const audit = auditFields(actor);
  const batch = writeBatch(firebase.db);
  let lastLedgerId: string | null = null;
  const opening = Math.max(0, Math.round(openingDebtUsdCents));
  if (opening > 0) {
    const ledgerRef = doc(paths.col(t, 'customerLedger'));
    lastLedgerId = ledgerRef.id;
    batch.set(ledgerRef, {
      customerId: ref.id,
      customerName: input.name.trim(),
      type: 'opening',
      amountUsdCents: opening,
      balanceAfterUsdCents: opening,
      paidUsdCents: 0,
      paidLbp: 0,
      refId: null,
      refNumber: null,
      note: '',
      ...audit,
    });
  }
  batch.set(ref, {
    ...fields(input),
    debtUsdCents: opening,
    totalPurchasesUsdCents: 0,
    lastLedgerId,
    createdAt: audit.createdAt,
    createdAtMs: audit.createdAtMs,
    createdBy: actor.uid,
  });
  if (navigator.onLine) await batch.commit();
  else batch.commit().catch((e) => console.error('[customerService] offline write rejected', e));
  return ref.id;
}

export async function updateCustomer(actor: Actor, id: string, input: CustomerInput): Promise<void> {
  const p = updateDoc(paths.doc(actor.tenantId, 'customers', id), fields(input));
  if (navigator.onLine) await p;
  else p.catch((e) => console.error('[customerService] offline write rejected', e));
}

export async function deleteCustomer(actor: Actor, customer: Customer): Promise<void> {
  if (customer.debtUsdCents !== 0) throw new AppError('error.customerHasDebt');
  await deleteDoc(paths.doc(actor.tenantId, 'customers', customer.id));
}

export interface DebtPaymentInput {
  customerId: string;
  usdCents: number;
  lbp: number;
  rate: number;
  note: string;
}

/** Receives a debt payment: reduces debt, writes the ledger and puts the money in the drawer. */
export async function payDebt(actor: Actor, input: DebtPaymentInput): Promise<void> {
  requireOnline();
  const t = actor.tenantId;
  const usd = Math.max(0, Math.round(input.usdCents));
  const lbp = Math.max(0, Math.round(input.lbp));
  const amount = usd + lbpToUsdCents(lbp, input.rate);
  if (amount <= 0) throw new AppError('error.invalidAmount');

  await runTx(async (tx) => {
    const ref = paths.doc(t, 'customers', input.customerId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new AppError('error.notFound');
    const customer = toCustomer(snap.id, snap.data());
    const cashbox = toCashbox((await tx.get(paths.cashbox(t))).data());
    if (amount > customer.debtUsdCents + 1) {
      throw new AppError('error.paymentExceedsDebt', { debt: (customer.debtUsdCents / 100).toFixed(2) });
    }
    const applied = Math.min(amount, customer.debtUsdCents);
    const audit = auditFields(actor);
    const ledgerRef = doc(paths.col(t, 'customerLedger'));
    const cashRef = doc(paths.col(t, 'cashTransactions'));

    tx.set(ledgerRef, {
      customerId: customer.id,
      customerName: customer.name,
      type: 'payment',
      amountUsdCents: -applied,
      balanceAfterUsdCents: customer.debtUsdCents - applied,
      paidUsdCents: usd,
      paidLbp: lbp,
      refId: cashRef.id,
      refNumber: null,
      note: input.note.trim().slice(0, 300),
      ...audit,
    });
    tx.update(ref, { debtUsdCents: increment(-applied), lastLedgerId: ledgerRef.id, updatedAt: serverTimestamp() });
    tx.set(cashRef, {
      type: 'debtPayment',
      usdCents: usd,
      lbp,
      balanceAfter: { usdCents: cashbox.usdCents + usd, lbp: cashbox.lbp + lbp },
      category: 'debtPayment',
      note: customer.name,
      refId: customer.id,
      refNumber: null,
      ...audit,
    });
    tx.set(paths.cashbox(t), { usdCents: increment(usd), lbp: increment(lbp), lastTxId: cashRef.id, updatedAt: serverTimestamp() }, { merge: true });
    tx.set(
      paths.doc(t, 'dailyStats', audit.localDate),
      { date: audit.localDate, debtCollectedUsdCents: increment(applied), updatedAt: serverTimestamp() },
      { merge: true },
    );
  });
}

/** Owner-only manual correction of a customer's debt (always audited in the ledger). */
export async function adjustDebt(actor: Actor, customerId: string, newDebtUsdCents: number, note: string): Promise<void> {
  requireOnline();
  const t = actor.tenantId;
  await runTx(async (tx) => {
    const ref = paths.doc(t, 'customers', customerId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new AppError('error.notFound');
    const customer = toCustomer(snap.id, snap.data());
    const target = Math.max(0, Math.round(newDebtUsdCents));
    const delta = target - customer.debtUsdCents;
    if (delta === 0) throw new AppError('error.noChange');
    const ledgerRef = doc(paths.col(t, 'customerLedger'));
    tx.set(ledgerRef, {
      customerId: customer.id,
      customerName: customer.name,
      type: 'adjustment',
      amountUsdCents: delta,
      balanceAfterUsdCents: target,
      paidUsdCents: 0,
      paidLbp: 0,
      refId: null,
      refNumber: null,
      note: note.trim().slice(0, 300),
      ...auditFields(actor),
    });
    tx.update(ref, { debtUsdCents: target, lastLedgerId: ledgerRef.id, updatedAt: serverTimestamp() });
  });
}

export async function listLedger(
  tenantId: string,
  customerId: string,
  cursor: QueryDocumentSnapshot | null,
): Promise<Page<CustomerLedgerEntry>> {
  const snap = await getDocs(
    query(
      paths.col(tenantId, 'customerLedger'),
      where('customerId', '==', customerId),
      orderBy('createdAtMs', 'desc'),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(PAGE_SIZE),
    ),
  );
  return {
    items: snap.docs.map((d) => toLedgerEntry(d.id, d.data())),
    cursor: snap.docs[snap.docs.length - 1] ?? null,
    hasMore: snap.docs.length === PAGE_SIZE,
  };
}
