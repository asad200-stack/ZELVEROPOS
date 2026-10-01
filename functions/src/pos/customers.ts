import { FieldValue } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db } from '../admin.js';
import { fail } from '../errors.js';
import { lbpToUsdCents } from '../shared/money.js';
import { parse } from '../validate.js';
import {
  auditFields,
  bumpDailyStats,
  cents,
  exchangeRateOf,
  idField,
  lbpField,
  noteField,
  posActor,
  tenantPaths,
  toCashbox,
  toCustomer,
} from './common.js';

const createSchema = z.object({
  customer: z.object({
    name: z.string().trim().min(1).max(150),
    phone: z.string().trim().max(40),
    email: z.string().trim().max(200),
    address: z.string().trim().max(300),
    creditLimitUsdCents: cents,
  }),
  openingDebtUsdCents: cents.refine((v) => v > 0),
});

/** Creates a customer with an opening debt (recorded in the ledger). Debt-free customers are created client-side. */
export const posCreateCustomer = onCall(async (request) => {
  const input = parse(createSchema, request.data);
  const actor = await posActor(request, ['canViewCustomers']);
  const p = tenantPaths(actor.tenantId);
  const atMs = Date.now();
  const audit = auditFields(actor, atMs);
  const ref = p.newRef('customers');
  const ledgerRef = p.newRef('customerLedger');
  const batch = db.batch();
  batch.set(ledgerRef, {
    customerId: ref.id,
    customerName: input.customer.name,
    type: 'opening',
    amountUsdCents: input.openingDebtUsdCents,
    balanceAfterUsdCents: input.openingDebtUsdCents,
    paidUsdCents: 0,
    paidLbp: 0,
    refId: null,
    refNumber: null,
    note: '',
    ...audit,
  });
  batch.set(ref, {
    ...input.customer,
    debtUsdCents: input.openingDebtUsdCents,
    totalPurchasesUsdCents: 0,
    lastLedgerId: ledgerRef.id,
    createdAt: audit.createdAt,
    createdAtMs: atMs,
    createdBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  return { id: ref.id };
});

const payDebtSchema = z.object({
  customerId: idField,
  usdCents: cents,
  lbp: lbpField,
  rate: z.number().int().positive(),
  note: noteField,
});

/** Receives a debt payment: reduces the debt, writes the ledger and puts the money in the drawer. */
export const posPayDebt = onCall(async (request) => {
  const input = parse(payDebtSchema, request.data);
  const actor = await posActor(request, ['canViewCustomers']);
  const t = actor.tenantId;
  const p = tenantPaths(t);
  const atMs = Date.now();

  await db.runTransaction(async (tx) => {
    const ref = p.doc('customers', input.customerId);
    const [snap, cashSnap, settingsSnap] = await Promise.all([tx.get(ref), tx.get(p.cashbox), tx.get(p.settings)]);
    if (!snap.exists) fail('not-found', 'error.notFound');
    const rate = exchangeRateOf(settingsSnap.data());
    if (rate !== input.rate) fail('failed-precondition', 'error.rateChanged');
    const amount = input.usdCents + lbpToUsdCents(input.lbp, rate);
    if (amount <= 0) fail('invalid-argument', 'error.invalidAmount');
    const customer = toCustomer(snap.id, snap.data()!);
    if (amount > customer.debtUsdCents + 1) {
      fail('failed-precondition', 'error.paymentExceedsDebt', { debt: (customer.debtUsdCents / 100).toFixed(2) });
    }
    const applied = Math.min(amount, customer.debtUsdCents);
    const cashbox = toCashbox(cashSnap.data());
    const audit = auditFields(actor, atMs);
    const ledgerRef = p.newRef('customerLedger');
    const cashRef = p.newRef('cashTransactions');
    const after = { usdCents: cashbox.usdCents + input.usdCents, lbp: cashbox.lbp + input.lbp };

    tx.set(ledgerRef, {
      customerId: customer.id,
      customerName: customer.name,
      type: 'payment',
      amountUsdCents: -applied,
      balanceAfterUsdCents: customer.debtUsdCents - applied,
      paidUsdCents: input.usdCents,
      paidLbp: input.lbp,
      refId: cashRef.id,
      refNumber: null,
      note: input.note,
      ...audit,
    });
    tx.update(ref, { debtUsdCents: customer.debtUsdCents - applied, lastLedgerId: ledgerRef.id, updatedAt: FieldValue.serverTimestamp() });
    tx.set(cashRef, {
      type: 'debtPayment',
      usdCents: input.usdCents,
      lbp: input.lbp,
      balanceAfter: after,
      category: 'debtPayment',
      note: customer.name,
      refId: customer.id,
      refNumber: ledgerRef.id,
      ...audit,
    });
    tx.set(p.cashbox, { ...after, lastTxId: cashRef.id, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    bumpDailyStats(tx, t, audit.localDate, { debtCollectedUsdCents: applied });
  });
  return { ok: true };
});

const adjustDebtSchema = z.object({
  customerId: idField,
  newDebtUsdCents: cents,
  note: noteField,
});

/** Owner-only manual correction of a customer's debt (always audited in the ledger). */
export const posAdjustDebt = onCall(async (request) => {
  const input = parse(adjustDebtSchema, request.data);
  const actor = await posActor(request, []);
  if (!actor.isOwner) fail('permission-denied', 'error.fn.notOwner');
  const p = tenantPaths(actor.tenantId);
  const atMs = Date.now();

  await db.runTransaction(async (tx) => {
    const ref = p.doc('customers', input.customerId);
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not-found', 'error.notFound');
    const customer = toCustomer(snap.id, snap.data()!);
    const delta = input.newDebtUsdCents - customer.debtUsdCents;
    if (delta === 0) fail('failed-precondition', 'error.noChange');
    const ledgerRef = p.newRef('customerLedger');
    tx.set(ledgerRef, {
      customerId: customer.id,
      customerName: customer.name,
      type: 'adjustment',
      amountUsdCents: delta,
      balanceAfterUsdCents: input.newDebtUsdCents,
      paidUsdCents: 0,
      paidLbp: 0,
      refId: null,
      refNumber: null,
      note: input.note,
      ...auditFields(actor, atMs),
    });
    tx.update(ref, { debtUsdCents: input.newDebtUsdCents, lastLedgerId: ledgerRef.id, updatedAt: FieldValue.serverTimestamp() });
  });
  return { ok: true };
});
