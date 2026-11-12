import type { Sale, SaleReturn } from '@/types/models';
import { lbpToUsdCents, usdCentsToLbp, type Cents } from './money';

export interface ReturnRequestLine {
  index: number;
  quantity: number;
}

export type ReturnError = 'empty' | 'tooMany' | 'invalid';

export interface ReturnPlan {
  ok: boolean;
  error: ReturnError | null;
  items: SaleReturn['items'];
  /** index → quantity, to update `returnedQty` on the sale. */
  quantities: Map<number, number>;
  amountUsdCents: Cents;
  costUsdCents: Cents;
  debtReducedUsdCents: Cents;
  refundUsdCents: Cents;
  refundLbp: number;
}

/**
 * Splits a cash amount into USD/LBP in the same proportion the sale was paid
 * (a sale paid 100% in LBP refunds LBP, a mixed payment refunds mixed).
 */
export function splitRefund(amountUsdCents: Cents, receivedUsdCents: Cents, receivedLbp: number, rate: number) {
  const receivedValue = receivedUsdCents + lbpToUsdCents(receivedLbp, rate);
  if (amountUsdCents <= 0) return { refundUsdCents: 0, refundLbp: 0 };
  if (receivedValue <= 0) return { refundUsdCents: amountUsdCents, refundLbp: 0 };
  const usdPart = Math.min(amountUsdCents, Math.round((amountUsdCents * receivedUsdCents) / receivedValue));
  return { refundUsdCents: usdPart, refundLbp: usdCentsToLbp(amountUsdCents - usdPart, rate) };
}

/**
 * Plans a (partial) return.
 * - Cash sale: refund the returned value in cash, split by the original payment currencies.
 * - Credit sale: first reduce the customer's debt by the still-unpaid part of this sale, then refund
 *   the rest in cash (fixes the CATCH POS double refund that both reduced debt and paid cash).
 */
export function planReturn(sale: Sale, request: ReturnRequestLine[], customerDebtUsdCents: Cents): ReturnPlan {
  const quantities = new Map<number, number>();
  const items: SaleReturn['items'] = [];
  let amount = 0;
  let cost = 0;
  let error: ReturnError | null = null;

  // Aggregate by line index first so duplicate indexes cannot bypass remaining-qty checks.
  const requested = new Map<number, number>();
  for (const req of request) {
    const qty = Math.floor(Number(req.quantity));
    if (!qty) continue;
    if (!Number.isFinite(qty) || qty < 0 || !sale.items[req.index]) {
      error = 'invalid';
      continue;
    }
    requested.set(req.index, (requested.get(req.index) ?? 0) + qty);
  }

  for (const [index, qty] of requested) {
    const item = sale.items[index]!;
    const remaining = item.quantity - (item.returnedQty || 0);
    if (qty > remaining) {
      error = 'tooMany';
      continue;
    }
    quantities.set(index, qty);
    items.push({
      productId: item.productId,
      name: item.name,
      quantity: qty,
      unitUsdCents: item.unitUsdCents,
      costUsdCents: item.costUsdCents,
      imei: item.imei,
    });
    amount += item.unitUsdCents * qty;
    cost += item.costUsdCents * qty;
  }
  if (!error && items.length === 0) error = 'empty';

  let debtReduced = 0;
  if (sale.kind === 'credit' && sale.customerId) {
    const unpaidLeft = Math.max(0, (sale.payment.unpaidUsdCents || 0) - (sale.returnedDebtUsdCents || 0));
    debtReduced = Math.max(0, Math.min(amount, unpaidLeft, customerDebtUsdCents));
  }
  const cashPart = amount - debtReduced;
  const { refundUsdCents, refundLbp } = splitRefund(
    cashPart,
    sale.payment.receivedUsdCents,
    sale.payment.receivedLbp,
    sale.exchangeRate,
  );

  return {
    ok: error === null,
    error,
    items,
    quantities,
    amountUsdCents: amount,
    costUsdCents: cost,
    debtReducedUsdCents: debtReduced,
    refundUsdCents,
    refundLbp,
  };
}

export function returnStatusAfter(sale: Sale, quantities: Map<number, number>): Sale['returnStatus'] {
  let any = false;
  let all = true;
  sale.items.forEach((item, i) => {
    const returned = (item.returnedQty || 0) + (quantities.get(i) ?? 0);
    if (returned > 0) any = true;
    if (returned < item.quantity) all = false;
  });
  return all ? 'full' : any ? 'partial' : 'none';
}
