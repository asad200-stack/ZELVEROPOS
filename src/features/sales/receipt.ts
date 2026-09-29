import type { TFunction, Lang } from '@/i18n/i18n';
import type { Sale, SaleReturn, StoreSettings } from '@/types/models';
import { APP_NAME } from '@/constants/app';
import { formatDateTime, formatLbp, formatUsd } from '@/utils/format';
import { escapeHtml as e, printHtml, safeUrl } from '@/utils/html';

interface ReceiptContext {
  settings: StoreSettings;
  lang: Lang;
  t: TFunction;
}

function page(ctx: ReceiptContext, title: string, body: string): string {
  const a4 = ctx.settings.printFormat === 'a4';
  const dir = ctx.lang === 'ar' ? 'rtl' : 'ltr';
  const css = `
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:"Segoe UI",Tahoma,Arial,sans-serif;color:#000;font-size:${a4 ? '12pt' : '11px'};
      width:${a4 ? 'auto' : '72mm'};margin:${a4 ? '0' : '0 auto'};padding:${a4 ? '0' : '2mm'}}
    @page{size:${a4 ? 'A4' : '80mm auto'};margin:${a4 ? '15mm' : '0'}}
    .center{text-align:center}.muted{color:#444}.bold{font-weight:700}
    .logo{max-width:${a4 ? '120px' : '45mm'};max-height:25mm;margin:0 auto 4px;display:block}
    h1{font-size:${a4 ? '18pt' : '15px'};margin-bottom:2px}
    .hr{border-top:1px dashed #000;margin:6px 0}
    table{width:100%;border-collapse:collapse}
    th,td{padding:${a4 ? '6px 4px' : '2px 0'};text-align:start;vertical-align:top}
    ${a4 ? 'th,td{border-bottom:1px solid #ddd}th{background:#f3f3f3}' : ''}
    .num{text-align:end;white-space:nowrap}
    .totals td{padding:2px 0}.grand td{font-weight:700;font-size:${a4 ? '14pt' : '13px'}}
    .small{font-size:${a4 ? '9pt' : '9px'}}
  `;
  return `<!doctype html><html lang="${ctx.lang}" dir="${dir}"><head><meta charset="utf-8"><title>${e(title)}</title><style>${css}</style></head><body>${body}</body></html>`;
}

function header(ctx: ReceiptContext): string {
  const s = ctx.settings;
  const logo = safeUrl(s.logoUrl);
  return `<div class="center">
    ${logo ? `<img class="logo" src="${e(logo)}" alt="">` : ''}
    <h1>${e(s.storeName || APP_NAME)}</h1>
    ${s.storeAddress ? `<div class="muted">${e(s.storeAddress)}</div>` : ''}
    ${s.storePhone ? `<div class="muted">${e(s.storePhone)}</div>` : ''}
  </div><div class="hr"></div>`;
}

function footer(ctx: ReceiptContext): string {
  return `<div class="hr"></div>
    ${ctx.settings.receiptFooter ? `<div class="center">${e(ctx.settings.receiptFooter)}</div>` : ''}
    <div class="center small muted">${e(ctx.t('receipt.thanks'))} · ${e(APP_NAME)}</div>`;
}

