import {
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  where,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { findStockShortages, findUnavailableImeis, priceCart, type Cart } from '@/domain/cart';
import { computeCredit, debtLineSettlement, formatDocNumber, offlineDocNumber } from '@/domain/checkout';
import { lbpCentTolerance, lbpToUsdCents, usdCentsToLbp } from '@/domain/money';
import { planReturn, returnStatusAfter, type ReturnRequestLine } from '@/domain/returns';
import { DEFAULTS, PAGE_SIZE } from '@/constants/app';
import type { CashboxSummary, Customer, Product, Sale, SaleKind, SaleReturn } from '@/types/models';
import { paths, toCashbox, toCustomer, toProduct, toSale, toSaleReturn, type Actor } from './db';
import { AppError } from './errors';
import { auditFields, commitOfflineBatch, isOnline, requireOnline, runTx, type Writer } from './ops';

/* =============================================================== checkout */

export interface CheckoutRequest {
  actor: Actor;
  cart: Cart;
  kind: SaleKind;
  rate: number;
  /** Product total the cashier confirmed; the sale is refused if prices changed meanwhile. */
  expectedTotalUsdCents: number;
  cash?: { receivedUsdCents: number; receivedLbp: number };
  credit?: { paidUsdCents: number; paidLbp: number };
  /** Cached data, used only when offline. */
  cachedProducts: Map<string, Product>;
  cachedCustomer: Customer | null;
}

export interface CheckoutResult {
  sale: Sale;
  offline: boolean;
  duplicate: boolean;
}

interface SaleContext {
  mode: 'tx' | 'offline';
  invoiceNumber: string;
  counterNext: number | null;
  products: Map<string, Product>;
  customer: Customer | null;
  cashbox: CashboxSummary | null;
}

function prepareSale(req: CheckoutRequest, ctx: SaleContext): { saleDoc: DocumentData; write: (w: Writer) => void } {
  const { actor, cart, rate } = req;
  const t = actor.tenantId;
  const exact = ctx.mode === 'tx';
  const totals = priceCart(cart, ctx.products, rate);

  if (cart.lines.length === 0) throw new AppError('error.cartEmpty');
  const missing = totals.lines.find((l) => l.missing);
  if (missing) throw new AppError('error.productMissing', { name: missing.name });
  if (totals.productsUsdCents !== req.expectedTotalUsdCents) throw new AppError('error.pricesChanged');
  const shortage = findStockShortages(cart.lines, ctx.products)[0];
  if (shortage) throw new AppError('error.insufficientStock', { name: shortage.name, available: shortage.available });
  const badImei = findUnavailableImeis(cart.lines, ctx.products)[0];
  if (badImei) throw new AppError('error.imeiUnavailable', { imei: badImei });

  const customer = ctx.customer;
  if (cart.customerId && !customer) throw new AppError('error.customerMissing');
  const debtBefore = customer?.debtUsdCents ?? 0;

  let receivedUsdCents = 0;
  let receivedLbp = 0;
  let settledPrevious = 0;
  let unpaid = 0;
  let debtDelta = 0;
  const ledger: { type: 'settlement' | 'creditSale'; amount: number }[] = [];

  if (req.kind === 'cash') {
    receivedUsdCents = Math.max(0, Math.round(req.cash?.receivedUsdCents ?? 0));
    receivedLbp = Math.max(0, Math.round(req.cash?.receivedLbp ?? 0));
    if (totals.debtLineUsdCents > 0) {
      if (!customer) throw new AppError('error.customerMissing');
      if (totals.debtLineUsdCents > debtBefore) throw new AppError('error.debtChanged');
      settledPrevious = debtLineSettlement(totals.debtLineUsdCents, debtBefore);
    }
    const matches =
      cart.currency === 'USD'
        ? Math.abs(receivedUsdCents + lbpToUsdCents(receivedLbp, rate) - totals.dueUsdCents) <= 1
        : Math.abs(usdCentsToLbp(receivedUsdCents, rate) + receivedLbp - totals.dueLbp) <= lbpCentTolerance(rate);
    if (!matches) throw new AppError('error.paymentMismatch');
    if (settledPrevious > 0) {
      ledger.push({ type: 'settlement', amount: -settledPrevious });
      debtDelta = -settledPrevious;
    }
  } else {
    if (!customer) throw new AppError('error.creditNeedsCustomer');
    receivedUsdCents = Math.max(0, Math.round(req.credit?.paidUsdCents ?? 0));
    receivedLbp = Math.max(0, Math.round(req.credit?.paidLbp ?? 0));
    const credit = computeCredit({
      productsUsdCents: totals.productsUsdCents,
      paidUsdCents: receivedUsdCents,
      paidLbp: receivedLbp,
      rate,
      customerDebtUsdCents: debtBefore,
      creditLimitUsdCents: customer.creditLimitUsdCents || DEFAULTS.creditLimitUsdCents,
      includePreviousDebt: cart.debtLineUsdCents !== null,
    });
    if (!credit.ok) throw new AppError(`error.credit.${credit.error ?? 'invalidAmount'}`);
    settledPrevious = credit.settledFromPreviousUsdCents;
    unpaid = credit.remainingCurrentUsdCents;
    debtDelta = credit.newTotalDebtUsdCents - debtBefore;
    if (settledPrevious > 0) ledger.push({ type: 'settlement', amount: -settledPrevious });
    if (unpaid > 0) ledger.push({ type: 'creditSale', amount: unpaid });
  }

  const audit = auditFields(actor);
  const saleId = cart.saleId;
  const invoiceNumber = ctx.invoiceNumber;

  const saleDoc: DocumentData = {
    invoiceNumber,
    kind: req.kind,
    currency: cart.currency,
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
    totalUsdCents: totals.productsUsdCents,
    totalLbp: totals.productsLbp,
    discountUsdCents: totals.discountUsdCents,
    costUsdCents: totals.costUsdCents,
    customerId: customer?.id ?? null,
    customerName: customer?.name ?? '',
    payment: {
      receivedUsdCents,
      receivedLbp,
      previousDebtUsdCents: debtBefore,
      settledPreviousUsdCents: settledPrevious,
      unpaidUsdCents: unpaid,
      debtAddedUsdCents: Math.max(0, debtDelta),
      debtAfterUsdCents: customer && exact ? debtBefore + debtDelta : null,
    },
    returnedUsdCents: 0,
    returnedDebtUsdCents: 0,
    refundedUsdCents: 0,
    refundedLbp: 0,
    returnStatus: 'none',
    lastReturnId: null,
    offline: ctx.mode === 'offline',
    ...audit,
  };

  const write = (w: Writer) => {
    w.set(paths.doc(t, 'sales', saleId), saleDoc);
    if (ctx.counterNext !== null) {
      w.set(paths.counter(t, 'sales'), { nextId: ctx.counterNext + 1, updatedAt: serverTimestamp() }, { merge: true });
    }

    const demand = new Map<string, { qty: number; imeis: string[] }>();
    for (const line of cart.lines) {
      const d = demand.get(line.productId) ?? { qty: 0, imeis: [] };
      d.qty += line.quantity;
      if (line.imei) d.imeis.push(line.imei);
      demand.set(line.productId, d);
    }
    for (const [productId, d] of demand) {
      const product = ctx.products.get(productId)!;
      const movementRef = doc(paths.col(t, 'stockMovements'));
      const update: DocumentData = {
        stock: increment(-d.qty),
        lastMovementId: movementRef.id,
        updatedAt: serverTimestamp(),
      };
      if (d.imeis.length) {
        update.imeis = product.imeis.map((e) => (d.imeis.includes(e.imei) ? { ...e, status: 'sold' } : e));
      }
      w.update(paths.doc(t, 'products', productId), update);
      w.set(movementRef, {
        productId,
        productName: product.name,
        type: 'sale',
        quantity: -d.qty,
        stockAfter: exact ? product.stock - d.qty : null,
        refId: saleId,
        refNumber: invoiceNumber,
        note: '',
        ...audit,
      });
    }

    if (customer) {
      const update: DocumentData = {
        totalPurchasesUsdCents: increment(totals.productsUsdCents),
        updatedAt: serverTimestamp(),
      };
      let running = debtBefore;
      let lastLedgerId: string | null = null;
      for (const entry of ledger) {
        running += entry.amount;
        const ref = doc(paths.col(t, 'customerLedger'));
        lastLedgerId = ref.id;
        w.set(ref, {
          customerId: customer.id,
          customerName: customer.name,
          type: entry.type,
          amountUsdCents: entry.amount,
          balanceAfterUsdCents: exact ? running : null,
          paidUsdCents: entry.type === 'creditSale' ? receivedUsdCents : 0,
          paidLbp: entry.type === 'creditSale' ? receivedLbp : 0,
          refId: saleId,
          refNumber: invoiceNumber,
          note: '',
          ...audit,
        });
      }
      if (lastLedgerId) {
        update.debtUsdCents = increment(debtDelta);
        update.lastLedgerId = lastLedgerId;
      }
      w.update(paths.doc(t, 'customers', customer.id), update);
    }

    if (receivedUsdCents > 0 || receivedLbp > 0) {
      const txRef = doc(paths.col(t, 'cashTransactions'));
      w.set(txRef, {
        type: 'sale',
        usdCents: receivedUsdCents,
        lbp: receivedLbp,
        balanceAfter: ctx.cashbox
          ? { usdCents: ctx.cashbox.usdCents + receivedUsdCents, lbp: ctx.cashbox.lbp + receivedLbp }
          : null,
        category: req.kind === 'credit' ? 'creditSale' : 'sale',
        note: '',
        refId: saleId,
        refNumber: invoiceNumber,
        ...audit,
      });
      w.set(
        paths.cashbox(t),
        { usdCents: increment(receivedUsdCents), lbp: increment(receivedLbp), lastTxId: txRef.id, updatedAt: serverTimestamp() },
        { merge: true },
      );
    }

    w.set(
      paths.doc(t, 'dailyStats', audit.localDate),
      {
        date: audit.localDate,
        salesCount: increment(1),
        revenueUsdCents: increment(totals.productsUsdCents),
        costUsdCents: increment(totals.costUsdCents),
        discountUsdCents: increment(totals.discountUsdCents),
        [req.kind === 'cash' ? 'cashSalesUsdCents' : 'creditSalesUsdCents']: increment(totals.productsUsdCents),
        debtCollectedUsdCents: increment(settledPrevious),
        creditIssuedUsdCents: increment(unpaid),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  };

  return { saleDoc, write };
}

function uniqueProductIds(cart: Cart): string[] {
  return [...new Set(cart.lines.map((l) => l.productId))];
}

/**
 * Completes a sale.
 * Online: one Firestore transaction (idempotent on `cart.saleId`) that re-reads products, the
 * customer, the counter and the drawer, validates everything and writes all effects atomically.
 * Offline: an atomic batch built from cached data with `increment()` for every balance, so
 * concurrent devices never overwrite each other. Security rules reject a replay of the same sale.
 */
export async function checkout(req: CheckoutRequest): Promise<CheckoutResult> {
  const t = req.actor.tenantId;
  const saleRef = paths.doc(t, 'sales', req.cart.saleId);
  const prefix = req.kind === 'credit' ? 'CR' : 'INV';

  if (!isOnline()) {
    const { saleDoc, write } = prepareSale(req, {
      mode: 'offline',
      invoiceNumber: offlineDocNumber(prefix, req.cart.saleId),
      counterNext: null,
      products: req.cachedProducts,
      customer: req.cachedCustomer,
      cashbox: null,
    });
    commitOfflineBatch(write, `sale ${saleDoc.invoiceNumber}`);
    return { sale: toSale(req.cart.saleId, saleDoc), offline: true, duplicate: false };
  }

  return runTx(async (tx) => {
    const existing = await tx.get(saleRef);
    if (existing.exists()) return { sale: toSale(existing.id, existing.data()), offline: false, duplicate: true };

    const counterSnap = await tx.get(paths.counter(t, 'sales'));
    const productSnaps = await Promise.all(uniqueProductIds(req.cart).map((id) => tx.get(paths.doc(t, 'products', id))));
    const customerSnap = req.cart.customerId ? await tx.get(paths.doc(t, 'customers', req.cart.customerId)) : null;
    const cashboxSnap = await tx.get(paths.cashbox(t));

    const products = new Map<string, Product>();
    for (const snap of productSnaps) if (snap.exists()) products.set(snap.id, toProduct(snap.id, snap.data()));
    const counterNext = Number(counterSnap.data()?.nextId) || 1;

    const { saleDoc, write } = prepareSale(req, {
      mode: 'tx',
      invoiceNumber: formatDocNumber(prefix, counterNext),
      counterNext,
      products,
      customer: customerSnap?.exists() ? toCustomer(customerSnap.id, customerSnap.data()) : null,
      cashbox: toCashbox(cashboxSnap.data()),
    });
    write(tx);
    return { sale: toSale(req.cart.saleId, saleDoc), offline: false, duplicate: false };
  });
}

/* ================================================================ returns */

export interface ReturnRequest {
  actor: Actor;
  saleId: string;
  lines: ReturnRequestLine[];
  reason: string;
}

/**
 * Processes a (partial) return in one transaction: restores stock/IMEIs, reduces the customer's
 * debt first for credit sales, refunds the rest from the drawer (checked for sufficient cash),
 * and records the return document, movements, ledger and cash transaction.
 */
export async function processReturn(req: ReturnRequest): Promise<SaleReturn> {
  requireOnline();
  const t = req.actor.tenantId;
  return runTx(async (tx) => {
    const saleSnap = await tx.get(paths.doc(t, 'sales', req.saleId));
    if (!saleSnap.exists()) throw new AppError('error.notFound');
    const sale = toSale(saleSnap.id, saleSnap.data());

    const counterSnap = await tx.get(paths.counter(t, 'sales'));
    const productIds = [...new Set(sale.items.map((i) => i.productId))];
    const productSnaps = await Promise.all(productIds.map((id) => tx.get(paths.doc(t, 'products', id))));
    const customerSnap = sale.customerId ? await tx.get(paths.doc(t, 'customers', sale.customerId)) : null;
    const cashboxSnap = await tx.get(paths.cashbox(t));

    const customer = customerSnap?.exists() ? toCustomer(customerSnap.id, customerSnap.data()) : null;
    const cashbox = toCashbox(cashboxSnap.data());
    const plan = planReturn(sale, req.lines, customer?.debtUsdCents ?? 0);
    if (!plan.ok) throw new AppError(`error.return.${plan.error ?? 'invalid'}`);
    if (plan.refundUsdCents > cashbox.usdCents || plan.refundLbp > cashbox.lbp) {
      throw new AppError('error.drawerInsufficient');
    }

    const products = new Map<string, Product>();
    for (const snap of productSnaps) if (snap.exists()) products.set(snap.id, toProduct(snap.id, snap.data()));

    const counterNext = Number(counterSnap.data()?.nextId) || 1;
    const number = formatDocNumber('RF', counterNext);
    const audit = auditFields(req.actor);
    const returnRef = doc(paths.col(t, 'returns'));

    const returnDoc: DocumentData = {
      number,
      saleId: sale.id,
      saleInvoiceNumber: sale.invoiceNumber,
      customerId: sale.customerId,
      customerName: sale.customerName,
      items: plan.items,
      amountUsdCents: plan.amountUsdCents,
      refundUsdCents: plan.refundUsdCents,
      refundLbp: plan.refundLbp,
      debtReducedUsdCents: plan.debtReducedUsdCents,
      reason: req.reason.trim().slice(0, 500),
      ...audit,
    };

    tx.set(paths.counter(t, 'sales'), { nextId: counterNext + 1, updatedAt: serverTimestamp() }, { merge: true });
    tx.set(returnRef, returnDoc);
    tx.update(paths.doc(t, 'sales', sale.id), {
      items: sale.items.map((item, i) => ({ ...item, returnedQty: (item.returnedQty || 0) + (plan.quantities.get(i) ?? 0) })),
      returnedUsdCents: increment(plan.amountUsdCents),
      returnedDebtUsdCents: increment(plan.debtReducedUsdCents),
      refundedUsdCents: increment(plan.refundUsdCents),
      refundedLbp: increment(plan.refundLbp),
      returnStatus: returnStatusAfter(sale, plan.quantities),
      lastReturnId: returnRef.id,
    });

    const perProduct = new Map<string, { qty: number; imeis: string[]; name: string }>();
    for (const item of plan.items) {
      const p = perProduct.get(item.productId) ?? { qty: 0, imeis: [], name: item.name };
      p.qty += item.quantity;
      if (item.imei) p.imeis.push(item.imei);
      perProduct.set(item.productId, p);
    }
    for (const [productId, p] of perProduct) {
      const product = products.get(productId);
      if (!product) continue; // product deleted since the sale: nothing to restock
      const movementRef = doc(paths.col(t, 'stockMovements'));
      const update: DocumentData = { stock: increment(p.qty), lastMovementId: movementRef.id, updatedAt: serverTimestamp() };
      if (p.imeis.length) {
        update.imeis = product.imeis.map((e) => (p.imeis.includes(e.imei) ? { ...e, status: 'available' } : e));
      }
      tx.update(paths.doc(t, 'products', productId), update);
      tx.set(movementRef, {
        productId,
        productName: p.name,
        type: 'return',
        quantity: p.qty,
        stockAfter: product.stock + p.qty,
        refId: returnRef.id,
        refNumber: number,
        note: '',
        ...audit,
      });
    }

    if (customer) {
      const update: DocumentData = {
        totalPurchasesUsdCents: increment(-plan.amountUsdCents),
        updatedAt: serverTimestamp(),
      };
      if (plan.debtReducedUsdCents > 0) {
        const ledgerRef = doc(paths.col(t, 'customerLedger'));
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
        update.debtUsdCents = increment(-plan.debtReducedUsdCents);
        update.lastLedgerId = ledgerRef.id;
      }
      tx.update(paths.doc(t, 'customers', customer.id), update);
    }

    if (plan.refundUsdCents > 0 || plan.refundLbp > 0) {
      const cashRef = doc(paths.col(t, 'cashTransactions'));
      tx.set(cashRef, {
        type: 'refund',
        usdCents: -plan.refundUsdCents,
        lbp: -plan.refundLbp,
        balanceAfter: { usdCents: cashbox.usdCents - plan.refundUsdCents, lbp: cashbox.lbp - plan.refundLbp },
        category: 'refund',
        note: sale.invoiceNumber,
        refId: returnRef.id,
        refNumber: number,
        ...audit,
      });
      tx.set(
        paths.cashbox(t),
        {
          usdCents: increment(-plan.refundUsdCents),
          lbp: increment(-plan.refundLbp),
          lastTxId: cashRef.id,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    }

    tx.set(
      paths.doc(t, 'dailyStats', audit.localDate),
      {
        date: audit.localDate,
        returnsCount: increment(1),
        returnsUsdCents: increment(plan.amountUsdCents),
        returnsCostUsdCents: increment(plan.costUsdCents),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    return toSaleReturn(returnRef.id, returnDoc);
  });
}

/* ================================================================ queries */

export interface SalesFilter {
  from: string;
  to: string;
  kind?: SaleKind | 'all';
  customerId?: string | null;
}

export interface Page<T> {
  items: T[];
  cursor: QueryDocumentSnapshot | null;
  hasMore: boolean;
}

export async function listSales(tenantId: string, filter: SalesFilter, cursor: QueryDocumentSnapshot | null): Promise<Page<Sale>> {
  const constraints: QueryConstraint[] = [
    where('localDate', '>=', filter.from),
    where('localDate', '<=', filter.to),
  ];
  if (filter.kind && filter.kind !== 'all') constraints.push(where('kind', '==', filter.kind));
  if (filter.customerId) constraints.push(where('customerId', '==', filter.customerId));
  constraints.push(orderBy('localDate', 'desc'), orderBy('createdAtMs', 'desc'), limit(PAGE_SIZE));
  if (cursor) constraints.push(startAfter(cursor));
  const snap = await getDocs(query(paths.col(tenantId, 'sales'), ...constraints));
  return {
    items: snap.docs.map((d) => toSale(d.id, d.data())),
    cursor: snap.docs[snap.docs.length - 1] ?? null,
    hasMore: snap.docs.length === PAGE_SIZE,
  };
}

export async function findSaleByInvoice(tenantId: string, invoiceNumber: string): Promise<Sale | null> {
  const snap = await getDocs(
    query(paths.col(tenantId, 'sales'), where('invoiceNumber', '==', invoiceNumber.trim().toUpperCase()), limit(1)),
  );
  const d = snap.docs[0];
  return d ? toSale(d.id, d.data()) : null;
}

export async function getSale(tenantId: string, saleId: string): Promise<Sale | null> {
  const snap = await getDoc(paths.doc(tenantId, 'sales', saleId));
  return snap.exists() ? toSale(snap.id, snap.data()) : null;
}

export async function listReturnsForSale(tenantId: string, saleId: string): Promise<SaleReturn[]> {
  const snap = await getDocs(query(paths.col(tenantId, 'returns'), where('saleId', '==', saleId), limit(100)));
  return snap.docs.map((d) => toSaleReturn(d.id, d.data())).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

/** Loads every sale in a date range for reports (bounded to protect cost and memory). */
export const REPORT_MAX_DOCS = 5000;

export async function loadSalesRange(tenantId: string, from: string, to: string): Promise<{ sales: Sale[]; truncated: boolean }> {
  const snap = await getDocs(
    query(
      paths.col(tenantId, 'sales'),
      where('localDate', '>=', from),
      where('localDate', '<=', to),
      orderBy('localDate', 'desc'),
      limit(REPORT_MAX_DOCS),
    ),
  );
  return { sales: snap.docs.map((d) => toSale(d.id, d.data())), truncated: snap.docs.length === REPORT_MAX_DOCS };
}

export async function loadReturnsRange(tenantId: string, from: string, to: string): Promise<SaleReturn[]> {
  const snap = await getDocs(
    query(
      paths.col(tenantId, 'returns'),
      where('localDate', '>=', from),
      where('localDate', '<=', to),
      limit(REPORT_MAX_DOCS),
    ),
  );
  return snap.docs.map((d) => toSaleReturn(d.id, d.data()));
}
