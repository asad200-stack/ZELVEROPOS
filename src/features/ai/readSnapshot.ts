/**
 * Turns one signed-in session into a short read-only note.
 * Tenant id, permissions, and dates come from the caller, never from model text.
 */
import { NAV_ITEMS } from '@/app/navigation';
import type { PermissionKey } from '@/constants/permissions';
import { DEFAULTS } from '@/constants/app';
import { localDate, type DatePreset } from '@/domain/dates';
import { DAILY_STATS_LIMIT } from '@/domain/salesPlan';
import { ar } from '@/i18n/ar';
import { en } from '@/i18n/en';
import type { DailyStats } from '@/services/reportService';
import { netFigures } from '@/services/reportService';
import { aiAccessDeniedText, canAccessZelveroAi } from './aiAccess';
import type { AiLang } from './engine';
import { humanizePermissionKeys } from './permissionDisplay';
import { joinStockSales, rankProducts, type CatalogProduct, type HeldProduct, type RankSale } from './productRank';
import type { ReadGap, ReadRange, ReadRequest, ReadTopic } from './readIntent';

export const AI_LIST_CAP = 8;

export interface ReadSession {
  tenantId: string;
  route: string;
  isOwner: boolean;
  can: (permission: PermissionKey) => boolean;
}

export interface AiReadSource {
  dailyStats(tenantId: string, from: string, to: string): Promise<DailyStats[]>;
  cashbox(tenantId: string): Promise<{ usdCents: number; lbp: number }>;
  products(tenantId: string, mode: 'low' | 'out', threshold: number): Promise<{ items: { id?: string; name: string; stock: number }[]; hasMore: boolean }>;
  productsByIds(tenantId: string, ids: string[]): Promise<CatalogProduct[]>;
  threshold(tenantId: string): Promise<number>;
  stockCounts(tenantId: string, threshold: number): Promise<{ low: number; out: number } | null>;
  findStock(tenantId: string, name: string): Promise<{ items: { id: string; name: string; stock: number }[]; complete: boolean }>;
  expiry(tenantId: string, today: string): Promise<{
    expired: number;
    soon: number;
    soonDays: number;
    listed: { name: string; expiryDate: string; stock: number }[];
    listIncomplete: boolean;
  }>;
  debts(tenantId: string): Promise<{ items: { name: string; debtUsdCents: number }[]; hasMore: boolean }>;
  saleLines(tenantId: string, from: string, to: string): Promise<{ sales: RankSale[]; complete: boolean }>;
  /** True when any product stores an unknown cost. Absent in tests that do not cover this check. */
  /** Scoped to products sold within [from, to] — not the whole catalog. */
  unknownProductCost?(tenantId: string, from: string, to: string): Promise<boolean>;
}

export interface ReadSnapshot {
  status: 'ok' | 'denied' | 'unavailable' | 'unsupported';
  lang: AiLang;
  text: string;
  consultModel: boolean;
  executes: false;
}

const usd = (cents: number) => {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')} USD`;
};

/** Display form of an already-calculated cent amount. Does not round or recompute profit. */
const profitUsd = (cents: number) => {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
};

/** Keep $ amounts as one left-to-right run inside an Arabic sentence. */
const usdAr = (cents: number) => `\u2066${usd(cents)}\u2069`;

const lbp = (amount: number) => `${Math.round(amount)} LBP`;

function allowed(session: ReadSession, topic: ReadTopic): boolean {
  if (topic === 'screen') return true;
  if (topic === 'sales') return session.can('canViewReports');
  if (topic === 'cashbox') return session.can('canManageCashDrawer');
  if (topic === 'lowStock' || topic === 'outOfStock' || topic === 'expiry') return session.can('canViewProducts');
  if (topic === 'stockItem') return session.can('canViewProducts') || session.can('canSell');
  if (topic === 'debts') return session.can('canViewCustomers');
  if (topic === 'productRank') return session.can('canViewSales');
  if (topic === 'stockSales') return session.can('canViewProducts') && session.can('canViewSales');
  return false;
}

function screenLine(session: ReadSession, lang: AiLang): string {
  const path = session.route.length > 1 && session.route.endsWith('/') ? session.route.slice(0, -1) : session.route;
  const item = NAV_ITEMS.find((entry) => entry.path === path);
  const label = item ? (lang === 'ar' ? ar : en)[item.label] : path;
  const open = !item || (item.ownerOnly ? session.isOwner : !item.permission || session.can(item.permission));
  if (lang === 'ar') {
    return open
      ? `الشاشة الحالية: ${label} (${path}). هذا وصف للجلسة فقط.`
      : `الشاشة الحالية: ${path}. صلاحيتك لا تسمح بفتحها. هذه الدردشة لن تفتحها.`;
  }
  return open
    ? `Current screen: ${label} (${path}). This is the signed-in session only.`
    : `Current screen: ${path}. Your role may not open it. This chat will not open it.`;
}

function deny(topic: ReadTopic, lang: AiLang): string {
  const permission = topic === 'stockItem'
    ? 'canViewProducts or canSell'
    : topic === 'productRank'
    ? 'canViewSales'
    : topic === 'sales'
      ? 'canViewReports'
      : topic === 'cashbox'
        ? 'canManageCashDrawer'
        : topic === 'debts'
          ? 'canViewCustomers'
          : 'canViewProducts';
  const needed = humanizePermissionKeys(`It requires ${permission}.`, lang)
    .replace(/^It requires\s+/i, '')
    .replace(/\.$/, '');
  return lang === 'ar'
    ? `لم تُقرأ بيانات ${topic}. الصلاحية المطلوبة هي ${needed}. لا يوجد رقم بديل.`
    : `${topic} was not read. It requires ${needed}. No figure is substituted.`;
}

