/**
 * Grounded period comparison and "why did it change?" breakdown.
 *
 * Totals come from the same daily aggregates and `sumStats`/`netFigures` the Reports screen uses.
 * Nothing is estimated: an empty period is said in words, an unknown cost blocks the profit figure,
 * and the breakdown describes where the recorded change happened, never a guessed cause.
 */
import { netFigures, sumStats, type DailyStats } from '@/services/reportService';
import type { AiLang } from '../engine';
import { rankProducts } from '../productRank';
import type { AiReadSource, ReadSession } from '../readSnapshot';
import type { CompareSpec, PeriodSpec } from './memory';
import { periodLimited } from './tools';

export interface CompareResult {
  status: 'ok' | 'denied' | 'unavailable';
  lang: AiLang;
  text: string;
  consultModel: boolean;
  executes: false;
}

interface PeriodTotals {
  rows: number;
  salesCount: number;
  revenue: number;
  returns: number;
  returnsCount: number;
  netRevenue: number;
  expenses: number;
  netProfit: number;
  grossProfit: number;
  costsComplete: boolean;
}

const LRI = '⁦';
const PDI = '⁩';

function money(cents: number, lang: AiLang, signed = false): string {
  const sign = cents < 0 ? '-' : signed && cents > 0 ? '+' : '';
  const abs = Math.abs(Math.round(cents));
  const text = `${sign}$${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')} USD`;
  return lang === 'ar' ? `${LRI}${text}${PDI}` : text;
}