export function buildSaleReceipt(sale: Sale, ctx: ReceiptContext): string {
  const { t, lang } = ctx;
  const lbp = sale.currency === 'LBP';
  const money = (usdCents: number, lbpAmount: number) => (lbp ? formatLbp(lbpAmount, lang) : formatUsd(usdCents));
  const rows = sale.items
    .map(
      (i) => `<tr>
        <td>${e(i.name)}${i.imei ? `<div class="small muted">IMEI ${e(i.imei)}</div>` : ''}${
          i.returnedQty ? `<div class="small muted">${e(t('sales.returnedQty', { qty: i.returnedQty }))}</div>` : ''
        }</td>
        <td class="num">${i.quantity}</td>
        <td class="num">${money(i.unitUsdCents, i.unitLbp)}</td>
        <td class="num">${money(i.unitUsdCents * i.quantity, i.unitLbp * i.quantity)}</td>
      </tr>`,
    )
    .join('');

  const p = sale.payment;
  const lines: string[] = [];
  if (sale.discountUsdCents > 0) lines.push(row(t('pos.discount'), formatUsd(sale.discountUsdCents)));
  const grand = `<tr class="grand"><td>${e(t('pos.total'))}</td><td class="num">${money(sale.totalUsdCents, sale.totalLbp)}</td></tr>`;
  if (lbp) lines.push(row(t('receipt.equivalent'), formatUsd(sale.totalUsdCents)));
  if (p.settledPreviousUsdCents > 0) lines.push(row(t('pos.previousBalanceSettled'), formatUsd(p.settledPreviousUsdCents)));
  if (p.receivedUsdCents > 0) lines.push(row(t('receipt.paidUsd'), formatUsd(p.receivedUsdCents)));
  if (p.receivedLbp > 0) lines.push(row(t('receipt.paidLbp'), formatLbp(p.receivedLbp, lang)));
  if (sale.kind === 'credit') {
    lines.push(row(t('receipt.unpaid'), formatUsd(p.unpaidUsdCents)));
    if (p.debtAfterUsdCents !== null) lines.push(row(t('receipt.balanceAfter'), formatUsd(p.debtAfterUsdCents)));
  }
  if (sale.returnedUsdCents > 0) lines.push(row(t('sales.returned'), formatUsd(sale.returnedUsdCents)));

  const body = `${header(ctx)}
    <table class="small"><tr><td>${e(t('receipt.invoice'))}: <span class="bold">${e(sale.invoiceNumber)}</span></td>
      <td class="num">${e(formatDateTime(sale.createdAt, lang))}</td></tr>
      ${sale.customerName ? `<tr><td colspan="2">${e(t('pos.customer'))}: ${e(sale.customerName)}</td></tr>` : ''}
      <tr><td colspan="2">${e(t('receipt.cashier'))}: ${e(sale.createdByName)}</td></tr>
      ${lbp ? `<tr><td colspan="2">${e(t('settings.exchangeRate'))}: ${sale.exchangeRate.toLocaleString('en-US')}</td></tr>` : ''}
    </table>
    <div class="hr"></div>
    <table><thead><tr><th>${e(t('pos.item'))}</th><th class="num">${e(t('pos.qty'))}</th><th class="num">${e(
      t('pos.price'),
    )}</th><th class="num">${e(t('pos.subtotal'))}</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="hr"></div>
    <table class="totals">${grand}${lines.join('')}</table>
    ${footer(ctx)}`;
  return page(ctx, sale.invoiceNumber, body);

  function row(label: string, value: string) {
    return `<tr><td>${e(label)}</td><td class="num">${e(value)}</td></tr>`;
  }
}

export function buildReturnReceipt(ret: SaleReturn, ctx: ReceiptContext): string {
  const { t, lang } = ctx;
  const rows = ret.items
    .map((i) => `<tr><td>${e(i.name)}</td><td class="num">${i.quantity}</td><td class="num">${formatUsd(i.unitUsdCents * i.quantity)}</td></tr>`)
    .join('');
  const body = `${header(ctx)}
    <div class="center bold">${e(t('returns.receiptTitle'))}</div>
    <table class="small"><tr><td>${e(ret.number)} · ${e(ret.saleInvoiceNumber)}</td><td class="num">${e(formatDateTime(ret.createdAt, lang))}</td></tr>
    ${ret.customerName ? `<tr><td colspan="2">${e(t('pos.customer'))}: ${e(ret.customerName)}</td></tr>` : ''}</table>
    <div class="hr"></div>
    <table><tbody>${rows}</tbody></table>
    <div class="hr"></div>
    <table class="totals">
      <tr class="grand"><td>${e(t('returns.amount'))}</td><td class="num">${formatUsd(ret.amountUsdCents)}</td></tr>
      ${ret.debtReducedUsdCents ? `<tr><td>${e(t('returns.debtReduced'))}</td><td class="num">${formatUsd(ret.debtReducedUsdCents)}</td></tr>` : ''}
      ${ret.refundUsdCents ? `<tr><td>${e(t('returns.refundUsd'))}</td><td class="num">${formatUsd(ret.refundUsdCents)}</td></tr>` : ''}
      ${ret.refundLbp ? `<tr><td>${e(t('returns.refundLbp'))}</td><td class="num">${formatLbp(ret.refundLbp, lang)}</td></tr>` : ''}
    </table>
    ${footer(ctx)}`;
  return page(ctx, ret.number, body);
}

export function printSaleReceipt(sale: Sale, ctx: ReceiptContext): void {
  printHtml(buildSaleReceipt(sale, ctx));
}

export function printReturnReceipt(ret: SaleReturn, ctx: ReceiptContext): void {
  printHtml(buildReturnReceipt(ret, ctx));
}
