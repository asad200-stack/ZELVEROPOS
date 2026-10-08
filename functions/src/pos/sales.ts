import { FieldValue, type DocumentData } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db } from '../admin.js';
import { fail } from '../errors.js';
import { emptyCartDraft, findStockShortages, findUnavailableImeis, priceCart, type Cart } from '../shared/cart.js';
import { cashNetCoversDue, computeCredit, debtLineSettlement, formatDocNumber } from '../shared/checkout.js';
import { planReturn, returnStatusAfter } from '../shared/returns.js';
import type { Product } from '../shared/models.js';
import { tierUsdCents } from '../shared/pricing.js';
import { parse } from '../validate.js';
import {
  auditFields,
  bumpDailyStats,
  cents,
  clientTimeField,
  exchangeRateOf,
  idField,
  lbpField,
  operationTime,
  plain,
  posActor,
  requirePerm,
  tenantPaths,
  toCashbox,
  toCustomer,
  toProduct,
  toSale,
} from './common.js';

const tier = z.enum(['retail', 'wholesale', 'vip']);

const checkoutSchema = z.object({
  saleId: idField,
  kind: z.enum(['cash', 'credit']),
  currency: z.enum(['USD', 'LBP']),
  /** Rate the cashier saw; refused if the store rate changed meanwhile. */
  rate: z.number().int().positive(),
  customerId: idField.nullable(),
  debtLineUsdCents: cents.nullable(),
  lines: z
    .array(
      z.object({
        productId: idField,
        tier,
        quantity: z.number().int().min(1).max(100_000),
        customUsdCents: cents.nullable(),
        imei: z.string().trim().min(1).max(64).nullable(),
        /** Unit price the cashier saw; refused if it differs (even when the total still matches). */
        expectedUnitUsdCents: cents.optional(),
        expectedUnitLbp: lbpField.optional(),
      }),
    )
    .min(1)
    .max(300),
  /** Product total the cashier confirmed; refused if prices changed meanwhile. */
  expectedTotalUsdCents: cents,
  orderLabel: z.string().trim().max(40).optional(),
  note: z.string().trim().max(200).optional(),
  cash: z
    .object({
      receivedUsdCents: cents,
      receivedLbp: lbpField,
      changeUsdCents: cents.optional(),
      changeLbp: lbpField.optional(),
    })
    .optional(),
  credit: z.object({ paidUsdCents: cents, paidLbp: lbpField }).optional(),
  clientCreatedAtMs: clientTimeField,
  /** Temporary reference printed on an offline receipt; set only by the offline sync queue. */
  offlineRef: z.string().regex(/^OFF-[A-Z0-9]{6}$/).nullable().optional(),
});

/**
 * Completes a sale. Server-authoritative: prices, costs, totals, stock, IMEIs, credit limit, payment
 * and the invoice number are all computed here from the database, in one transaction. Idempotent on
 * `saleId` (a retry after a lost response returns the already-recorded sale).
 */
