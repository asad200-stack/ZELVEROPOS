/** Pure message builders (kept free of Firebase imports so they are unit-testable). */

type Data = Record<string, unknown>;

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function usd(cents: number): string {
  return `${(cents / 100).toFixed(2)} USD`;
}

export function lbp(amount: number): string {
  return `${Math.round(amount).toLocaleString('en-US')} LBP`;
}

function signed(text: string, value: number): string {
  return value > 0 ? `+${text}` : text;
}

/** Legacy CATCH POS date format: dd/mm/yyyy h:mm:ss. */
export function formatDate(msValue: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(msValue));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${Number(get('hour')) % 24}:${get('minute')}:${get('second')}`;
}

function header(title: string, d: Data, timeZone: string): string[] {
  return [`🔔 ${title}`, `👤 Seller: ${str(d.createdByName) || '-'}`, `📅 ${formatDate(num(d.createdAtMs) || Date.now(), timeZone)}`];
}

function moneyPair(usdCents: number, lbpAmount: number, withSign = true): string {
  const parts: string[] = [];
  if (usdCents) parts.push(withSign ? signed(usd(usdCents), usdCents) : usd(usdCents));
  if (lbpAmount) parts.push(withSign ? signed(lbp(lbpAmount), lbpAmount) : lbp(lbpAmount));
  return parts.length ? parts.join(' / ') : usd(0);
}

export function saleMessage(d: Data, timeZone: string): string {
  const items = Array.isArray(d.items) ? (d.items as Data[]) : [];
  const payment = (d.payment ?? {}) as Data;
  const total = num(d.totalUsdCents);
  const lines = header(d.kind === 'credit' ? 'New credit sale' : 'New sale', d, timeZone);
  lines.push(`📄 Invoice: ${str(d.invoiceNumber)}`);
  if (str(d.customerName)) lines.push(`👥 Customer: ${str(d.customerName)}`);
  lines.push('🛒 Products:');
  for (const item of items.slice(0, 30)) {
    const qty = num(item.quantity);
    lines.push(`  • ${str(item.name)} × ${qty} = ${usd(qty * num(item.unitUsdCents))}${item.imei ? ` (IMEI ${str(item.imei)})` : ''}`);
  }
  if (items.length > 30) lines.push(`  … +${items.length - 30}`);
  lines.push(`💰 Total: ${usd(total)}`);
  if (num(d.discountUsdCents) > 0) lines.push(`💸 Discount: ${usd(num(d.discountUsdCents))}`);
  lines.push(`📈 Profit: ${usd(total - num(d.costUsdCents))}`);
  const received = num(payment.receivedUsdCents);
  const receivedLbp = num(payment.receivedLbp);
  if (received || receivedLbp) lines.push(`💵 Received: ${moneyPair(received, receivedLbp, false)}`);
  if (num(payment.unpaidUsdCents) > 0) lines.push(`⏳ Unpaid: ${usd(num(payment.unpaidUsdCents))}`);
  if (typeof payment.debtAfterUsdCents === 'number') lines.push(`🧾 Customer debt: ${usd(payment.debtAfterUsdCents)}`);
  if (d.offline === true) lines.push('📶 Recorded offline');
  return lines.join('\n');
}

export function returnMessage(d: Data, timeZone: string): string {
  const items = Array.isArray(d.items) ? (d.items as Data[]) : [];
  const lines = header(`Return ${str(d.number)}`, d, timeZone);
  lines.push(`📄 Invoice: ${str(d.saleInvoiceNumber)}`);
  if (str(d.customerName)) lines.push(`👥 Customer: ${str(d.customerName)}`);
  lines.push('🛒 Products:');
  for (const item of items.slice(0, 30)) lines.push(`  • ${str(item.name)} × ${num(item.quantity)}`);
  lines.push(`💰 Total: ${usd(num(d.amountUsdCents))}`);
  const refund = num(d.refundUsdCents);
  const refundLbp = num(d.refundLbp);
  if (refund || refundLbp) lines.push(`💵 Refunded: ${moneyPair(refund, refundLbp, false)}`);
  if (num(d.debtReducedUsdCents) > 0) lines.push(`🧾 Debt reduced: ${usd(num(d.debtReducedUsdCents))}`);
  if (str(d.reason)) lines.push(`📝 ${str(d.reason)}`);
  return lines.join('\n');
}

const CASH_TITLES: Record<string, string> = {
  deposit: 'Cash deposit',
  expense: 'Expense',
  withdrawal: 'Cash withdrawal',
  adjustment: 'Drawer adjustment',
  supplierPayment: 'Supplier payment',
  debtPayment: 'Debt payment',
};

/** Cash types reported under the "cash" event (sales and refunds have their own messages). */
export const NOTIFIED_CASH_TYPES = Object.keys(CASH_TITLES);

export function cashMessage(d: Data, timeZone: string): string {
  const type = str(d.type);
  const usdCents = num(d.usdCents);
  const lbpAmount = num(d.lbp);
  const lines = header(CASH_TITLES[type] ?? type, d, timeZone);
  if (type === 'supplierPayment') lines.push(`🏭 Supplier: ${str(d.note).split(' · ')[0] || '-'}`);
  if (d.refNumber) lines.push(`📄 ${str(d.refNumber)}`);
  const after = d.balanceAfter as Data | null | undefined;
  if (after) lines.push(`💵 Before: ${usd(num(after.usdCents) - usdCents)} / ${lbp(num(after.lbp) - lbpAmount)}`);
  lines.push(`➕ Changed: ${moneyPair(usdCents, lbpAmount)}`);
  if (after) lines.push(`💰 After: ${usd(num(after.usdCents))} / ${lbp(num(after.lbp))}`);
  if (str(d.category) && str(d.category) !== type) lines.push(`🏷 ${str(d.category)}`);
  if (str(d.note) && type !== 'supplierPayment') lines.push(`📝 ${str(d.note)}`);
  return lines.join('\n');
}

export function onlineOrderMessage(d: Data, timeZone: string): string {
  const items = Array.isArray(d.lines) ? (d.lines as Data[]) : [];
  const delivery = d.fulfillment === 'delivery';
  const lines = [`🛍️ New online order ${str(d.ref)}`, `📅 ${formatDate(num(d.createdAtMs) || Date.now(), timeZone)}`];
  lines.push(`👥 Customer: ${str(d.customerName) || '-'} · ${str(d.customerPhone) || '-'}`);
  lines.push(delivery ? `🚚 Delivery${str(d.deliveryZone) ? ` (${str(d.deliveryZone)})` : ''}` : '🏪 Pickup from the shop');
  if (delivery && str(d.address)) lines.push(`📍 ${str(d.address)}`);
  lines.push('🛒 Products:');
  for (const item of items.slice(0, 30)) {
    const usdCents = num(item.lineUsdCents);
    lines.push(`  • ${str(item.name)} × ${num(item.qty)} = ${usdCents ? usd(usdCents) : lbp(num(item.lineLbp))}`);
  }
  if (items.length > 30) lines.push(`  … +${items.length - 30}`);
  if (num(d.deliveryFeeUsdCents) > 0) lines.push(`🚚 Delivery fee: ${usd(num(d.deliveryFeeUsdCents))}`);
  lines.push(`💰 Total: ${moneyPair(num(d.totalUsdCents), num(d.totalLbp), false)}`);
  lines.push(d.payment === 'whish' ? '💳 Whish Money (waiting for payment)' : '💵 Cash on delivery / at pickup');
  if (str(d.note)) lines.push(`📝 ${str(d.note)}`);
  return lines.join('\n');
}

export function lowStockMessage(name: string, stock: number, threshold: number): string {
  return [`⚠️ Low stock`, `📦 ${name}`, `📉 Stock: ${stock} (alert at ${threshold})`].join('\n');
}

/** True when a product crossed its low-stock threshold with this update. */
export function crossedLowStock(before: number, after: number, threshold: number): boolean {
  return before > threshold && after <= threshold;
}