function fail(topic: ReadTopic, lang: AiLang): string {
  return lang === 'ar' ? `تعذّرت قراءة ${topic}. لا يوجد مجموع يمكن عرضه.` : `${topic} could not be read. No total is available.`;
}

function gapText(_gap: ReadGap, lang: AiLang): string {
  return lang === 'ar'
    ? 'كمية كل المنتجات: غير متاحة. هذه الدردشة تعرض المخزون المنخفض أو الكمية صفر، لا كل الأصناف.'
    : 'Every product quantity: not available. This chat can list low stock or zero stock, not the whole catalog.';
}

const RANK_NOTE_CAP = 20;

const PRESET_AR: Record<DatePreset, string> = {
  today: 'اليوم',
  yesterday: 'أمس',
  week: 'آخر 7 أيام',
  month: 'هذا الشهر',
  lastMonth: 'الشهر الماضي',
  year: 'هذه السنة',
  custom: 'تواريخ محددة',
};

/** Arabic notes name the preset in Arabic. The stored dates stay the same. */
function presetLabel(label: DatePreset, lang: AiLang): string {
  return lang === 'ar' ? PRESET_AR[label] : label;
}

function rankSection(loaded: { sales: RankSale[]; complete: boolean }, range: ReadRange, request: ReadRequest, lang: AiLang): string {
  const basis = request.rankBy === 'revenue'
    ? lang === 'ar'
      ? 'الترتيب حسب صافي مبلغ سطر البيع، بعملة الفاتورة فقط.'
      : 'Ranked by the net amount stored on the sale line, in that invoice currency only.'
    : lang === 'ar'
      ? 'الترتيب حسب الوحدات الصافية.'
      : 'Ranked by net units.';
  const header = lang === 'ar'
    ? `ترتيب المنتجات من ${range.from} إلى ${range.to} (تاريخ العمل المحلي، النطاق ${presetLabel(range.label, lang)}). ${basis} المرتجعات المسجّلة على الفاتورة تُخصم، وتبقى على تاريخ الفاتورة. لا توجد حالة إلغاء أو إبطال. الأسماء هي الأسماء المحفوظة على سطور البيع. الفاتورة المؤجلة غير المشمولة في السجل لا تُحسب.`
    : `Product ranking from ${range.from} to ${range.to} (local business date, range ${range.label}). ${basis} Returns stored on the invoice are subtracted and stay on the invoice date. There is no void or cancelled status. Names are the names stored on the sale lines. A queued offline sale is not included.`;
  if (range.limited || !loaded.complete) {
    return lang === 'ar'
      ? `${header}\nقائمة الفواتير لهذه الفترة ناقصة ولم تكتمل. لا يُعرض ترتيب.`
      : `${header}\nThe sale list for this range is incomplete and did not finish. No ranking is shown.`;
  }
  const ranked = rankProducts(loaded.sales, request.rankBy);
  if (request.rankBy === 'revenue' && ranked.currencies.length > 1) {
    return lang === 'ar'
      ? `${header}\nلا يُعرض ترتيب. فواتير الدولار والليرة غير مجموعة.`
      : `${header}\nNo ranking is shown. USD and LBP invoices are not combined.`;
  }
  if (ranked.rows.length === 0) {
    return lang === 'ar'
      ? `${header}\nلا توجد وحدات صافية مباعة في هذه الفترة. هذا ليس ترتيباً صفرياً.`
      : `${header}\nNo net units were sold in this range. This is not a ranking of zero.`;
  }
  const currency = ranked.currencies.length === 1 ? ranked.currencies[0] : null;
  const showingRevenue = request.rankBy === 'revenue' && currency !== null;
  const limit = request.rankLimit === 'all' ? RANK_NOTE_CAP : request.rankLimit;
  if (request.rankLimit === 'all' && ranked.rows.length > RANK_NOTE_CAP) {
    return lang === 'ar'
      ? `${header}\n${ranked.rows.length} منتجات لها وحدات صافية. القائمة ناقصة. لا يُعرض ترتيب.`
      : `${header}\n${ranked.rows.length} products had net units. The list is incomplete. No ranking is shown.`;
  }
  const shown = ranked.rows.slice(0, limit);
  const lines = shown.map((row, index) => {
    const alias = row.aliases.length === 0 ? '' : lang === 'ar' ? ` مسجّل أيضاً كـ ${row.aliases.join('، ')}` : ` also recorded as ${row.aliases.join(', ')}`;
    const money = showingRevenue && currency === 'USD' ? ` ${usd(row.netUsdCents)}` : showingRevenue && currency === 'LBP' ? ` ${lbp(row.netLbp)}` : '';
    const tie = row.tied ? (lang === 'ar' ? ' تعادل' : ' tie') : '';
    return `${index + 1}. «${row.name}»: ${row.netUnits} net units${money}${alias}${tie}`;
  });
  const coverage = request.rankLimit === 'all'
    ? lang === 'ar'
      ? `كل المنتجات ذات الوحدات الصافية معروضة (${shown.length}). كل فواتير الفترة محسوبة.`
      : `Every product with net units is listed (${shown.length}). Every sale in the range was counted.`
    : lang === 'ar'
      ? `أعلى ${shown.length} من ${ranked.rows.length}. كل فواتير الفترة محسوبة.`
      : `Top ${shown.length} of ${ranked.rows.length}. Every sale in the range was counted.`;
  const tieNote = shown.some((row) => row.tied)
    ? showingRevenue
      ? lang === 'ar'
        ? 'تساوي المبلغ يعني تعادل. الترتيب ليس فائزاً واحداً.'
        : 'Equal net amounts are a tie. The order is not a winner.'
      : lang === 'ar'
        ? 'تساوي الوحدات يعني تعادل. الترتيب ليس فائزاً واحداً.'
        : 'Equal net units are a tie. The order is not a winner.'
    : '';
  const moneyNote = showingRevenue
    ? currency === 'USD'
      ? lang === 'ar'
        ? 'الترتيب حسب صافي الدولار المحفوظ على سطر البيع. الليرة غير داخلة.'
        : 'Ranked by net USD stored on the sale line. LBP is not included.'
      : lang === 'ar'
        ? 'الترتيب حسب صافي الليرة المحفوظ على سطر البيع. الدولار غير داخل.'
        : 'Ranked by net LBP stored on the sale line. USD is not included.'
    : '';
  return [header, moneyNote, coverage, tieNote, ...lines].filter(Boolean).join('\n');
}