function pct(current: number, previous: number): string | null {
  if (previous === 0) return null;
  const value = ((current - previous) / Math.abs(previous)) * 100;
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function count(n: number, signed = false): string {
  return `${signed && n > 0 ? '+' : ''}${n}`;
}

const LABELS: Record<string, { en: string; ar: string }> = {
  today: { en: 'today', ar: 'اليوم' },
  yesterday: { en: 'yesterday', ar: 'امبارح' },
  week: { en: 'the last 7 days', ar: 'آخر ٧ أيام' },
  lastWeek: { en: 'the 7 days before', ar: 'الـ٧ أيام اللي قبلها' },
  month: { en: 'this month so far', ar: 'هالشهر لهلّق' },
  lastMonth: { en: 'last month', ar: 'الشهر الماضي' },
  year: { en: 'this year so far', ar: 'هالسنة لهلّق' },
  previousDay: { en: 'the day before', ar: 'اليوم اللي قبله' },
  previousPeriod: { en: 'the period before', ar: 'الفترة اللي قبلها' },
  previousMonthToDate: { en: 'the same days last month', ar: 'نفس الأيام من الشهر الماضي' },
  custom: { en: 'the selected dates', ar: 'التواريخ المحددة' },
};

export function periodName(period: PeriodSpec, lang: AiLang): string {
  const label = LABELS[period.label] ?? LABELS.custom!;
  const span = period.from === period.to ? period.from : `${period.from} → ${period.to}`;
  return `${lang === 'ar' ? label.ar : label.en} (${LRI}${span}${PDI})`;
}

function totalsOf(days: DailyStats[], period: PeriodSpec, unknownCost: boolean): PeriodTotals {
  const inRange = days.filter((d) => d.date >= period.from && d.date <= period.to);
  const sum = sumStats(inRange);
  const net = netFigures(sum);
  return {
    rows: inRange.length,
    salesCount: sum.salesCount,
    revenue: sum.revenueUsdCents,
    returns: sum.returnsUsdCents,
    returnsCount: sum.returnsCount,
    netRevenue: net.netRevenue,
    expenses: sum.expensesUsdCents,
    netProfit: net.netProfit,
    grossProfit: net.grossProfit,
    costsComplete: !unknownCost && inRange.every((d) => d.costsComplete !== false),
  };
}

function hasActivity(t: PeriodTotals): boolean {
  return t.rows > 0 && (t.salesCount > 0 || t.revenue !== 0 || t.returns !== 0 || t.expenses !== 0);
}

function lineMoney(label: string, cur: number, prev: number, lang: AiLang): string {
  const change = pct(cur, prev);
  const diff = money(cur - prev, lang, true);
  return lang === 'ar'
    ? `• ${label}: ${money(cur, lang)} مقابل ${money(prev, lang)} (${diff}${change ? `، ${change}` : ''}).`
    : `• ${label}: ${money(cur, lang)} vs ${money(prev, lang)} (${diff}${change ? `, ${change}` : ''}).`;
}

function lineCount(label: string, cur: number, prev: number, lang: AiLang): string {
  const change = pct(cur, prev);
  return lang === 'ar'
    ? `• ${label}: ${cur} مقابل ${prev} (${count(cur - prev, true)}${change ? `، ${change}` : ''}).`
    : `• ${label}: ${cur} vs ${prev} (${count(cur - prev, true)}${change ? `, ${change}` : ''}).`;
}

function movers(
  current: Awaited<ReturnType<AiReadSource['saleLines']>>,
  previous: Awaited<ReturnType<AiReadSource['saleLines']>>,
  lang: AiLang,
): string[] {
  if (!current.complete || !previous.complete) {
    return [lang === 'ar' ? '• تفاصيل المنتجات ناقصة لهالفترة، فما عرضتها.' : '• The product breakdown is incomplete for these dates, so it is not shown.'];
  }
  const cur = rankProducts(current.sales, 'revenue');
  const prev = rankProducts(previous.sales, 'revenue');
  const map = new Map<string, { name: string; cur: number; prev: number }>();
  for (const r of prev.rows) map.set(r.productId, { name: r.name, cur: 0, prev: r.netUsdCents });
  for (const r of cur.rows) {
    const entry = map.get(r.productId) ?? { name: r.name, cur: 0, prev: 0 };
    entry.cur = r.netUsdCents;
    entry.name = r.name;
    map.set(r.productId, entry);
  }
  const changes = [...map.values()].map((e) => ({ ...e, delta: e.cur - e.prev })).filter((e) => e.delta !== 0);
  const down = changes.filter((e) => e.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 3);
  const up = changes.filter((e) => e.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 3);
  const lines: string[] = [];
  const fmt = (e: (typeof changes)[number]) => `«${e.name}» ${money(e.prev, lang)} → ${money(e.cur, lang)}`;
  if (down.length) lines.push(lang === 'ar' ? `• أكتر تراجع بقيمة المبيع: ${down.map(fmt).join('؛ ')}.` : `• Biggest drops in sales value: ${down.map(fmt).join('; ')}.`);
  if (up.length) lines.push(lang === 'ar' ? `• أكتر زيادة: ${up.map(fmt).join('؛ ')}.` : `• Biggest increases: ${up.map(fmt).join('; ')}.`);
  if (!down.length && !up.length) lines.push(lang === 'ar' ? '• ما في فرق بقيمة مبيع المنتجات بالدولار.' : '• No product changed in USD sales value.');
  if (cur.currencies.includes('LBP') || prev.currencies.includes('LBP')) {
    lines.push(lang === 'ar' ? '• في مبيعات بالليرة؛ ما حوّلتها لدولار وما دخلت بهالمقارنة.' : '• Some sales were in LBP; they are not converted and are not part of this comparison.');
  }
  return lines;
}

export async function comparePeriods(session: ReadSession, spec: CompareSpec, source: AiReadSource, lang: AiLang): Promise<CompareResult> {
  const done = (status: CompareResult['status'], text: string, consultModel = false): CompareResult => ({ status, lang, text, consultModel, executes: false });
  if (!session.can('canViewReports')) {
    return done('denied', lang === 'ar' ? 'ما عندك صلاحية تشوف التقارير، فما بقدر قارن الفترات.' : 'You do not have permission to view reports, so periods cannot be compared.');
  }
  if (spec.metric === 'profit' && !session.can('canViewCosts')) {
    return done('denied', lang === 'ar' ? 'ما عندك صلاحية تشوف الكلفة والربح.' : 'You do not have permission to view costs and profit.');
  }
  if (periodLimited(spec.current) || periodLimited(spec.previous)) {
    return done('unavailable', lang === 'ar' ? 'هالفترة طويلة كتير أو التاريخ مش صحيح، فما في مقارنة كاملة.' : 'One of these periods is invalid or too long to summarise completely. No comparison is shown.');
  }
  const from = spec.previous.from < spec.current.from ? spec.previous.from : spec.current.from;
  const to = spec.previous.to > spec.current.to ? spec.previous.to : spec.current.to;
  const [days, unknownCost] = await Promise.all([
    source.dailyStats(session.tenantId, from, to),
    source.unknownProductCost ? source.unknownProductCost(session.tenantId, from, to) : Promise.resolve(false),
  ]);
  const cur = totalsOf(days, spec.current, unknownCost);
  const prev = totalsOf(days, spec.previous, unknownCost);
  const curName = periodName(spec.current, lang);
  const prevName = periodName(spec.previous, lang);
  const out: string[] = [];
  out.push(
    lang === 'ar'
      ? `مقارنة ${spec.metric === 'profit' ? 'الربح' : 'المبيعات'}: ${curName} مقابل ${prevName}. المبالغ بالدولار كما هي مسجّلة.`
      : `${spec.metric === 'profit' ? 'Profit' : 'Sales'} comparison: ${curName} vs ${prevName}. Amounts are recorded USD totals.`,
  );
  if (!hasActivity(cur) && !hasActivity(prev)) {
    out.push(lang === 'ar' ? 'ما في مبيعات مسجّلة بالفترتين.' : 'No sales were recorded in either period.');
    return done('ok', out.join('\n'));
  }
  if (!hasActivity(cur)) out.push(lang === 'ar' ? `ما في مبيعات مسجّلة ${curName}.` : `No sales were recorded in ${curName}.`);
  if (!hasActivity(prev)) out.push(lang === 'ar' ? `ما في مبيعات مسجّلة ${prevName}.` : `No sales were recorded in ${prevName}.`);

  out.push(lineCount(lang === 'ar' ? 'عدد المبيعات' : 'Number of sales', cur.salesCount, prev.salesCount, lang));
  out.push(lineMoney(lang === 'ar' ? 'المبيعات قبل المرتجعات' : 'Gross sales', cur.revenue, prev.revenue, lang));
  if (cur.returns !== 0 || prev.returns !== 0) out.push(lineMoney(lang === 'ar' ? 'المرتجعات' : 'Returns', cur.returns, prev.returns, lang));
  out.push(lineMoney(lang === 'ar' ? 'صافي المبيعات بعد المرتجعات' : 'Net sales after returns', cur.netRevenue, prev.netRevenue, lang));
  const aovCur = cur.salesCount > 0 ? cur.revenue / cur.salesCount : null;
  const aovPrev = prev.salesCount > 0 ? prev.revenue / prev.salesCount : null;
  if (aovCur !== null && aovPrev !== null) out.push(lineMoney(lang === 'ar' ? 'معدل قيمة البيعة' : 'Average sale value', aovCur, aovPrev, lang));

  const wantsProfit = spec.metric === 'profit' || ((spec.explain || spec.detail) && session.can('canViewCosts'));
  if (wantsProfit) {
    if (!cur.costsComplete || !prev.costsComplete) {
      out.push(
        lang === 'ar'
          ? '• الربح ما بينعرض: في منتجات كلفتها مش مسجّلة، وما بحسبها صفر.'
          : '• Profit is not shown: some product costs are not recorded, and they are not treated as zero.',
      );
    } else {
      if (cur.expenses !== 0 || prev.expenses !== 0) out.push(lineMoney(lang === 'ar' ? 'المصاريف المسجّلة' : 'Recorded expenses', cur.expenses, prev.expenses, lang));
      out.push(lineMoney(lang === 'ar' ? 'الربح الإجمالي' : 'Gross profit', cur.grossProfit, prev.grossProfit, lang));
      out.push(lineMoney(lang === 'ar' ? 'صافي الربح بعد المصاريف' : 'Net profit after expenses', cur.netProfit, prev.netProfit, lang));
    }
  }

  if (spec.explain && aovCur !== null && aovPrev !== null && cur.revenue !== prev.revenue) {
    const volume = (cur.salesCount - prev.salesCount) * aovPrev;
    const value = cur.salesCount * (aovCur - aovPrev);
    out.push(lang === 'ar' ? 'وين صار الفرق بالأرقام المسجّلة:' : 'Where the recorded change came from:');
    out.push(
      lang === 'ar'
        ? `• عدد المبيعات (${count(cur.salesCount - prev.salesCount, true)}) تقريباً ${money(volume, lang, true)}.`
        : `• Number of sales (${count(cur.salesCount - prev.salesCount, true)}): about ${money(volume, lang, true)}.`,
    );
    out.push(
      lang === 'ar'
        ? `• تغيّر معدل قيمة البيعة: تقريباً ${money(value, lang, true)}.`
        : `• Change in average sale value: about ${money(value, lang, true)}.`,
    );
    if (cur.returns !== prev.returns) {
      out.push(lang === 'ar' ? `• المرتجعات تغيّرت ${money(cur.returns - prev.returns, lang, true)}.` : `• Returns changed by ${money(cur.returns - prev.returns, lang, true)}.`);
    }
  }
  if ((spec.explain || spec.detail) && session.can('canViewSales')) {
    const [curLines, prevLines] = await Promise.all([
      source.saleLines(session.tenantId, spec.current.from, spec.current.to),
      source.saleLines(session.tenantId, spec.previous.from, spec.previous.to),
    ]);
    out.push(...movers(curLines, prevLines, lang));
  }
  if (spec.explain) {
    out.push(
      lang === 'ar'
        ? 'هيدا بيبيّن وين صار التغيير بالسجلات، مش السبب الأكيد (متل الأسعار، نفاد المخزون، أو حركة الزباين).'
        : 'This shows where the change happened in your records, not a certain cause (for example prices, stock-outs, or customer traffic).',
    );
  }
  return done('ok', out.join('\n'), true);
}
