import {
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { lbpToUsdCents } from '@/domain/money';
import { emailKey, nameNormalized, phoneKey } from '@/domain/searchKey';
import { findByNormalizedName } from './catalogQuery';
import { PAGE_SIZE } from '@/constants/app';
import type { Customer, CustomerLedgerEntry } from '@/types/models';
import { paths, toCustomer, toLedgerEntry, type Actor } from './db';
import { newClientOperationId, retryOnTransport } from './clientOperation';
import { AppError } from './errors';
import { posApi } from './functionsClient';
import { auditFields, requireOnline } from './ops';
import type { Page } from './salesService';

export interface CustomerInput {
  name: string;
  phone: string;
  email: string;
  address: string;
  creditLimitUsdCents: number;
}

export interface CustomerDuplicate {
  id: string;
  name: string;
  /** Which stored value matched: the normalized name or the normalized phone. */
  match: 'name' | 'phone';
}

/**
 * Finds an existing customer with the same normalized name or phone. Never merges anything:
 * callers decide whether to refuse, or to offer the existing customer instead.
 */
export async function findCustomerDuplicate(tenantId: string, input: Pick<CustomerInput, 'name' | 'phone'>, selfId?: string): Promise<CustomerDuplicate | null> {
  const byName = await findByNormalizedName(tenantId, 'customers', input.name);
  if (byName && byName.id !== selfId) return { id: byName.id, name: byName.name, match: 'name' };
  const phone = phoneKey(input.phone);
  if (!phone) return null;
  const snap = await getDocs(query(paths.col(tenantId, 'customers'), where('phoneKey', '==', phone), limit(1)));
  const hit = snap.docs[0];
  if (hit && hit.id !== selfId) return { id: hit.id, name: String(hit.data().name ?? ''), match: 'phone' };
  return null;
}

export async function assertUniqueCustomer(tenantId: string, input: CustomerInput, selfId?: string): Promise<void> {
  const duplicate = await findCustomerDuplicate(tenantId, input, selfId);
  if (duplicate) throw new AppError('error.customerExists', { name: duplicate.name });
}

/** One customer by id (tenant-scoped path, same read rules as the customer list). */
export async function getCustomer(tenantId: string, id: string): Promise<Customer | null> {
  const snap = await getDoc(paths.doc(tenantId, 'customers', id));
  return snap.exists() ? toCustomer(snap.id, snap.data()) : null;
}

const fields = (input: CustomerInput) => ({
  name: input.name.trim(),
  nameNormalized: nameNormalized(input.name),
  phone: input.phone.trim(),
  phoneKey: phoneKey(input.phone),
  email: input.email.trim(),
  emailKey: emailKey(input.email),
  address: input.address.trim(),
  creditLimitUsdCents: Math.max(0, Math.round(input.creditLimitUsdCents)),
  updatedAt: serverTimestamp(),
});

/**
 * Creates a customer. With an opening debt the server writes the customer and its ledger entry
 * together; a debt-free customer is plain master data and may be created offline.
 */
export async function createCustomer(actor: Actor, input: CustomerInput, openingDebtUsdCents = 0): Promise<string> {
  const opening = Math.max(0, Math.round(openingDebtUsdCents));
  if (opening > 0) {
    requireOnline();
    const { updatedAt: _updatedAt, ...customer } = fields(input);
    const clientOperationId = newClientOperationId();
    const { id } = await retryOnTransport(() => posApi.createCustomer({ clientOperationId, customer, openingDebtUsdCents: opening }));
    return id;
  }
  const ref = doc(paths.col(actor.tenantId, 'customers'));
  const audit = auditFields(actor);
  const p = setDoc(ref, {
    ...fields(input),
    debtUsdCents: 0,
    totalPurchasesUsdCents: 0,
    lastLedgerId: null,
    createdAt: audit.createdAt,
    createdAtMs: audit.createdAtMs,
    createdBy: actor.uid,
  });
  if (navigator.onLine) await p;
  else p.catch((e) => console.error('[customerService] offline write rejected', e));
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

/** Receives a debt payment (server-side): reduces debt, writes the ledger and puts the money in the drawer. */
export async function payDebt(input: DebtPaymentInput): Promise<void> {
  requireOnline();
  const usdCents = Math.max(0, Math.round(input.usdCents));
  const lbp = Math.max(0, Math.round(input.lbp));
  if (usdCents + lbpToUsdCents(lbp, input.rate) <= 0) throw new AppError('error.invalidAmount');
  const clientOperationId = newClientOperationId();
  await retryOnTransport(() =>
    posApi.payDebt({
      clientOperationId,
      customerId: input.customerId,
      usdCents,
      lbp,
      rate: input.rate,
      note: input.note.trim().slice(0, 300),
    }),
  );
}

/** Owner-only manual correction of a customer's debt (always audited in the ledger). */
export async function adjustDebt(customerId: string, newDebtUsdCents: number, note: string): Promise<void> {
  requireOnline();
  const clientOperationId = newClientOperationId();
  await retryOnTransport(() =>
    posApi.adjustDebt({
      clientOperationId,
      customerId,
      newDebtUsdCents: Math.max(0, Math.round(newDebtUsdCents)),
      note: note.trim().slice(0, 300),
    }),
  );
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