const PROFIT_WHEN_EN: Record<DatePreset, string> = {
  today: 'today',
  yesterday: 'yesterday',
  week: 'this week',
  month: 'this month',
  lastMonth: 'last month',
  year: 'this year',
  custom: 'that period',
};

const PROFIT_WHEN_AR: Record<DatePreset, string> = {
  today: 'اليوم',
  yesterday: 'أمس',
  week: 'هالأسبوع',
  month: 'هالشهر',
  lastMonth: 'الشهر الماضي',
  year: 'هالسنة',
  custom: 'بهالفترة',
};

const NO_PROFIT_WHEN_AR: Record<DatePreset, string> = {
  today: 'لليوم',
  yesterday: 'لأمس',
  week: 'لهالأسبوع',
  month: 'لهالشهر',
  lastMonth: 'للشهر الماضي',
  year: 'لهالسنة',
  custom: 'لهالفترة',
};

function noActivityProfit(label: DatePreset, lang: AiLang): string {
  if (lang === 'ar') return `ما في مبيعات ولا مرتجعات ولا مصاريف مسجّلة ${NO_PROFIT_WHEN_AR[label]}، فالربح صفر.`;
  return `No sales, returns, or expenses are recorded for ${PROFIT_WHEN_EN[label]}, so profit is zero.`;
}

function missingCostProfit(label: DatePreset, lang: AiLang): string {
  if (lang === 'ar') return `ما فيني احسب الربح ${NO_PROFIT_WHEN_AR[label]} لأن التكلفة المسجّلة ناقصة. ما اعتبرت التكلفة الناقصة صفر.`;
  return `Profit for ${PROFIT_WHEN_EN[label]} cannot be calculated because recorded cost is missing. Missing cost was not treated as zero.`;
}

function profitSentence(kind: 'net' | 'gross', cents: number, label: DatePreset, lang: AiLang): string {
  const amount = profitUsd(cents);
  if (lang === 'ar') {
    const when = PROFIT_WHEN_AR[label];
    return kind === 'gross' ? `ربحك الإجمالي ${when} ${amount}.` : `ربحك الصافي ${when} ${amount}.`;
  }
  const when = PROFIT_WHEN_EN[label];
  return kind === 'gross' ? `Your gross profit ${when} is ${amount}.` : `Your net profit ${when} is ${amount}.`;
}

/**
 * Short profit answer. Uses the same daily aggregate and netFigures as the sales note.
 * The wording only places that result in a sentence.
 */
function profitOnlyText(days: DailyStats[], request: ReadRequest, session: ReadSession, lang: AiLang, unknownCost = false): string {
  const { from, to, label } = request.range;
  if (request.includeProfit && !session.can('canViewCosts')) {
    return lang === 'ar' ? 'الربح غير معروض لأن الصلاحية canViewCosts غير متاحة.' : 'Profit is omitted because canViewCosts is not granted.';
  }
  if (days.length >= DAILY_STATS_LIMIT) {
    return lang === 'ar' ? 'مجموع الربح ناقص، فما بينعرض كرقم نهائي.' : 'The profit total is incomplete, so it is not shown.';
  }
  let revenue = 0;
  let returnsCount = 0;
  let returnsUsd = 0;
  let cost = 0;
  let returnsCost = 0;
  let expenses = 0;
  let rows = 0;
  for (const day of days) {
    if (day.date < from || day.date > to) continue;
    rows += 1;
    revenue += day.revenueUsdCents;
    returnsCount += day.returnsCount;
    returnsUsd += day.returnsUsdCents;
    cost += day.costUsdCents;
    returnsCost += day.returnsCostUsdCents;
    expenses += day.expensesUsdCents;
  }
  if (rows === 0) return noActivityProfit(label, lang);
  if (unknownCost || days.some((day) => day.date >= from && day.date <= to && day.costsComplete === false)) return missingCostProfit(label, lang);
  const figures = netFigures({
    date: 'total',
    salesCount: 0,
    revenueUsdCents: revenue,
    costUsdCents: cost,
    discountUsdCents: 0,
    checkoutDiscountUsdCents: 0,
    cashSalesUsdCents: 0,
    creditSalesUsdCents: 0,
    debtCollectedUsdCents: 0,
    creditIssuedUsdCents: 0,
    returnsCount,
    returnsUsdCents: returnsUsd,
    returnsCostUsdCents: returnsCost,
    expensesUsdCents: expenses,
  });
  if (request.profitAnswer === 'gross') return profitSentence('gross', figures.grossProfit, label, lang);
  if (request.profitAnswer === 'detail') {
    return lang === 'ar'
      ? `الربح الإجمالي ${profitUsd(figures.grossProfit)}. المصاريف المسجّلة ${profitUsd(expenses)}. الربح الصافي ${profitUsd(figures.netProfit)}.`
      : `Gross profit: ${profitUsd(figures.grossProfit)}. Recorded expenses: ${profitUsd(expenses)}. Net profit: ${profitUsd(figures.netProfit)}.`;
  }
  return profitSentence('net', figures.netProfit, label, lang);
}

