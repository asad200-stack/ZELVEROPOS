/**
 * Milestone B business insights, computed only from the signed-in store's records
 * (via the server-enforced copilot read path).
 *
 * Rules:
 * - Missing cost is never zero: profit and stock value appear only where cost is recorded.
 * - Forecasts and reorder quantities are estimates from observed sales velocity; every answer states
 *   the window, the assumptions, and what the records cannot show.
 * - USD and LBP are never added together. LBP-priced sales are left out of USD figures and said so.
 */
import { addDays, localDate } from '@/domain/dates';
import type { AiLang } from '../engine';
import { AI_LIST_CAP, type ReadSession } from '../readSnapshot';
import type { CatalogItem, CostedSale, InsightSource, PurchaseRow } from '../serverReadSource';
import type { PeriodSpec } from './memory';
import { periodName } from './periodCompare';
import { previousPeriod } from './tools';

export type InsightKind = 'bestProfit' | 'slowMovers' | 'stockout' | 'reorder' | 'trends' | 'suppliers' | 'expiryRisk';

export interface InsightSpec {
  kind: InsightKind;
  /** Sales period for bestProfit / trends / suppliers. Velocity insights use `velocityDays`. */
  period: PeriodSpec;
  limit: number;
}

export interface InsightResult {
  status: 'ok' | 'denied' | 'unavailable';
  lang: AiLang;
  text: string;
  consultModel: boolean;
  executes: false;
}

/** Observed-sales window for velocity, cover, and reorder estimates. */
export const VELOCITY_DAYS = 28;
export const STOCKOUT_HORIZON_DAYS = 14;
export const SLOW_COVER_DAYS = 90;
/** Reorder assumptions, stated in every answer. No supplier lead time is recorded in the POS. */
export const ASSUMED_LEAD_DAYS = 7;
export const TARGET_COVER_DAYS = 14;
export const SAFETY_DAYS = 3;
export const MIN_UNITS_FOR_ESTIMATE = 3;
export const EXPIRY_RISK_DAYS = 30;

const LRI = '⁦';
const PDI = '⁩';

function usd(cents: number, lang: AiLang): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const text = `${sign}$${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')} USD`;
  return lang === 'ar' ? `${LRI}${text}${PDI}` : text;
}

