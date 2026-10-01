import type { Cart, CartTotals } from '@/domain/cart';
import type { CheckoutCall } from '@/services/functionsClient';
import type { SaleKind } from '@/types/models';
import type { SaleSnapshot } from './types';

export interface CheckoutRequest {
  cart: Cart;
  kind: SaleKind;
  rate: number;
  /** Prices exactly as shown to the cashier; the server refuses the sale if any of them changed. */
  totals: CartTotals;
  cash?: { receivedUsdCents: number; receivedLbp: number };
  credit?: { paidUsdCents: number; paidLbp: number };
}

/** Who is selling — used only for the local offline snapshot, never for authorization. */
export interface CheckoutContext {
  tenantId: string;
  uid: string;
  cashierName: string;
  customerName: string;
}

/** The exact `posCheckout` payload, shared by online sales and the offline queue. */
export function buildCheckoutCall(req: CheckoutRequest): CheckoutCall {
  const { cart, totals } = req;
  return {
    saleId: cart.saleId,
    kind: req.kind,
    currency: cart.currency,
    rate: req.rate,
    customerId: cart.customerId,
    debtLineUsdCents: cart.customerId ? cart.debtLineUsdCents : null,
    lines: cart.lines.map((l, i) => ({
      productId: l.productId,
      tier: l.tier,
      quantity: l.quantity,
      customUsdCents: l.customUsdCents,
      imei: l.imei,
      expectedUnitUsdCents: totals.lines[i]?.unitUsdCents,
      expectedUnitLbp: totals.lines[i]?.unitLbp,
    })),
    expectedTotalUsdCents: totals.productsUsdCents,
    cash: req.kind === 'cash' ? req.cash : undefined,
    credit: req.kind === 'credit' ? req.credit : undefined,
  };
}

export function buildSaleSnapshot(req: CheckoutRequest, ctx: CheckoutContext): SaleSnapshot {
  const { cart, totals } = req;
  const paid = req.kind === 'cash' ? req.cash : req.credit && { receivedUsdCents: req.credit.paidUsdCents, receivedLbp: req.credit.paidLbp };
  return {
    kind: req.kind,
    currency: cart.currency,
    tier: cart.tier,
    rate: req.rate,
    lines: totals.lines.map((l) => ({
      productId: l.productId,
      name: l.name,
      tier: l.tier,
      quantity: l.quantity,
      unitUsdCents: l.unitUsdCents,
      unitLbp: l.unitLbp,
      originalUnitUsdCents: l.originalUnitUsdCents,
      customUsdCents: l.customUsdCents,
      lineUsdCents: l.lineUsdCents,
      lineLbp: l.lineLbp,
      imei: l.imei,
    })),
    totalUsdCents: totals.productsUsdCents,
    totalLbp: totals.productsLbp,
    debtLineUsdCents: cart.customerId ? cart.debtLineUsdCents : null,
    customerId: cart.customerId,
    customerName: ctx.customerName,
    received: { usdCents: paid?.receivedUsdCents ?? 0, lbp: paid?.receivedLbp ?? 0 },
    cashierName: ctx.cashierName,
  };
}