function salesText(days: DailyStats[], request: ReadRequest, session: ReadSession, lang: AiLang, unknownCost = false): string {
  if (request.profitAnswer !== 'off') return profitOnlyText(days, request, session, lang, unknownCost);
  const { from, to, label } = request.range;
  let salesCount = 0;
  let revenue = 0;
  let returnsCount = 0;
  let returnsUsd = 0;
  let cost = 0;
  let returnsCost = 0;
  let expenses = 0;
  for (const day of days) {
    if (day.date < from || day.date > to) continue;
    salesCount += day.salesCount;
    revenue += day.revenueUsdCents;
    returnsCount += day.returnsCount;
    returnsUsd += day.returnsUsdCents;
    cost += day.costUsdCents;
    returnsCost += day.returnsCostUsdCents;
    expenses += day.expensesUsdCents;
  }
  const net = revenue - returnsUsd;
  const scope = lang === 'ar'
    ? `مبيعات من ${from} إلى ${to} (تاريخ العمل المحلي، النطاق ${presetLabel(label, lang)}). العملة USD فقط. تجميع اليوم لا يخزّن ليرة لبنانية، لذلك لا توجد حصيلة بالليرة ولا تحويل بين العملتين.`
    : `Sales from ${from} to ${to} (local business date, range ${label}). Currency: USD only. The daily aggregate does not store LBP, so there is no LBP total and no conversion between the two.`;
  if (days.length >= DAILY_STATS_LIMIT) {
    return lang === 'ar'
      ? `${scope}\nوصل التجميع إلى حده. المجموع غير مكتمل ولا يُعرض كرقم نهائي.`
      : `${scope}\nThe daily aggregate hit its row limit. The total is incomplete and is not shown as a final figure.`;
  }
  const empty = salesCount === 0 && revenue === 0 && returnsUsd === 0;
  const gross = revenue;
  const figure = request.salesFigure;
  const body = empty
    ? lang === 'ar'
      ? `لا توجد مبيعات مسجّلة في تجميع هذه الفترة.${figure === 'unspecified' ? '' : ' الإيراد الإجمالي والصافي صفر.'}`
      : `No sales are recorded in the daily aggregate for this range.${figure === 'unspecified' ? '' : ' Gross revenue and net revenue are zero.'}`
    : figure === 'gross'
      ? lang === 'ar'
        ? `الإيراد الإجمالي: ${usdAr(gross)}. المرتجعات غير مخصومة. المرتجعات: ${returnsCount}، ${usdAr(returnsUsd)}.`
        : `Gross revenue: ${usd(gross)}. Returns are not subtracted. Returns: ${returnsCount}, ${usd(returnsUsd)}.`
      : figure === 'both'
        ? lang === 'ar'
          ? `الإيراد الإجمالي: ${usdAr(gross)}. الإيراد الصافي: ${usdAr(net)} (الإجمالي ناقص المرتجعات). المرتجعات: ${returnsCount}، ${usdAr(returnsUsd)}.`
          : `Gross revenue: ${usd(gross)}. Net revenue: ${usd(net)} (gross minus returns). Returns: ${returnsCount}, ${usd(returnsUsd)}.`
        : lang === 'ar'
          ? `عدد الفواتير: ${salesCount}. صافي المبيعات: ${usdAr(net)} (الإيراد ناقص المرتجعات). المرتجعات: ${returnsCount}، ${usdAr(returnsUsd)}.`
          : `Invoices: ${salesCount}. Net sales: ${usd(net)} (revenue minus returns). Returns: ${returnsCount}, ${usd(returnsUsd)}.`;
  let profit = '';
  if (request.includeProfit && !session.can('canViewCosts')) {
    profit = lang === 'ar' ? 'الربح غير معروض لأن الصلاحية canViewCosts غير متاحة.' : 'Profit is omitted because canViewCosts is not granted.';
  } else if (request.includeProfit && empty) {
    profit = lang === 'ar'
      ? 'ما في مبيعات مسجّلة بهالفترة، فالربح صفر.'
      : 'No sales are recorded for this range, so profit is zero.';
  } else if (request.includeProfit && (unknownCost || days.some((day) => day.date >= from && day.date <= to && day.costsComplete === false))) {
    profit = missingCostProfit(label, lang);
  } else if (request.includeProfit) {
    const figures = netFigures({
      date: 'total',
      salesCount,
      revenueUsdCents: revenue,
      costUsdCents: cost,
      discountUsdCents: 0,
      checkoutDiscountUsdCents: 0,
      cashSalesUsdCents: 0,
      creditSalesUsdCents: 0,
      debtCollectedUsdCents: 0,
      creditIssuedUsdCents: 0,
      returnsCount,
      returnsUsdCents: returnsUsd,
      returnsCostUsdCents: returnsCost,
      expensesUsdCents: expenses,
    });
    profit = lang === 'ar'
      ? `الربح الإجمالي: ${usdAr(figures.grossProfit)}. صافي الربح بعد المصاريف المسجّلة: ${usdAr(figures.netProfit)}.`
      : `Gross profit: ${usd(figures.grossProfit)}. Net profit after recorded expenses: ${usd(figures.netProfit)}.`;
  }
  if (request.includeProfit && empty) return [profit, body].filter(Boolean).join('\n');
  return [scope, body, profit].filter(Boolean).join('\n');
}