export const posCheckout = onCall(async (request) => {
  const input = parse(checkoutSchema, request.data);
  const atMs = operationTime(input.clientCreatedAtMs);
  const actor = await posActor(request, ['canSell']);
  const t = actor.tenantId;
  const p = tenantPaths(t);
  const saleRef = p.doc('sales', input.saleId);

  return db.runTransaction(async (tx) => {
    const existing = await tx.get(saleRef);
    if (existing.exists) {
      const sale = existing.data()!;
      if (sale.createdBy !== actor.uid) fail('already-exists', 'error.alreadyExists');
      return { sale: plain(sale, Number(sale.createdAtMs) || atMs), duplicate: true };
    }

    const productIds = [...new Set(input.lines.map((l) => l.productId))];
    const [settingsSnap, counterSnap, cashboxSnap, customerSnap, ...productSnaps] = await Promise.all([
      tx.get(p.settings),
      tx.get(p.counter('sales')),
      tx.get(p.cashbox),
      input.customerId ? tx.get(p.doc('customers', input.customerId)) : Promise.resolve(null),
      ...productIds.map((id) => tx.get(p.doc('products', id))),
    ]);

    const rate = exchangeRateOf(settingsSnap.data());
    if (rate !== input.rate) fail('failed-precondition', 'error.rateChanged');

    const products = new Map<string, Product>();
    for (const s of productSnaps) if (s.exists) products.set(s.id, toProduct(s.id, s.data()!));
    const customer = customerSnap?.exists ? toCustomer(customerSnap.id, customerSnap.data()!) : null;
    if (input.customerId && !customer) fail('not-found', 'error.customerMissing');

    for (const line of input.lines) {
      const product = products.get(line.productId);
      if (!product) fail('not-found', 'error.productMissing', { name: line.productId });
      if (product.status === 'archived') fail('failed-precondition', 'error.productArchived', { name: product.name });
      if (product.imeiTracking !== (line.imei !== null) || (line.imei !== null && line.quantity !== 1)) {
        fail('invalid-argument', 'error.imeiUnavailable', { imei: line.imei ?? product.name });
      }
      if (line.customUsdCents !== null && line.customUsdCents !== tierUsdCents(product, line.tier, rate)) {
        requirePerm(actor, 'canEditPrice');
      }
    }

    const cart: Cart = {
      id: 'server',
      label: input.orderLabel ?? '',
      note: input.note ?? '',
      tier: input.lines[0]!.tier,
      currency: input.currency,
      customerId: customer?.id ?? null,
      debtLineUsdCents: input.debtLineUsdCents,
      saleId: input.saleId,
      lines: input.lines.map((l, i) => ({ ...l, key: String(i), name: products.get(l.productId)?.name ?? '' })),
      draft: emptyCartDraft(),
    };
    const totals = priceCart(cart, products, rate);
    const lineChanged = input.lines.some(
      (l, i) =>
        (l.expectedUnitUsdCents !== undefined && totals.lines[i]?.unitUsdCents !== l.expectedUnitUsdCents) ||
        (l.expectedUnitLbp !== undefined && totals.lines[i]?.unitLbp !== l.expectedUnitLbp),
    );
    if (lineChanged || totals.productsUsdCents !== input.expectedTotalUsdCents) fail('failed-precondition', 'error.pricesChanged');
    const shortage = findStockShortages(cart.lines, products)[0];
    if (shortage) fail('failed-precondition', 'error.insufficientStock', { name: shortage.name, available: shortage.available });
    const badImei = findUnavailableImeis(cart.lines, products)[0];
    if (badImei) fail('failed-precondition', 'error.imeiUnavailable', { imei: badImei });

    const debtBefore = customer?.debtUsdCents ?? 0;
    let receivedUsdCents: number;
    let receivedLbp: number;
    let changeUsdCents = 0;
    let changeLbp = 0;
    let settledPrevious = 0;
    let unpaid = 0;
    let debtDelta = 0;
    const ledger: { type: 'settlement' | 'creditSale'; amount: number }[] = [];

    if (input.kind === 'cash') {
      receivedUsdCents = input.cash?.receivedUsdCents ?? 0;
      receivedLbp = input.cash?.receivedLbp ?? 0;
      changeUsdCents = input.cash?.changeUsdCents ?? 0;
      changeLbp = input.cash?.changeLbp ?? 0;
      if (totals.debtLineUsdCents > 0) {
        if (totals.debtLineUsdCents > debtBefore) fail('failed-precondition', 'error.debtChanged');
        settledPrevious = debtLineSettlement(totals.debtLineUsdCents, debtBefore);
      }
      const matches = cashNetCoversDue(
        input.currency,
        rate,
        totals.dueUsdCents,
        totals.dueLbp,
        receivedUsdCents - changeUsdCents,
        receivedLbp - changeLbp,
      );
      if (!matches) fail('invalid-argument', 'error.paymentMismatch');
      if (settledPrevious > 0) {
        ledger.push({ type: 'settlement', amount: -settledPrevious });
        debtDelta = -settledPrevious;
      }
    } else {
      if (!customer) fail('invalid-argument', 'error.creditNeedsCustomer');
      receivedUsdCents = input.credit?.paidUsdCents ?? 0;
      receivedLbp = input.credit?.paidLbp ?? 0;
      const credit = computeCredit({
        productsUsdCents: totals.productsUsdCents,
        paidUsdCents: receivedUsdCents,
        paidLbp: receivedLbp,
        rate,
        customerDebtUsdCents: debtBefore,
        creditLimitUsdCents: customer.creditLimitUsdCents || 500_00,
        includePreviousDebt: input.debtLineUsdCents !== null,
      });
      if (!credit.ok) fail('failed-precondition', `error.credit.${credit.error ?? 'invalidAmount'}`);
      settledPrevious = credit.settledFromPreviousUsdCents;
      unpaid = credit.remainingCurrentUsdCents;
      debtDelta = credit.newTotalDebtUsdCents - debtBefore;
      if (settledPrevious > 0) ledger.push({ type: 'settlement', amount: -settledPrevious });
      if (unpaid > 0) ledger.push({ type: 'creditSale', amount: unpaid });
    }

    const audit = auditFields(actor, atMs);
    const counterNext = Number(counterSnap.data()?.nextId) || 1;
    const invoiceNumber = formatDocNumber(input.kind === 'credit' ? 'CR' : 'INV', counterNext);

    const saleDoc: DocumentData = {
      invoiceNumber,
      kind: input.kind,
      currency: input.currency,
      exchangeRate: rate,
      items: totals.lines.map((l) => ({
        productId: l.productId,
        name: l.name,
        quantity: l.quantity,
        tier: l.tier,
        unitUsdCents: l.unitUsdCents,
        unitLbp: l.unitLbp,
        originalUnitUsdCents: l.originalUnitUsdCents,
        discountUsdCents: l.discountUsdCents,
        costUsdCents: l.costUsdCents,
        imei: l.imei,
        returnedQty: 0,
      })),
      productIds,
      totalUsdCents: totals.productsUsdCents,
      totalLbp: totals.productsLbp,
      discountUsdCents: totals.discountUsdCents,
      costUsdCents: totals.costUsdCents,
      customerId: customer?.id ?? null,
      customerName: customer?.name ?? '',
      orderLabel: input.orderLabel ?? '',
      note: input.note ?? '',
      payment: {
        receivedUsdCents,
        receivedLbp,
        changeUsdCents,
        changeLbp,
        previousDebtUsdCents: debtBefore,
        settledPreviousUsdCents: settledPrevious,
        unpaidUsdCents: unpaid,
        debtAddedUsdCents: Math.max(0, debtDelta),
        debtAfterUsdCents: customer ? debtBefore + debtDelta : null,
      },
      returnedUsdCents: 0,
      returnedDebtUsdCents: 0,
      refundedUsdCents: 0,
      refundedLbp: 0,
      returnStatus: 'none',
      lastReturnId: null,
      offline: Boolean(input.offlineRef),
      offlineRef: input.offlineRef ?? null,
      syncedAtMs: input.offlineRef ? Date.now() : null,
      ...audit,
    };

    tx.set(saleRef, saleDoc);
    tx.set(p.counter('sales'), { nextId: counterNext + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

    const demand = new Map<string, { qty: number; imeis: string[] }>();
    for (const line of cart.lines) {
      const d = demand.get(line.productId) ?? { qty: 0, imeis: [] };
      d.qty += line.quantity;
      if (line.imei) d.imeis.push(line.imei);
      demand.set(line.productId, d);
    }
    for (const [productId, d] of demand) {
      const product = products.get(productId)!;
      const movementRef = p.newRef('stockMovements');
      const update: DocumentData = { stock: product.stock - d.qty, lastMovementId: movementRef.id, updatedAt: FieldValue.serverTimestamp() };
      if (d.imeis.length) update.imeis = product.imeis.map((e) => (d.imeis.includes(e.imei) ? { ...e, status: 'sold' } : e));
      tx.update(p.doc('products', productId), update);
      tx.set(movementRef, {
        productId,
        productName: product.name,
        type: 'sale',
        quantity: -d.qty,
        stockAfter: product.stock - d.qty,
        refId: input.saleId,
        refNumber: invoiceNumber,
        note: '',
        ...audit,
      });
    }

    if (customer) {
      const update: DocumentData = {
        totalPurchasesUsdCents: customer.totalPurchasesUsdCents + totals.productsUsdCents,
        updatedAt: FieldValue.serverTimestamp(),
      };
      let running = debtBefore;
      for (const entry of ledger) {
        running += entry.amount;
        const ref = p.newRef('customerLedger');
        update.lastLedgerId = ref.id;
        tx.set(ref, {
          customerId: customer.id,
          customerName: customer.name,
          type: entry.type,
          amountUsdCents: entry.amount,
          balanceAfterUsdCents: running,
          paidUsdCents: entry.type === 'creditSale' ? receivedUsdCents : 0,
          paidLbp: entry.type === 'creditSale' ? receivedLbp : 0,
          refId: input.saleId,
          refNumber: invoiceNumber,
          note: '',
          ...audit,
        });
      }
      if (ledger.length) update.debtUsdCents = debtBefore + debtDelta;
      tx.update(p.doc('customers', customer.id), update);
    }

    const netUsdCents = receivedUsdCents - changeUsdCents;
    const netLbp = receivedLbp - changeLbp;
    if (netUsdCents !== 0 || netLbp !== 0) {
      const cashbox = toCashbox(cashboxSnap.data());
      const after = { usdCents: cashbox.usdCents + netUsdCents, lbp: cashbox.lbp + netLbp };
      if (after.usdCents < 0 || after.lbp < 0) fail('failed-precondition', 'error.drawerInsufficient');
      const cashRef = p.newRef('cashTransactions');
      tx.set(cashRef, {
        type: 'sale',
        usdCents: netUsdCents,
        lbp: netLbp,
        balanceAfter: after,
        category: input.kind === 'credit' ? 'creditSale' : 'sale',
        note: '',
        refId: input.saleId,
        refNumber: invoiceNumber,
        ...audit,
      });
      tx.set(p.cashbox, { ...after, lastTxId: cashRef.id, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }

    bumpDailyStats(tx, t, audit.localDate, {
      salesCount: 1,
      revenueUsdCents: totals.productsUsdCents,
      costUsdCents: totals.costUsdCents,
      discountUsdCents: totals.discountUsdCents,
      [input.kind === 'cash' ? 'cashSalesUsdCents' : 'creditSalesUsdCents']: totals.productsUsdCents,
      debtCollectedUsdCents: settledPrevious,
      creditIssuedUsdCents: unpaid,
    });

    return { sale: plain(saleDoc, atMs), duplicate: false };
  });
});

/* ================================================================ returns */

const returnSchema = z.object({
  saleId: idField,
  lines: z.array(z.object({ index: z.number().int().min(0).max(299), quantity: z.number().int().min(0).max(100_000) })).min(1).max(300),
  reason: z.string().trim().max(500).default(''),
});

/**
 * Processes a (partial) return: restores stock/IMEIs, reduces the customer's debt first for credit
 * sales, refunds the rest from the drawer (which must hold enough cash) and records every effect.
 */
export const posReturn = onCall(async (request) => {
  const input = parse(returnSchema, request.data);
  const actor = await posActor(request, ['canViewSales']);
  const t = actor.tenantId;
  const p = tenantPaths(t);
  const atMs = Date.now();

  return db.runTransaction(async (tx) => {
    const saleSnap = await tx.get(p.doc('sales', input.saleId));
    if (!saleSnap.exists) fail('not-found', 'error.notFound');
    const sale = toSale(saleSnap.id, saleSnap.data()!);

    const productIds = [...new Set(sale.items.map((i) => i.productId))];
    const [counterSnap, cashboxSnap, customerSnap, ...productSnaps] = await Promise.all([
      tx.get(p.counter('sales')),
      tx.get(p.cashbox),
      sale.customerId ? tx.get(p.doc('customers', sale.customerId)) : Promise.resolve(null),
      ...productIds.map((id) => tx.get(p.doc('products', id))),
    ]);
    const customer = customerSnap?.exists ? toCustomer(customerSnap.id, customerSnap.data()!) : null;
    const cashbox = toCashbox(cashboxSnap.data());
    const plan = planReturn(sale, input.lines, customer?.debtUsdCents ?? 0);
    if (!plan.ok) fail('failed-precondition', `error.return.${plan.error ?? 'invalid'}`);
    if (plan.refundUsdCents > cashbox.usdCents || plan.refundLbp > cashbox.lbp) fail('failed-precondition', 'error.drawerInsufficient');

    const products = new Map<string, Product>();
    for (const s of productSnaps) if (s.exists) products.set(s.id, toProduct(s.id, s.data()!));

    const counterNext = Number(counterSnap.data()?.nextId) || 1;
    const number = formatDocNumber('RF', counterNext);
    const audit = auditFields(actor, atMs);
    const returnRef = p.newRef('returns');
    const returnDoc: DocumentData = {
      number,
      saleId: sale.id,
      saleInvoiceNumber: sale.invoiceNumber,
      customerId: sale.customerId,
      customerName: sale.customerName,
      items: plan.items,
      productIds: [...new Set(plan.items.map((i) => i.productId))],
      amountUsdCents: plan.amountUsdCents,
      refundUsdCents: plan.refundUsdCents,
      refundLbp: plan.refundLbp,
      debtReducedUsdCents: plan.debtReducedUsdCents,
      reason: input.reason,
      ...audit,
    };

    tx.set(p.counter('sales'), { nextId: counterNext + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(returnRef, returnDoc);
    tx.update(saleSnap.ref, {
      items: (saleSnap.data()!.items as DocumentData[]).map((item, i) => ({
        ...item,
        returnedQty: (Number(item.returnedQty) || 0) + (plan.quantities.get(i) ?? 0),
      })),
      returnedUsdCents: sale.returnedUsdCents + plan.amountUsdCents,
      returnedDebtUsdCents: sale.returnedDebtUsdCents + plan.debtReducedUsdCents,
      refundedUsdCents: sale.refundedUsdCents + plan.refundUsdCents,
      refundedLbp: sale.refundedLbp + plan.refundLbp,
      returnStatus: returnStatusAfter(sale, plan.quantities),
      lastReturnId: returnRef.id,
    });

    const perProduct = new Map<string, { qty: number; imeis: string[]; name: string }>();
    for (const item of plan.items) {
      const e = perProduct.get(item.productId) ?? { qty: 0, imeis: [], name: item.name };
      e.qty += item.quantity;
      if (item.imei) e.imeis.push(item.imei);
      perProduct.set(item.productId, e);
    }
    for (const [productId, e] of perProduct) {
      const product = products.get(productId);
      if (!product) continue; // deleted since the sale: nothing to restock
      const movementRef = p.newRef('stockMovements');
      const update: DocumentData = { stock: product.stock + e.qty, lastMovementId: movementRef.id, updatedAt: FieldValue.serverTimestamp() };
      if (e.imeis.length) update.imeis = product.imeis.map((x) => (e.imeis.includes(x.imei) ? { ...x, status: 'available' } : x));
      tx.update(p.doc('products', productId), update);
      tx.set(movementRef, {
        productId,
        productName: e.name,
        type: 'return',
        quantity: e.qty,
        stockAfter: product.stock + e.qty,
        refId: returnRef.id,
        refNumber: number,
        note: '',
        ...audit,
      });
    }

    if (customer) {
      const update: DocumentData = {
        totalPurchasesUsdCents: customer.totalPurchasesUsdCents - plan.amountUsdCents,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (plan.debtReducedUsdCents > 0) {
        const ledgerRef = p.newRef('customerLedger');
        tx.set(ledgerRef, {
          customerId: customer.id,
          customerName: customer.name,
          type: 'refund',
          amountUsdCents: -plan.debtReducedUsdCents,
          balanceAfterUsdCents: customer.debtUsdCents - plan.debtReducedUsdCents,
          paidUsdCents: 0,
          paidLbp: 0,
          refId: returnRef.id,
          refNumber: number,
          note: sale.invoiceNumber,
          ...audit,
        });
        update.debtUsdCents = customer.debtUsdCents - plan.debtReducedUsdCents;
        update.lastLedgerId = ledgerRef.id;
      }
      tx.update(p.doc('customers', customer.id), update);
    }

    if (plan.refundUsdCents > 0 || plan.refundLbp > 0) {
      const cashRef = p.newRef('cashTransactions');
      const after = { usdCents: cashbox.usdCents - plan.refundUsdCents, lbp: cashbox.lbp - plan.refundLbp };
      tx.set(cashRef, {
        type: 'refund',
        usdCents: -plan.refundUsdCents,
        lbp: -plan.refundLbp,
        balanceAfter: after,
        category: 'refund',
        note: sale.invoiceNumber,
        refId: returnRef.id,
        refNumber: number,
        ...audit,
      });
      tx.set(p.cashbox, { ...after, lastTxId: cashRef.id, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }

    bumpDailyStats(tx, t, audit.localDate, {
      returnsCount: 1,
      returnsUsdCents: plan.amountUsdCents,
      returnsCostUsdCents: plan.costUsdCents,
    });

    return { saleReturn: { id: returnRef.id, ...plain(returnDoc, atMs) } };
  });
});