function oneDecimal(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

function netUnits(line: { quantity: number; returnedQty: number }): number {
  return Math.max(0, Math.round(line.quantity) - Math.max(0, Math.round(line.returnedQty)));
}

const L = (lang: AiLang, en: string, ar: string) => (lang === 'ar' ? ar : en);

function done(status: InsightResult['status'], lang: AiLang, lines: string[], consultModel = true): InsightResult {
  return { status, lang, text: lines.join('\n'), consultModel, executes: false };
}

function denied(lang: AiLang, en: string, ar: string): InsightResult {
  return done('denied', lang, [L(lang, en, ar)], false);
}

/* ------------------------------------------------------------------ shared aggregation */

interface ProductSales {
  productId: string;
  name: string;
  units: number;
  usdRevenue: number;
  usdCost: number;
  costVerified: boolean;
  lbpUnits: number;
}

/** Per-product sales from costed lines. A line's cost counts only if it was stored and is not an unexplained zero. */
export function aggregateSales(sales: CostedSale[], catalog: Map<string, CatalogItem>): Map<string, ProductSales> {
  const out = new Map<string, ProductSales>();
  const seen = new Set<string>();
  for (const sale of sales) {
    if (seen.has(sale.id)) continue;
    seen.add(sale.id);
    for (const line of sale.lines) {
      if (!line.productId) continue;
      const units = netUnits(line);
      const row = out.get(line.productId) ?? { productId: line.productId, name: line.name, units: 0, usdRevenue: 0, usdCost: 0, costVerified: true, lbpUnits: 0 };
      row.name = line.name || row.name;
      if (sale.currency === 'LBP') {
        row.lbpUnits += units;
        out.set(line.productId, row);
        continue;
      }
      row.units += units;
      row.usdRevenue += units * line.unitUsdCents;
      const product = catalog.get(line.productId);
      const zeroIsReal = product?.costUsdCents === 0;
      if (line.costUsdCents === null || (line.costUsdCents === 0 && !zeroIsReal)) row.costVerified = false;
      else row.usdCost += units * line.costUsdCents;
      out.set(line.productId, row);
    }
  }
  return out;
}

function velocityWindow(now: Date): PeriodSpec {
  const today = localDate(now);
  return { from: addDays(today, -(VELOCITY_DAYS - 1)), to: today, label: 'custom' };
}

function windowLine(lang: AiLang, window: PeriodSpec, salesComplete: boolean, catalogComplete: boolean): string[] {
  const lines = [
    L(
      lang,
      `Based on recorded sales from ${window.from} to ${window.to} (${VELOCITY_DAYS} days).`,
      `مبني على المبيعات المسجّلة من ${LRI}${window.from}${PDI} لـ ${LRI}${window.to}${PDI} (${VELOCITY_DAYS} يوم).`,
    ),
  ];
  if (!salesComplete) lines.push(L(lang, 'Sales history for this window is longer than one read, so the newest sales may be missing.', 'سجل المبيعات لهالفترة أكبر من قراءة وحدة، فممكن تكون آخر المبيعات ناقصة.'));
  if (!catalogComplete) lines.push(L(lang, 'The product list is longer than one read, so some products are not checked.', 'لائحة المنتجات أكبر من قراءة وحدة، فبعض المنتجات ما انفحصت.'));
  return lines;
}

/* ------------------------------------------------------------------ insights */

async function bestProfit(session: ReadSession, spec: InsightSpec, src: InsightSource, lang: AiLang): Promise<InsightResult> {
  if (!session.can('canViewSales') || !session.can('canViewCosts')) {
    return denied(lang, 'Profit by product needs permission to view sales and costs.', 'الربح حسب المنتج بدّه صلاحية تشوف المبيعات والكلفة.');
  }
  const [{ sales, complete }, catalog] = await Promise.all([src.costedSales(spec.period.from, spec.period.to), src.catalog()]);
  const byId = new Map(catalog.items.map((p) => [p.id, p]));
  const rows = [...aggregateSales(sales, byId).values()].filter((r) => r.units > 0);
  const out = [L(lang, `Best sellers by verified profit, ${periodName(spec.period, lang)}:`, `الأكثر ربحاً (ربح مؤكّد)، ${periodName(spec.period, lang)}:`)];
  if (rows.length === 0) {
    out.push(L(lang, 'No USD sales were recorded in this period.', 'ما في مبيعات بالدولار مسجّلة بهالفترة.'));
    return done('ok', lang, out);
  }
  const verified = rows.filter((r) => r.costVerified).map((r) => ({ ...r, profit: r.usdRevenue - r.usdCost })).sort((a, b) => b.profit - a.profit);
  const unverified = rows.filter((r) => !r.costVerified).sort((a, b) => b.usdRevenue - a.usdRevenue);
  verified.slice(0, spec.limit).forEach((r, i) => {
    const margin = r.usdRevenue > 0 ? ` (${oneDecimal((100 * (r.usdRevenue - r.usdCost)) / r.usdRevenue)}%)` : '';
    out.push(
      L(
        lang,
        `${i + 1}. «${r.name}» — profit ${usd(r.profit, lang)}${margin} on ${usd(r.usdRevenue, lang)} sales, ${r.units} units.`,
        `${i + 1}. «${r.name}» — ربح ${usd(r.profit, lang)}${margin} من مبيعات ${usd(r.usdRevenue, lang)}، ${r.units} وحدة.`,
      ),
    );
  });
  if (verified.length === 0) out.push(L(lang, 'No product has a verified cost on every sale in this period.', 'ما في منتج كلفته مسجّلة على كل مبيعاته بهالفترة.'));
  if (unverified.length > 0) {
    const names = unverified.slice(0, 5).map((r) => `«${r.name}»`).join(lang === 'ar' ? '، ' : ', ');
    out.push(
      L(
        lang,
        `Profit not verified (cost missing on some sales, not counted as zero): ${names}${unverified.length > 5 ? ` and ${unverified.length - 5} more` : ''}.`,
        `ربح مش مؤكّد (كلفة ناقصة على بعض المبيعات، وما انحسبت صفر): ${names}${unverified.length > 5 ? ` و${unverified.length - 5} غيرهن` : ''}.`,
      ),
    );
  }
  if (rows.some((r) => r.lbpUnits > 0)) out.push(L(lang, 'Sales made in LBP are not included in these USD figures.', 'المبيعات بالليرة مش داخلة بهالأرقام بالدولار.'));
  if (!complete) out.push(L(lang, 'This period has more sales than one read, so the ranking may be incomplete.', 'بهالفترة مبيعات أكتر من قراءة وحدة، فالترتيب ممكن يكون ناقص.'));
  return done('ok', lang, out);
}

interface Velocity {
  item: CatalogItem;
  units: number;
  perDay: number;
  cover: number | null;
}

async function velocities(src: InsightSource, now: Date) {
  const window = velocityWindow(now);
  const [{ sales, complete: salesComplete }, catalog] = await Promise.all([src.costedSales(window.from, window.to), src.catalog()]);
  const byId = new Map(catalog.items.map((p) => [p.id, p]));
  const agg = aggregateSales(sales, byId);
  const rows: Velocity[] = catalog.items.map((item) => {
    const s = agg.get(item.id);
    const units = (s?.units ?? 0) + (s?.lbpUnits ?? 0);
    const perDay = units / VELOCITY_DAYS;
    return { item, units, perDay, cover: perDay > 0 ? item.stock / perDay : null };
  });
  return { window, rows, salesComplete, catalogComplete: catalog.complete };
}

async function stockout(session: ReadSession, spec: InsightSpec, src: InsightSource, lang: AiLang, now: Date): Promise<InsightResult> {
  if (!session.can('canViewProducts') || !session.can('canViewSales')) {
    return denied(lang, 'Stock forecasts need permission to view products and sales.', 'توقّع المخزون بدّه صلاحية تشوف المنتجات والمبيعات.');
  }
  const { window, rows, salesComplete, catalogComplete } = await velocities(src, now);
  const today = localDate(now);
  const out = [L(lang, `Products likely to run out within ${STOCKOUT_HORIZON_DAYS} days at the recent selling rate:`, `منتجات ممكن تخلص خلال ${STOCKOUT_HORIZON_DAYS} يوم حسب سرعة البيع الأخيرة:`)];
  const soon = rows
    .filter((r) => r.units >= MIN_UNITS_FOR_ESTIMATE && r.item.stock > 0 && r.cover !== null && r.cover <= STOCKOUT_HORIZON_DAYS)
    .sort((a, b) => (a.cover ?? 0) - (b.cover ?? 0));
  const already = rows.filter((r) => r.item.stock <= 0 && r.units > 0).sort((a, b) => b.perDay - a.perDay);
  soon.slice(0, spec.limit).forEach((r, i) => {
    const days = Math.max(0, Math.floor(r.cover!));
    out.push(
      L(
        lang,
        `${i + 1}. «${r.item.name}» — ${r.item.stock} left, selling about ${oneDecimal(r.perDay)}/day → about ${days} day(s) (around ${addDays(today, days)}).`,
        `${i + 1}. «${r.item.name}» — باقي ${r.item.stock}، عم ينباع تقريباً ${oneDecimal(r.perDay)} باليوم → تقريباً ${days} يوم (حوالي ${LRI}${addDays(today, days)}${PDI}).`,
      ),
    );
  });
  if (soon.length === 0) out.push(L(lang, 'None at the current rate.', 'ولا منتج بالسرعة الحالية.'));
  if (already.length > 0) {
    out.push(
      L(
        lang,
        `Already out of stock but selling recently: ${already.slice(0, 5).map((r) => `«${r.item.name}» (~${oneDecimal(r.perDay)}/day)`).join(', ')}.`,
        `خلصانين وعم ينطلبوا مؤخراً: ${already.slice(0, 5).map((r) => `«${r.item.name}» (~${oneDecimal(r.perDay)} باليوم)`).join('، ')}.`,
      ),
    );
  }
  out.push(...windowLine(lang, window, salesComplete, catalogComplete));
  out.push(
    L(
      lang,
      `This is an estimate: it assumes sales continue at the same average and ignores restocks not yet recorded. Products with fewer than ${MIN_UNITS_FOR_ESTIMATE} units sold are not forecast.`,
      `هيدا تقدير: بيفترض إنو البيع بيضل بنفس المعدّل، وما بيحسب بضاعة جايي مش مسجّلة. المنتجات يلي انباع منها أقل من ${MIN_UNITS_FOR_ESTIMATE} ما إلها توقّع.`,
    ),
  );
  return done('ok', lang, out);
}

async function reorder(session: ReadSession, spec: InsightSpec, src: InsightSource, lang: AiLang, now: Date): Promise<InsightResult> {
  if (!session.can('canViewProducts') || !session.can('canViewSales')) {
    return denied(lang, 'Reorder suggestions need permission to view products and sales.', 'اقتراحات الطلب بدّها صلاحية تشوف المنتجات والمبيعات.');
  }
  const { window, rows, salesComplete, catalogComplete } = await velocities(src, now);
  const horizon = ASSUMED_LEAD_DAYS + TARGET_COVER_DAYS + SAFETY_DAYS;
  const showCost = session.can('canViewCosts');
  const picks = rows
    .filter((r) => r.units >= MIN_UNITS_FOR_ESTIMATE)
    .map((r) => {
      const target = Math.ceil(r.perDay * horizon);
      return { ...r, target, qty: Math.max(0, target - Math.max(0, r.item.stock)) };
    })
    .filter((r) => r.qty > 0)
    .sort((a, b) => (a.cover ?? 0) - (b.cover ?? 0));
  const out = [L(lang, 'Suggested reorder quantities (estimates):', 'كميات مقترحة للطلب (تقديرية):')];
  let knownCost = 0;
  let unknownCost = 0;
  picks.slice(0, spec.limit).forEach((r, i) => {
    const cost = showCost && r.item.costUsdCents !== null ? r.qty * r.item.costUsdCents : null;
    if (cost !== null) knownCost += cost;
    else unknownCost += 1;
    const costText = !showCost ? '' : cost !== null ? L(lang, ` ≈ ${usd(cost, lang)} at the recorded cost`, ` ≈ ${usd(cost, lang)} بالكلفة المسجّلة`) : L(lang, ' (cost not recorded)', ' (الكلفة مش مسجّلة)');
    const supplier = r.item.supplierName ? L(lang, `, supplier ${r.item.supplierName}`, `، المورد ${r.item.supplierName}`) : '';
    out.push(
      L(
        lang,
        `${i + 1}. «${r.item.name}» — order about ${r.qty} (stock ${r.item.stock}, selling ~${oneDecimal(r.perDay)}/day${supplier})${costText}.`,
        `${i + 1}. «${r.item.name}» — اطلب تقريباً ${r.qty} (المخزون ${r.item.stock}، عم ينباع ~${oneDecimal(r.perDay)} باليوم${supplier})${costText}.`,
      ),
    );
  });
  if (picks.length === 0) out.push(L(lang, 'Nothing needs reordering at the recent selling rate.', 'ما في شي لازم ينطلب حسب سرعة البيع الأخيرة.'));
  if (showCost && knownCost > 0) {
    out.push(
      L(
        lang,
        `Estimated cost of the listed orders with a recorded cost: ${usd(knownCost, lang)}${unknownCost ? ` (${unknownCost} item(s) without a recorded cost are not included)` : ''}.`,
        `الكلفة التقديرية للطلبات يلي كلفتها مسجّلة: ${usd(knownCost, lang)}${unknownCost ? ` (${unknownCost} منتج بلا كلفة مسجّلة مش محسوبين)` : ''}.`,
      ),
    );
  }
  out.push(...windowLine(lang, window, salesComplete, catalogComplete));
  out.push(
    L(
      lang,
      `Assumptions: ${ASSUMED_LEAD_DAYS}-day supplier lead time (not recorded in the POS), ${TARGET_COVER_DAYS} days of stock after delivery, ${SAFETY_DAYS} days of safety stock. Purchases are recorded when received, so no open orders are subtracted. Adjust for promotions, seasons, or supplier minimums.`,
      `الافتراضات: المورد بيسلّم خلال ${ASSUMED_LEAD_DAYS} أيام (مش مسجّل بالنظام)، ${TARGET_COVER_DAYS} يوم مخزون بعد الاستلام، و${SAFETY_DAYS} أيام احتياط. المشتريات بتتسجّل وقت الاستلام، فما في طلبيات مفتوحة انطرحت. عدّل حسب العروض، المواسم، أو الحد الأدنى للمورد.`,
    ),
  );
  return done('ok', lang, out);
}

async function slowMovers(session: ReadSession, spec: InsightSpec, src: InsightSource, lang: AiLang, now: Date): Promise<InsightResult> {
  if (!session.can('canViewProducts') || !session.can('canViewSales')) {
    return denied(lang, 'Slow-moving stock needs permission to view products and sales.', 'البضاعة الواقفة بدّها صلاحية تشوف المنتجات والمبيعات.');
  }
  const { window, rows, salesComplete, catalogComplete } = await velocities(src, now);
  const showCost = session.can('canViewCosts');
  const value = (r: Velocity) => (r.item.costUsdCents !== null ? r.item.stock * r.item.costUsdCents : null);
  const rank = (a: Velocity, b: Velocity) => (value(b) ?? -1) - (value(a) ?? -1) || b.item.stock - a.item.stock;
  const dead = rows.filter((r) => r.item.stock > 0 && r.units === 0).sort(rank);
  const slow = rows.filter((r) => r.item.stock > 0 && r.units > 0 && r.cover !== null && r.cover > SLOW_COVER_DAYS).sort(rank);
  const out = [L(lang, 'Slow-moving and dead stock:', 'البضاعة الواقفة والبطيئة:')];
  const fmt = (r: Velocity, i: number) => {
    const v = value(r);
    const valueText = !showCost ? '' : v !== null ? L(lang, `, ${usd(v, lang)} at cost`, `، ${usd(v, lang)} بالكلفة`) : L(lang, ', cost not recorded', '، الكلفة مش مسجّلة');
    const sold = r.units === 0 ? L(lang, 'no sales', 'ولا بيعة') : L(lang, `${r.units} sold (~${Math.round(r.cover!)} days of stock)`, `انباع ${r.units} (~${Math.round(r.cover!)} يوم مخزون)`);
    return L(lang, `${i + 1}. «${r.item.name}» — ${r.item.stock} in stock, ${sold}${valueText}.`, `${i + 1}. «${r.item.name}» — ${r.item.stock} بالمخزون، ${sold}${valueText}.`);
  };
  if (dead.length) {
    out.push(L(lang, `No sales in the last ${VELOCITY_DAYS} days (${dead.length}):`, `ما انباع منهن شي آخر ${VELOCITY_DAYS} يوم (${dead.length}):`));
    dead.slice(0, spec.limit).forEach((r, i) => out.push(fmt(r, i)));
  }
  if (slow.length) {
    out.push(L(lang, `Selling, but more than ${SLOW_COVER_DAYS} days of stock at the current rate (${slow.length}):`, `عم ينباعوا بس عندك أكتر من ${SLOW_COVER_DAYS} يوم مخزون بالسرعة الحالية (${slow.length}):`));
    slow.slice(0, spec.limit).forEach((r, i) => out.push(fmt(r, i)));
  }
  if (!dead.length && !slow.length) out.push(L(lang, 'No slow-moving stock found.', 'ما في بضاعة واقفة.'));
  if (showCost && dead.concat(slow).some((r) => r.item.costUsdCents === null)) {
    out.push(L(lang, 'Items without a recorded cost have no stock value; it is not counted as zero.', 'المنتجات بلا كلفة مسجّلة ما إلها قيمة مخزون، وما انحسبت صفر.'));
  }
  out.push(...windowLine(lang, window, salesComplete, catalogComplete));
  out.push(L(lang, 'Products added recently may appear here only because they have not had time to sell.', 'المنتجات الجديدة ممكن تطلع هون بس لأنو ما أخدت وقت تنباع.'));
  return done('ok', lang, out);
}

async function trends(session: ReadSession, spec: InsightSpec, src: InsightSource, lang: AiLang): Promise<InsightResult> {
  if (!session.can('canViewSales')) return denied(lang, 'Product trends need permission to view sales.', 'اتجاهات المنتجات بدّها صلاحية تشوف المبيعات.');
  const previous = previousPeriod(spec.period);
  const [cur, prev, catalog] = await Promise.all([src.costedSales(spec.period.from, spec.period.to), src.costedSales(previous.from, previous.to), src.catalog()]);
  const byId = new Map(catalog.items.map((p) => [p.id, p]));
  const a = aggregateSales(cur.sales, byId);
  const b = aggregateSales(prev.sales, byId);
  const ids = new Set([...a.keys(), ...b.keys()]);
  const changes = [...ids].map((id) => {
    const x = a.get(id);
    const y = b.get(id);
    return { name: x?.name ?? y?.name ?? id, now: x?.units ?? 0, before: y?.units ?? 0 };
  });
  const out = [L(lang, `Product trends: ${periodName(spec.period, lang)} vs ${periodName(previous, lang)} (units sold, USD sales).`, `اتجاه المنتجات: ${periodName(spec.period, lang)} مقابل ${periodName(previous, lang)} (وحدات مبيعة، مبيعات بالدولار).`)];
  if (changes.every((c) => c.now === 0 && c.before === 0)) {
    out.push(L(lang, 'No USD sales were recorded in either period.', 'ما في مبيعات بالدولار بالفترتين.'));
    return done('ok', lang, out);
  }
  const fmt = (c: (typeof changes)[number]) => `«${c.name}» ${c.before} → ${c.now}`;
  const up = changes.filter((c) => c.now > c.before).sort((x, y) => y.now - y.before - (x.now - x.before)).slice(0, spec.limit);
  const down = changes.filter((c) => c.now < c.before).sort((x, y) => x.now - x.before - (y.now - y.before)).slice(0, spec.limit);
  out.push(up.length ? L(lang, `Rising: ${up.map(fmt).join('; ')}.`, `عم يطلعوا: ${up.map(fmt).join('؛ ')}.`) : L(lang, 'No product sold more units than before.', 'ولا منتج انباع منه أكتر من قبل.'));
  out.push(down.length ? L(lang, `Falling: ${down.map(fmt).join('; ')}.`, `عم ينزلوا: ${down.map(fmt).join('؛ ')}.`) : L(lang, 'No product sold fewer units than before.', 'ولا منتج انباع منه أقل من قبل.'));
  if (!cur.complete || !prev.complete) out.push(L(lang, 'One of the periods has more sales than one read, so some changes may be missing.', 'وحدة من الفترتين فيها مبيعات أكتر من قراءة وحدة، فممكن يكون في تغييرات ناقصة.'));
  out.push(L(lang, 'Small numbers can swing a lot; a change of a few units is not necessarily a trend.', 'الأرقام الصغيرة بتتغيّر بسرعة؛ فرق كم وحدة مش دايماً اتجاه.'));
  return done('ok', lang, out);
}

async function suppliers(session: ReadSession, spec: InsightSpec, src: InsightSource, lang: AiLang): Promise<InsightResult> {
  if (!session.can('canViewSuppliers') || !session.can('canViewCosts')) {
    return denied(lang, 'Supplier insights need permission to view suppliers and costs.', 'تحليل الموردين بدّه صلاحية تشوف الموردين والكلفة.');
  }
  const [purchases, list] = await Promise.all([src.purchases(spec.period.from, spec.period.to), src.suppliers()]);
  const out = [L(lang, `Purchases and suppliers, ${periodName(spec.period, lang)}:`, `المشتريات والموردين، ${periodName(spec.period, lang)}:`)];
  const by = new Map<string, { name: string; count: number; net: number; paid: number; remaining: number }>();
  for (const p of purchases.items) {
    const key = p.supplierId || p.supplierName;
    const row = by.get(key) ?? { name: p.supplierName || key, count: 0, net: 0, paid: 0, remaining: 0 };
    row.count += 1;
    row.net += p.totalUsdCents - p.returnedUsdCents;
    row.paid += p.paidUsdCents;
    row.remaining += p.remainingUsdCents;
    by.set(key, row);
  }
  const spend = [...by.values()].sort((a, b) => b.net - a.net);
  if (spend.length === 0) out.push(L(lang, 'No purchases were recorded in this period.', 'ما في مشتريات مسجّلة بهالفترة.'));
  spend.slice(0, spec.limit).forEach((s, i) =>
    out.push(
      L(
        lang,
        `${i + 1}. ${s.name} — ${s.count} purchase(s), ${usd(s.net, lang)} after returns, ${usd(s.paid, lang)} paid, ${usd(s.remaining, lang)} still due.`,
        `${i + 1}. ${s.name} — ${s.count} فاتورة، ${usd(s.net, lang)} بعد المرتجعات، مدفوع ${usd(s.paid, lang)}، باقي ${usd(s.remaining, lang)}.`,
      ),
    ),
  );
  const owed = list.items.filter((s) => s.balanceUsdCents > 0).sort((a, b) => b.balanceUsdCents - a.balanceUsdCents);
  if (owed.length) {
    out.push(
      L(
        lang,
        `Open balances owed to suppliers now: ${owed.slice(0, 5).map((s) => `${s.name} ${usd(s.balanceUsdCents, lang)}`).join('; ')}.`,
        `الأرصدة المفتوحة للموردين هلّق: ${owed.slice(0, 5).map((s) => `${s.name} ${usd(s.balanceUsdCents, lang)}`).join('؛ ')}.`,
      ),
    );
  }
  const increases = costIncreases(purchases.items).slice(0, 5);
  if (increases.length) {
    out.push(
      L(
        lang,
        `Unit cost went up in this period: ${increases.map((c) => `«${c.name}» ${usd(c.first, lang)} → ${usd(c.last, lang)}`).join('; ')}.`,
        `الكلفة غليت بهالفترة: ${increases.map((c) => `«${c.name}» ${usd(c.first, lang)} → ${usd(c.last, lang)}`).join('؛ ')}.`,
      ),
    );
  }
  if (!purchases.complete || !list.complete) out.push(L(lang, 'Some purchases or suppliers were beyond one read and are not included.', 'في مشتريات أو موردين أكتر من قراءة وحدة، مش داخلين.'));
  return done('ok', lang, out);
}

/** First vs last recorded unit cost per product, within the period's purchases (date order). */
export function costIncreases(purchases: PurchaseRow[]): Array<{ name: string; first: number; last: number }> {
  const seen = new Map<string, { name: string; first: number; last: number }>();
  for (const p of [...purchases].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const i of p.items) {
      if (!i.productId || i.unitCostUsdCents <= 0) continue;
      const row = seen.get(i.productId);
      if (!row) seen.set(i.productId, { name: i.name, first: i.unitCostUsdCents, last: i.unitCostUsdCents });
      else row.last = i.unitCostUsdCents;
    }
  }
  return [...seen.values()].filter((r) => r.last > r.first).sort((a, b) => (b.last - b.first) / b.first - (a.last - a.first) / a.first);
}