function names(items: { name: string; stock: number }[], hasMore: boolean, total: number | null, lang: AiLang, label: string): string {
  const shown = items.slice(0, AI_LIST_CAP);
  const namesIncomplete = hasMore || items.length > AI_LIST_CAP;
  const knownTotal = total ?? (hasMore ? null : items.length);
  const rows = shown.map((item) => `${item.name}: ${item.stock}`).join(', ') || (lang === 'ar' ? 'لا شيء' : 'none');
  const count = knownTotal == null
    ? lang === 'ar'
      ? 'العدد الكامل لم يُقرأ.'
      : 'The full count was not read.'
    : lang === 'ar'
      ? `العدد الكامل: ${knownTotal}.`
      : `Full count: ${knownTotal}.`;
  const list = namesIncomplete
    ? lang === 'ar'
      ? `الأسماء ناقصة. المعروض ${shown.length} وليس كل الأصناف.`
      : `The name list is incomplete. Showing ${shown.length}, not every product.`
    : lang === 'ar'
      ? 'الأسماء المعروضة هي كل النتيجة.'
      : 'The names shown are the whole result.';
  return `${label}\n${count}\n${list}\n${rows}`;
}

function stockItemText(
  found: { items: { id: string; name: string; stock: number }[]; complete: boolean },
  name: string,
  qty: number | null,
  lang: AiLang,
): string {
  const header = lang === 'ar'
    ? `الكمية الحالية للاسم «${name}». هذا المخزون الموجود الآن، وليس الكمية المباعة أو المشتراة. المنتجات المؤرشفة غير مشمولة.`
    : `Current stock for the exact name «${name}». This is the quantity on hand now, not quantity sold or purchased. Archived products are not included.`;
  if (!found.complete) {
    return lang === 'ar'
      ? `${header}\nالبحث عن الاسم لم يكتمل. لا تُعرض كمية.`
      : `${header}\nThe name search did not finish. No stock figure is shown.`;
  }
  if (found.items.length === 0) {
    return lang === 'ar'
      ? `${header}\nلا يوجد منتج نشط بهذا الاسم تماماً. لا تُعرض كمية.`
      : `${header}\nNo active product has that exact name. No stock figure is shown.`;
  }
  if (found.items.length > 1) {
    const rows = found.items.map((item) => `«${item.name}» ${item.id}: ${item.stock} on hand`).join('\n');
    return lang === 'ar'
      ? `${header}\nالاسم غير فريد. لم يُختر منتج واحد، لذلك لا تُحسم التوفّر.\n${rows}`
      : `${header}\nThe name is not unique. No product was chosen, so availability is not answered.\n${rows}`;
  }
  const item = found.items[0]!;
  const holding = lang === 'ar'
    ? `«${item.name}»: ${item.stock} on hand.`
    : `«${item.name}»: ${item.stock} on hand.`;
  if (qty == null) return `${header}\n${holding}`;
  const yes = qty <= item.stock;
  const answer = lang === 'ar'
    ? `الكمية المطلوبة ${qty}. ${yes ? 'متوفرة: نعم.' : 'متوفرة: لا.'} ${holding}`
    : `Requested ${qty}. Available: ${yes ? 'yes' : 'no'}. ${holding}`;
  return `${header}\n${answer}`;
}

const ID_CHECK_CAP = 40;

function stockSalesHeader(mode: 'low' | 'out', threshold: number, request: ReadRequest, range: ReadRange, lang: AiLang): string {
  const meaning = mode === 'out'
    ? lang === 'ar'
      ? 'الكمية الحالية صفر. هذا المخزون الموجود الآن، وليس الكمية المباعة.'
      : 'Current stock is zero. This is on-hand stock, not quantity sold.'
    : request.stockBelow != null
      ? lang === 'ar'
        ? `أقل من ${request.stockBelow + 1}: الكمية الحالية من 1 إلى ${threshold}. الكمية صفر ليست هنا. يُستخدم حد واحد لكل المنتجات، بلا حد خاص بكل منتج.`
        : `Below ${request.stockBelow + 1}: on hand stock from 1 through ${threshold}. Quantity zero is not in this list. One threshold is used for every product. A product-specific minimum is not applied.`
      : lang === 'ar'
        ? `مخزون منخفض: الكمية الحالية أكبر من صفر وحتى ${threshold}. هذا إعداد المتجر، أو الافتراضي 10 إذا لم يُحفظ إعداد. الكمية صفر ليست هنا. بلا حد خاص بكل منتج.`
        : `Low stock: on hand quantity above zero and at or below ${threshold}. This is the store setting, or the default 10 when that setting is not saved. Quantity zero is not in this list. A product-specific minimum is not applied.`;
  const basis = lang === 'ar'
    ? `من ${range.from} إلى ${range.to}. الكمية الحالية من المخزون الحالي. الوحدات الصافية من الفواتير المرحلة في هذه الفترة، بعد خصم المرتجع على تاريخ الفاتورة. الفاتورة المكررة تُحسب مرة. الفاتورة المؤجلة غير مشمولة. لا تُجمع الدولار والليرة لأن القائمة بالوحدات فقط. لا تُحسب كمية شراء ولا أيام المخزون.`
    : `From ${range.from} to ${range.to}. On hand is current stock. Net units are from posted invoices in this range, after returns stored on the invoice date. A duplicate invoice id is counted once. A queued offline sale is not included. USD and LBP are not combined because this list uses units only. No purchase quantity or days of stock is calculated.`;
  return `${meaning}\n${basis}`;
}

async function describeStockSales(
  source: AiReadSource,
  tenantId: string,
  request: ReadRequest,
  mode: 'low' | 'out',
  range: ReadRange,
  lang: AiLang,
): Promise<string> {
  const storeThreshold = mode === 'low' ? await source.threshold(tenantId) : 0;
  const threshold = mode === 'low' && request.stockBelow != null ? request.stockBelow : storeThreshold;
  const header = stockSalesHeader(mode, threshold, request, range, lang);
  const blocked = lang === 'ar'
    ? 'قائمة المخزون أو الفواتير ناقصة. لا يُعرض ترتيب.'
    : 'The current stock list or the sale list for this range is incomplete. No ranking is shown.';
  if (range.limited) return `${header}\n${blocked}`;
  const [page, counts, posted] = await Promise.all([
    source.products(tenantId, mode, threshold),
    source.stockCounts(tenantId, threshold),
    source.saleLines(tenantId, range.from, range.to),
  ]);
  const expected = counts == null ? null : mode === 'low' ? counts.low : counts.out;
  const held: HeldProduct[] = [];
  for (const item of page.items) {
    if (!item.id) return `${header}\n${blocked}`;
    held.push({ id: item.id, name: item.name, stock: item.stock });
  }
  const inventoryComplete = !page.hasMore && (expected == null || expected === page.items.length);
  if (!inventoryComplete || !posted.complete) return `${header}\n${blocked}`;
  const preview = rankProducts(posted.sales, 'units');
  const heldIds = new Set(held.map((item) => item.id));
  const unmatched = preview.rows.filter((row) => row.netUnits > 0 && !heldIds.has(row.productId)).map((row) => row.productId);
  const checked = unmatched.length <= ID_CHECK_CAP;
  const catalog = checked ? await source.productsByIds(tenantId, unmatched) : [];
  const hidden: CatalogProduct[] = checked ? catalog : unmatched.map((id) => ({ id, status: 'active' }));
  const join = joinStockSales(held, posted.sales, hidden);
  const noun = mode === 'out' ? 'out-of-stock' : 'low-stock';
  const unchecked = checked
    ? ''
    : lang === 'ar'
      ? 'بعض معرفات الفواتير لم تُفحص. لا تُعرض كميتها الحالية.'
      : 'Some invoice product ids were not checked. Current stock is not shown for them.';
  const aside = checked
    ? join.aside.map((item) => lang === 'ar'
      ? item.kind === 'archived'
        ? `«${item.name}» ${item.id} مؤرشف. الكمية الحالية غير معروضة.`
        : `«${item.name}» ${item.id} غير موجود في الكتالوج الحالي. الكمية الحالية غير معروضة.`
      : item.kind === 'archived'
        ? `«${item.name}» ${item.id} is archived. Current stock is not shown.`
        : `«${item.name}» ${item.id} is not in the current catalog. Current stock is not shown.`)
    : [];
  const quiet = lang === 'ar'
    ? `منتجات بلا وحدات صافية في هذه الفترة: ${join.unsold}. ليست معروضة كأنها بيعت.`
    : `${noun} products with no net units in this range: ${join.unsold}. They are not listed as having sold.`;
  if (join.matched.length === 0) {
    const empty = lang === 'ar'
      ? 'لا توجد وحدات صافية مباعة في هذه الفترة ضمن هذه القائمة. هذا ليس ترتيباً صفرياً.'
      : `No net units were sold in this range by this current ${noun} list. This is not a ranking of zero.`;
    return [header, empty, quiet, unchecked, ...aside].filter(Boolean).join('\n');
  }
  if (request.rankLimit === 'all' && join.matched.length > RANK_NOTE_CAP) {
    return `${header}\n${lang === 'ar' ? 'القائمة ناقصة. لا يُعرض ترتيب.' : 'The list is incomplete. No ranking is shown.'}`;
  }
  const limit = request.rankLimit === 'all' ? RANK_NOTE_CAP : request.rankLimit;
  const shown = join.matched.slice(0, limit);
  const lines = shown.map((row, index) => {
    const invoice = row.invoiceName !== row.name
      ? lang === 'ar' ? ` اسم الفاتورة: «${row.invoiceName}».` : ` Invoice line: «${row.invoiceName}».`
      : '';
    const tie = row.tied ? (lang === 'ar' ? ' تعادل' : ' tie') : '';
    return lang === 'ar'
      ? `${index + 1}. «${row.name}» ${row.id}: ${row.stock} كمية حالية، ${row.netUnits} وحدات صافية.${invoice}${tie}`
      : `${index + 1}. «${row.name}» ${row.id}: ${row.stock} on hand, ${row.netUnits} net units.${invoice}${tie}`;
  });
  const coverage = lang === 'ar'
    ? `أعلى ${shown.length} من ${join.matched.length}. كل منتج في هذه القائمة وكل فاتورة مرحلة في الفترة محسوبة.`
    : `Top ${shown.length} of ${join.matched.length}. Every product in this current ${noun} list and every posted sale in the range was counted.`;
  const tieNote = shown.some((row) => row.tied)
    ? lang === 'ar'
      ? 'تساوي الوحدات يعني تعادل. الترتيب ليس فائزاً واحداً.'
      : 'Equal net units are a tie. The order is not a winner.'
    : '';
  return [header, coverage, tieNote, ...lines, quiet, unchecked, ...aside].filter(Boolean).join('\n');
}