async function expiryRisk(session: ReadSession, spec: InsightSpec, src: InsightSource, lang: AiLang, now: Date): Promise<InsightResult> {
  if (!session.can('canViewProducts')) return denied(lang, 'Expiry insights need permission to view products.', 'تحليل الصلاحية بدّه صلاحية تشوف المنتجات.');
  const { window, rows, salesComplete, catalogComplete } = await velocities(src, now);
  const today = localDate(now);
  const until = addDays(today, EXPIRY_RISK_DAYS);
  const showCost = session.can('canViewCosts');
  const out = [L(lang, 'Expiry and possible waste:', 'الصلاحية والخسارة المحتملة:')];
  const expired = rows.filter((r) => r.item.expiryDate && r.item.expiryDate < today && r.item.stock > 0);
  const soon = rows
    .filter((r) => r.item.expiryDate && r.item.expiryDate >= today && r.item.expiryDate <= until && r.item.stock > 0)
    .map((r) => {
      const daysLeft = Math.max(0, Math.round((Date.parse(`${r.item.expiryDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000));
      const expected = Math.floor(r.perDay * daysLeft);
      return { ...r, daysLeft, atRisk: Math.max(0, r.item.stock - expected) };
    })
    .filter((r) => r.atRisk > 0)
    .sort((a, b) => a.daysLeft - b.daysLeft);
  const value = (units: number, item: CatalogItem) =>
    !showCost ? '' : item.costUsdCents !== null ? L(lang, ` (${usd(units * item.costUsdCents, lang)} at cost)`, ` (${usd(units * item.costUsdCents, lang)} بالكلفة)`) : L(lang, ' (cost not recorded)', ' (الكلفة مش مسجّلة)');
  if (expired.length) {
    out.push(L(lang, `Already expired with stock left (${expired.length}):`, `منتهي الصلاحية وبعدو بالمخزون (${expired.length}):`));
    expired.slice(0, spec.limit).forEach((r, i) =>
      out.push(L(lang, `${i + 1}. «${r.item.name}» — ${r.item.stock} units, expired ${r.item.expiryDate}${value(r.item.stock, r.item)}.`, `${i + 1}. «${r.item.name}» — ${r.item.stock} وحدة، انتهى ${LRI}${r.item.expiryDate}${PDI}${value(r.item.stock, r.item)}.`)),
    );
  }
  if (soon.length) {
    out.push(L(lang, `Likely not to sell before expiry in the next ${EXPIRY_RISK_DAYS} days (${soon.length}):`, `ممكن ما ينباعوا قبل ما تنتهي صلاحيتهن خلال ${EXPIRY_RISK_DAYS} يوم (${soon.length}):`));
    soon.slice(0, spec.limit).forEach((r, i) =>
      out.push(
        L(
          lang,
          `${i + 1}. «${r.item.name}» — expires ${r.item.expiryDate} (${r.daysLeft} days), ${r.item.stock} in stock, about ${r.atRisk} may be left over${value(r.atRisk, r.item)}.`,
          `${i + 1}. «${r.item.name}» — بتنتهي ${LRI}${r.item.expiryDate}${PDI} (${r.daysLeft} يوم)، ${r.item.stock} بالمخزون، تقريباً ${r.atRisk} ممكن يضلّوا${value(r.atRisk, r.item)}.`,
        ),
      ),
    );
  }
  if (!expired.length && !soon.length) out.push(L(lang, 'No expired stock and nothing at risk in the next 30 days.', 'ما في بضاعة منتهية ولا شي بخطر خلال ٣٠ يوم.'));
  if (!rows.some((r) => r.item.expiryDate)) out.push(L(lang, 'No product has an expiry date recorded, so expiry cannot be checked.', 'ما في منتج مسجّل إلو تاريخ صلاحية، فما فيني افحص.'));
  out.push(...windowLine(lang, window, salesComplete, catalogComplete));
  out.push(L(lang, 'Leftover estimates assume the recent selling rate continues.', 'تقدير الكمية يلي ممكن تضل بيفترض إنو البيع بيكمّل بنفس السرعة.'));
  return done('ok', lang, out);
}

export async function runInsight(session: ReadSession, spec: InsightSpec, src: InsightSource, lang: AiLang, now: Date = new Date()): Promise<InsightResult> {
  const capped: InsightSpec = { ...spec, limit: Math.max(1, Math.min(spec.limit, 20)) };
  switch (capped.kind) {
    case 'bestProfit':
      return bestProfit(session, capped, src, lang);
    case 'stockout':
      return stockout(session, capped, src, lang, now);
    case 'reorder':
      return reorder(session, capped, src, lang, now);
    case 'slowMovers':
      return slowMovers(session, capped, src, lang, now);
    case 'trends':
      return trends(session, capped, src, lang);
    case 'suppliers':
      return suppliers(session, capped, src, lang);
    case 'expiryRisk':
      return expiryRisk(session, capped, src, lang, now);
  }
}

export const INSIGHT_DEFAULT_LIMIT = Math.min(5, AI_LIST_CAP);