export async function loadReadSnapshot(session: ReadSession, request: ReadRequest, source: AiReadSource, now: Date = new Date()): Promise<ReadSnapshot> {
  const lang = request.lang;
  // Defense-in-depth: live reads are part of the AI assistant surface.
  if (!canAccessZelveroAi(session)) {
    return {
      status: 'denied',
      lang,
      text: aiAccessDeniedText(lang),
      consultModel: false,
      executes: false,
    };
  }
  const today = localDate(now);
  const scope = lang === 'ar'
    ? `النطاق: المتجر المسجّل في هذه الجلسة فقط. أي اسم متجر داخل السؤال يُتجاهل. التاريخ المحلي: ${today}.`
    : `Scope: the signed-in store only. A store name in the question is ignored. Local date: ${today}.`;
  const salesBlocked = request.range.limited && request.topics.includes('sales');
  const parts = request.profitAnswer === 'off' ? [scope, screenLine(session, lang)] : [];
  let ok = false;
  let failed = false;
  const tenantId = session.tenantId;
  let unknownCost = false;
  if (request.includeProfit && source.unknownProductCost) {
    try {
      unknownCost = await source.unknownProductCost(tenantId, request.range.from, request.range.to);
    } catch {
      unknownCost = true;
    }
  }

  for (const gap of request.gaps) parts.push(gapText(gap, lang));
  if (request.refusesAction) {
    parts.push(lang === 'ar' ? 'هذه الدردشة لا تنفّذ هذا الطلب.' : 'This chat does not run that action.');
  }

  for (const topic of request.topics) {
    if (topic === 'screen') {
      ok = true;
      continue;
    }
    if (topic === 'sales' && salesBlocked) {
      parts.push(
        lang === 'ar'
          ? 'لا يمكن تلخيص هذه الفترة بالكامل (التواريخ غير صالحة أو أطول من حد التجميع اليومي). لا يُعرض مجموع.'
          : 'That date range cannot be summarized completely (invalid dates or longer than the daily aggregate limit). No total is shown.',
      );
      continue;
    }
    if (topic === 'stockSales') {
      const canProducts = session.can('canViewProducts');
      const canSales = session.can('canViewSales');
      if (!canProducts || !canSales) {
        if (!canProducts) {
          parts.push(
            humanizePermissionKeys(
              lang === 'ar'
                ? 'لم تُقرأ بيانات stockSales للمخزون. الصلاحية المطلوبة هي canViewProducts. لا يوجد رقم بديل.'
                : 'stockSales inventory was not read. It requires canViewProducts. No figure is substituted.',
              lang,
            ),
          );
        }
        if (!canSales) {
          parts.push(
            humanizePermissionKeys(
              lang === 'ar'
                ? 'لم تُقرأ بيانات stockSales للفواتير. الصلاحية المطلوبة هي canViewSales. لا يوجد رقم بديل.'
                : 'stockSales invoices were not read. It requires canViewSales. No figure is substituted.',
              lang,
            ),
          );
        }
        parts.push(lang === 'ar' ? 'لا تُعرض القائمة المجمعة.' : 'The combined list is not shown.');
        continue;
      }
      try {
        const modes = request.stockSales === 'both' ? (['low', 'out'] as const) : request.stockSales === 'out' ? (['out'] as const) : (['low'] as const);
        const blocks: string[] = [];
        for (const mode of modes) {
          blocks.push(await describeStockSales(source, tenantId, request, mode, request.rankRange, lang));
          if (request.compareRange) blocks.push(await describeStockSales(source, tenantId, request, mode, request.compareRange, lang));
        }
        parts.push(blocks.join('\n\n'));
        ok = true;
      } catch {
        failed = true;
        parts.push(fail(topic, lang));
      }
      continue;
    }
    if (!allowed(session, topic)) {
      parts.push(deny(topic, lang));
      continue;
    }
    try {
      if (topic === 'sales') {
        const days = await source.dailyStats(tenantId, request.range.from, request.range.to);
        const sales = salesText(days, request, session, lang, unknownCost);
        if (request.includeProfit) parts.unshift(sales);
        else parts.push(sales);
      } else if (topic === 'cashbox') {
        const box = await source.cashbox(tenantId);
        parts.push(
          lang === 'ar'
            ? `الصندوق في ${today}. USD: ${usd(box.usdCents)}. LBP: ${lbp(box.lbp)}. العملتان منفصلتان ولم تُجمعا.`
            : `Cash drawer on ${today}. USD: ${usd(box.usdCents)}. LBP: ${lbp(box.lbp)}. The currencies are separate and were not added together.`,
        );
      } else if (topic === 'lowStock' || topic === 'outOfStock') {
        const storeThreshold = topic === 'lowStock' ? await source.threshold(tenantId) : 0;
        const threshold = topic === 'lowStock' && request.stockBelow != null ? request.stockBelow : storeThreshold;
        const [page, counts] = await Promise.all([
          source.products(tenantId, topic === 'lowStock' ? 'low' : 'out', threshold),
          source.stockCounts(tenantId, threshold),
        ]);
        const total = counts == null ? null : topic === 'lowStock' ? counts.low : counts.out;
        const label = topic === 'lowStock'
          ? request.stockBelow != null
            ? lang === 'ar'
              ? `أقل من ${request.stockBelow + 1}: الكمية من 1 إلى ${threshold}. الكمية صفر ليست هنا. يُستخدم حد واحد لكل المنتجات، بلا حد خاص بكل منتج.`
              : `Below ${request.stockBelow + 1}: stock from 1 through ${threshold}. Quantity zero is not in this list. One threshold is used for every product. A product-specific minimum is not applied.`
            : lang === 'ar'
              ? `مخزون منخفض: الكمية أكبر من صفر وحتى ${threshold}. هذا إعداد المتجر، أو الافتراضي 10 إذا لم يُحفظ إعداد. الكمية صفر ليست هنا. بلا حد خاص بكل منتج.`
              : `Low stock: quantity above zero and at or below ${threshold}. This is the store setting, or the default 10 when that setting is not saved. Quantity zero is not in this list. A product-specific minimum is not applied.`
          : lang === 'ar'
            ? 'منتجات كميتها صفر. هذا المخزون الحالي، وليس الكمية المباعة.'
            : 'Products whose current stock is zero. This is on-hand stock, not quantity sold.';
        parts.push(names(page.items, page.hasMore, total, lang, label));
      } else if (topic === 'stockItem' && request.stockName) {
        const found = await source.findStock(tenantId, request.stockName);
        parts.push(stockItemText(found, request.stockName, request.stockQty, lang));
      } else if (topic === 'expiry') {
        const expiry = await source.expiry(tenantId, today);
        const rows = expiry.listed.map((item) => `${item.name}: ${item.expiryDate} (${item.stock})`).join(', ') || (lang === 'ar' ? 'لا شيء' : 'none');
        const incomplete = expiry.listIncomplete
          ? lang === 'ar'
            ? 'أسماء المنتجات المعروضة ناقصة. العددان أعلاه هما العددان الكاملان.'
            : 'The names shown are incomplete. The two counts above are the full counts.'
          : '';
        parts.push(
          lang === 'ar'
            ? `الصلاحية حتى ${expiry.soonDays} يوماً. منتهي: ${expiry.expired}. قريب الانتهاء: ${expiry.soon}. المنتجات بلا تاريخ غير مشمولة.\n${rows}\n${incomplete}`
            : `Expiry window: ${expiry.soonDays} days. Expired: ${expiry.expired}. Due soon: ${expiry.soon}. Products with no date are excluded.\n${rows}\n${incomplete}`,
        );
      } else if (topic === 'debts') {
        const page = await source.debts(tenantId);
        const shown = page.items.slice(0, AI_LIST_CAP);
        const incomplete = page.hasMore || page.items.length > AI_LIST_CAP;
        const rows = shown.map((item) => `${item.name}: ${usd(item.debtUsdCents)}`).join(', ') || (lang === 'ar' ? 'لا أحد' : 'none');
        const note = incomplete
          ? lang === 'ar'
            ? 'هذه الصفحة الأولى فقط، وليست مجموع ديون المتجر. الدين بالدولار فقط.'
            : 'This is the first page only, not the store-wide debt total. Debt is USD only.'
          : lang === 'ar'
            ? `العدد: ${shown.length}. الدين بالدولار فقط. لا هاتف ولا عنوان.`
            : `Count: ${shown.length}. Debt is USD only. No phone or address is included.`;
        parts.push(`${note}\n${rows}`);
      } else if (topic === 'productRank') {
        const blocked = request.rankRange.limited || Boolean(request.compareRange?.limited);
        if (blocked) {
          parts.push(rankSection({ sales: [], complete: false }, request.rankRange, request, lang));
        } else {
          const primary = await source.saleLines(tenantId, request.rankRange.from, request.rankRange.to);
          const sections = [rankSection(primary, request.rankRange, request, lang)];
          if (request.compareRange) {
            const other = await source.saleLines(tenantId, request.compareRange.from, request.compareRange.to);
            sections.push(rankSection(other, request.compareRange, request, lang));
          }
          parts.push(sections.join('\n\n'));
        }
      }
      ok = true;
    } catch {
      failed = true;
      parts.push(fail(topic, lang));
    }
  }

  const dataTopics = request.topics.filter((topic) => topic !== 'screen' && !(topic === 'sales' && salesBlocked));
  const deniedAll = dataTopics.length > 0 && dataTopics.every((topic) => !allowed(session, topic));
  const status = deniedAll
    ? 'denied'
    : failed && !ok
      ? 'unavailable'
      : !ok && (salesBlocked || request.topics.length === 0)
        ? 'unsupported'
        : 'ok';
  return {
    status,
    lang,
    text: parts.join('\n\n'),
    consultModel: status === 'ok' && request.profitAnswer === 'off',
    executes: false,
  };
}

export const EXPIRY_SOON_DAYS = DEFAULTS.expirySoonDays;
