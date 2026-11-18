/**
 * Decides whether a question needs a predefined read.
 * The model does not choose the topic, the store, or the date range.
 */
import { DAILY_STATS_LIMIT } from '@/domain/salesPlan';
import { parseLocalDate, presetRange, type DatePreset } from '@/domain/dates';
import {
  isFinancialCapabilityQuestion,
  isFinancialExecutionRequest,
  isForbiddenWriteRequest,
  isStockExecutionRequest,
} from './actions/financeGuard';
import { answerLanguage, type AiLang } from './engine';
import { isProcedureQuestion } from './intentHints';

export { isProcedureQuestion } from './intentHints';

export type ReadTopic = 'screen' | 'sales' | 'cashbox' | 'lowStock' | 'outOfStock' | 'expiry' | 'debts' | 'productRank' | 'stockItem' | 'stockSales';

/** A request the existing reads cannot answer. No figure is invented for it. */
export type ReadGap = 'fullCatalog';

export interface ReadRange {
  from: string;
  to: string;
  label: DatePreset;
  limited: boolean;
}

export interface ReadRequest {
  topics: ReadTopic[];
  gaps: ReadGap[];
  range: ReadRange;
  /** Period used for product ranking. It can differ from `range` when two periods are compared. */
  rankRange: ReadRange;
  compareRange: ReadRange | null;
  rankLimit: number | 'all';
  rankBy: 'units' | 'revenue';
  /** Inclusive stock maximum from “below N”, or null to use the store setting. */
  stockBelow: number | null;
  /** Exact product name or barcode typed in the question. Null when no product was named. */
  stockName: string | null;
  /** Quantity the question asks to check against current stock. */
  stockQty: number | null;
  /** Low stock, zero stock, or both, joined with posted sales. Null when the question does not ask for that join. */
  stockSales: 'low' | 'out' | 'both' | null;
  includeProfit: boolean;
  /**
   * Profit-only questions. `off` keeps the sales note unchanged.
   * `net` is the default figure (after recorded expenses). `gross` and `detail` are explicit.
   */
  profitAnswer: 'off' | 'net' | 'gross' | 'detail';
  /** Which revenue figure a sales question asked for. Unspecified stays the net-sales note. */
  salesFigure: 'unspecified' | 'gross' | 'net' | 'both';
  refusesAction: boolean;
  /** Procedure and live-data signals both fired — ask which one the user wants. */
  clarify: boolean;
  lang: AiLang;
}

const COMMAND = /^(?:please\s+)?(?:complete|submit|delete|refund|adjust|change|move|pay|deposit|withdraw|execute|run|checkout)\b|^(?:كمّل|خلّص|خلص|عدّل|احذف|ارجع|ادفع|حرّك)/i;
const UNIT_RANK = /best[- ]sell|most sold|top products?|units of each|how many units of each|أكتر\s*\d*\s*منتج|اكتر\s*\d*\s*منتج|الأكثر مبيع|الاكثر مبيع|أكتر شي انباع|اكتر شي انباع|انباعوا|انباعت|وحدات من كل|كم وحدة/i;
const LIVE_PERIOD = /today|yesterday|week|month|year|this |last |\d{4}-\d{2}-\d{2}|اليوم|هاليوم|هالنهار|أمس|امبارح|البارحة|مبارح|اسبوع|أسبوع|الأسبوع|الاسبوع|الشهر|السنة|هالسنة/i;
/** Explicit ask for current store figures — not domain nouns inside a how-to sentence. */
const LIVE_FIGURE_CUE =
  /how much|how many|summar|\btotals?\b|\bcount\b|قديش|قدي|who owes|مين |best[- ]sell|most sold|top products?|units of each|low[- ]stock|out of stock|stock of\b|do we have\s+\d|products below|show (?:me )?(?:the )?(?:sales|cash|debt|stock|drawer|returns)\b/i;

function has(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

function wordsOf(text: string): string[] {
  return text.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 0);
}

const DEBT_WORD = /^(?:debts?|debtors?|outstanding|مدين|المدين|مديون|مديونة|مديونين|ديون|الديون|ديوني|ديونه|دين|الدين|دينا|دينه|دينو|دينها|دينهم|يدين|يديننا|يدينني|يدينو|يدينها)$/u;

function isPermissionOrPolicyAsk(text: string): boolean {
  return (
    isFinancialCapabilityQuestion(text) ||
    /\bpermissions?\b|\bwho\s+can\b|\bwhich\s+permission\b|\brequired\s+to\b|صلاح(?:ية|يات)|مين\s*(?:بيقدر|يقدر|عنده)|من\s*يقدر/i.test(text)
  );
}

/** Whole words only, so دين inside مدينة does not become a debt question. */
function asksDebts(text: string): boolean {
  if (isPermissionOrPolicyAsk(text)) return false;
  // Credit-limit how-tos mention دين / debt as a concept, not a live debtor list.
  if (/credit\s*limits?|سقف\s*الدين|حد\s*الدين|سقف\s*ائتمان/i.test(text)) return false;
  // How-to collect / record debt payment — guide territory, not live debtors (unless also asking "how much").
  if (
    isProcedureQuestion(text) &&
    /collect|record|receive|payment|ستلم|سدد|حصّل|تسديد|استلام/i.test(text) &&
    !LIVE_FIGURE_CUE.test(text)
  ) {
    return false;
  }
  if (isFinancialExecutionRequest(text) || isStockExecutionRequest(text)) return false;
  const words = wordsOf(text);
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!.toLowerCase();
    if (DEBT_WORD.test(word)) return true;
    const next = words[index + 1]?.toLowerCase() ?? '';
    if (word === 'who' && (next === 'owes' || next === 'owe')) return true;
    if (word === 'owe' || word === 'owes' || word === 'owed') return true;
    if (word === 'عليه' && (next === 'مصاري' || next === 'فلوس' || next === 'دين' || next === 'ديون')) return true;
  }
  return false;
}

const CASH_WORD = /^(?:cashbox|cash|drawer|الصندوق|بالصندوق|كاش|الكاش|بالكاش|الدرج|نقد|نقدا|نقدي|النقد)$/u;

/**
 * Conceptual / how-it-works talk that mentions cash/sales/debt nouns but is not asking for live figures.
 * Examples: cash vs credit difference, how discounts work, how USD/LBP transfers work.
 */
export function isConceptualFinanceExplain(text: string): boolean {
  const q = text.trim();
  if (!q) return false;
  return (
    /\bdifference\s+between\b|\bcash\s+(?:vs\.?|versus|and)\s+credit\b|\bcredit\s+(?:vs\.?|versus|and)\s+cash\b/i.test(q) ||
    /\bhow\s+do(?:es)?\s+.+\bwork\b|\bhow\s+do(?:es)?\s+\w[\w\s]{0,48}\bwork\b/i.test(q) ||
    /\bdiscounts?\b.+\b(?:work|sale|cart|pos)\b|\b(?:work|apply).+\bdiscounts?\b/i.test(q) ||
    /\bcash\s+transfers?\b|\btransfers?\s+between\b.+\b(?:usd|lbp|currency|currencies)\b|\b(?:usd|lbp).+\btransfers?\b/i.test(q) ||
    /شو\s*الفرق|ما\s*(?:هو\s*)?الفرق|فرق\s*بين|كيف\s*(?:ب)?(?:ي)?شتغل|كيف\s*يعمل|تحويل\s*بين|خصم.*(?:بيع|سلة)|الدين\s*والنقد|نقد\s*ودين/i.test(q)
  );
}

/** Whole words only, so كاش inside كاشير does not open the drawer. */
function asksCash(text: string): boolean {
  if (isPermissionOrPolicyAsk(text)) return false;
  // "cash vs credit" / "how do cash transfers work" are explanations, not drawer reads.
  if (isConceptualFinanceExplain(text)) return false;
  return wordsOf(text).some((word) => CASH_WORD.test(word.toLowerCase()));
}

const LOW_STOCK = /low[- ]stock|low on stock|low in stock|low current stock|running out|almost out|مخزون(?:ها|ه)? قليل|مخزون منخفض|منخفض|نفاذ المخزون|قربت تخل|قرب يخل|عم يخل|بدها تخل/i
const OUT_STOCK = /out of stock|stock is zero|نفد المخزون|خلصت المنتجات|خلصت البضاعة|خلصان|خلّصان|خلصانة|كمية صفر|below\s+1\b|أقل من 1|اقل من 1/i;
const SOLD_LINK = /also sold|that sold|which sold|had (?:recorded )?sales|with sales|alongside|highest net units|net units sold|بس انباع|و\s*(?:انباع|انباعت)|اللي انباع|التي انباع|اللي انباعت|التي بيعت/i;

/** A joined stock-and-sales question. Separate low-stock and best-seller questions stay on their own topics. */
export function stockSalesMode(text: string): 'low' | 'out' | 'both' | null {
  const low = LOW_STOCK.test(text) || (stockBelowOf(text) != null && /sold|انباع|انباعت|sales|مبيعات/i.test(text));
  const out = OUT_STOCK.test(text);
  const linked = SOLD_LINK.test(text)
    || ((low || out) && /sold|انباع|انباعت/i.test(text) && /product|منتج|أصناف|اصناف|بضاعة/i.test(text));
  if (!linked) return null;
  if (low && out) return 'both';
  if (out) return 'out';
  if (low) return 'low';
  return null;
}

/**
 * Live sales/returns totals — not the noun “sale” inside a how-to sentence
 * (“processing a sale”, “complete the sale steps”).
 */
export function asksSalesTotals(text: string): boolean {
  // Conceptual sale talk ("discounts in a sale", "cash vs credit sales") is not a totals ask.
  if (isConceptualFinanceExplain(text)) return false;
  if (has(text, /بعنا|بعت|بعتوا|بعتو|بيعنا|مبيعات|فاتور|مرتجع/i)) return true;
  if (has(text, /how much|summar|\btotals?\b/i) && has(text, /\bsales?\b|\bsells?\b|\bsold\b|\breturns?\b|invoices?|انباع|مبيع/i)) return true;
  if (has(text, /\bsales?\b|\breturns?\b|invoices?/i) && has(text, LIVE_PERIOD)) return true;
  // Require \bcount\b — bare "count" falsely matches inside "discounts".
  if (has(text, /\bsales?\b|\breturns?\b/i) && has(text, /did we|we (?:sell|sold|make|take)|net |gross |\bcount\b|how many/i)) return true;
  if (has(text, /\brevenue\b/i) && !has(text, /by revenue|revenue ranking|rank by revenue|حسب الإيراد|بالإيراد/i)) return true;
  if (has(text, /\bsells?\b|\bsold\b|انباع/i) && !has(text, UNIT_RANK) && has(text, /how much|how many|total|summar|قديش|كم |today|yesterday|week|month|اليوم/i)) {
    return true;
  }
  return false;
}

/**
 * “Did I profit today?” is a live gross/net figure from the daily aggregate.
 * A profit *report* stays on knowledge — that page is not a live read.
 */
export function asksProfitFigure(text: string): boolean {
  if (/\breports?\b|تقرير|تقارير/i.test(text)) return false;
  return /ربحت|ربحنا|ربحو|ربحي|ربحك|ربحان|ربحانة|رابح|رابحين|كسبت|كسبنا|بدي\s*(?:اعرف|أعرف)\s*.{0,24}ربح|كيف\s+الربح|شو\s+الربح|شو\s+وضع\s+الربح|how(?:'s| is) my profit|my\s+ربح|ربح\s+today|\bprofit(?:ed|able)?\b|\bmy profit\b|\bmade money\b/i.test(text);
}

function salesFigureOf(text: string): 'unspecified' | 'gross' | 'net' | 'both' {
  const gross = /\bgross\b|إجمالي|اجمالي|قبل المرتجعات/i.test(text);
  const net = /\bnet\b|صافي|بعد المرتجعات/i.test(text);
  if (gross && net) return 'both';
  if (gross) return 'gross';
  if (net) return 'net';
  return 'unspecified';
}

/** A profit question that is not also asking for the sales totals. */
export function profitAnswerOf(text: string): 'off' | 'net' | 'gross' | 'detail' {
  if (!asksProfitFigure(text) || asksSalesTotals(text)) return 'off';
  if (/detail|breakdown|break down|itemize|explain|تفصيل|فصّ?ل|اشرح|ليش الربح|لماذا الربح/i.test(text)) return 'detail';
  const gross = /\bgross\b|إجمالي|اجمالي|قبل المصاريف/i.test(text);
  const net = /\bnet\b|صافي|بعد المصاريف/i.test(text);
  if (gross && !net) return 'gross';
  return 'net';
}

/**
 * True when the user is asking for live store numbers now.
 * Procedural mentions of cash/stock/debt/return do not count by themselves.
 */
export function asksExplicitLiveFigures(text: string): boolean {
  const topics = topicsOf(text);
  const gaps = gapsOf(text, topics);
  if (topics.length === 0 && gaps.length === 0) return false;
  if (LIVE_FIGURE_CUE.test(text)) return true;
  if (LIVE_PERIOD.test(text)) return true;
  return false;
}

function topicsOf(text: string): ReadTopic[] {
  const topics: ReadTopic[] = [];
  const add = (topic: ReadTopic) => {
    if (!topics.includes(topic)) topics.push(topic);
  };
  if (has(text, /where am i|what page|this screen|هالصفحة|هاي الصفحة|هيدي الصفحة|هيدي الشاشة|أي صفحة|شو الصفحة|وين أنا/i)) add('screen');
  const joined = stockSalesMode(text);
  const rank = has(text, UNIT_RANK);
  if ((asksSalesTotals(text) || asksProfitFigure(text)) && !joined) add('sales');
  if (rank && !joined) add('productRank');
  if (asksCash(text)) add('cashbox');
  // "What settings control low stock?" is settings how-to, not a live low-stock list.
  const settingsStockTalk =
    has(text, /settings?|إعداد|threshold|حد(?:\s*ال)?مخزون/i) && has(text, /low[- ]stock|low stock|مخزون/i);
  const stockListAsk = has(text, /how many|which products|show|list|قديش|شو المنتجات|المنتجات اللي|قربت تخل|running out|almost out/i);
  if (!joined && (LOW_STOCK.test(text) || stockBelowOf(text) != null) && !(settingsStockTalk && !stockListAsk)) add('lowStock');
  if (!joined && OUT_STOCK.test(text)) add('outOfStock');
  if (joined) add('stockSales');
  if (stockLookupOf(text).name) add('stockItem');
  if (has(text, /expir|صلاحية|صلاحيت|منتهي/i)) add('expiry');
  if (asksDebts(text)) add('debts');
  return topics;
}

function gapsOf(text: string, topics: ReadTopic[]): ReadGap[] {
  const gaps: ReadGap[] = [];
  const wholeCatalog = has(text, /كل المنتجات|كل الأصناف|كل الاصناف|every product|all products|full catalog/i);
  if (wholeCatalog && !topics.includes('lowStock') && !topics.includes('outOfStock') && !topics.includes('productRank') && !topics.includes('stockSales')) gaps.push('fullCatalog');
  return gaps;
}

function bounded(preset: DatePreset, now: Date): ReadRange {
  const span = presetRange(preset, now);
  const days = inclusiveDays(span.from, span.to);
  return { ...span, label: preset, limited: days === null || days > DAILY_STATS_LIMIT };
}

function rankingWindow(question: string, now: Date): { rankRange: ReadRange; compareRange: ReadRange | null } {
  const month = has(question, /this month|هذا الشهر|هالشهر/i);
  const last = has(question, /last month|الشهر الماضي/i);
  if (month && last) return { rankRange: bounded('month', now), compareRange: bounded('lastMonth', now) };
  const today = has(question, /\btoday\b|اليوم|هاليوم|هالنهار/i);
  const yesterday = has(question, /yesterday|أمس|امبارح|البارحة|مبارح/i);
  if (today && yesterday) return { rankRange: bounded('today', now), compareRange: bounded('yesterday', now) };
  return { rankRange: readRange(question, now), compareRange: null };
}

const GENERIC_STOCK_NAME = /^(?:products?|items?|stock|inventory|low stock|out of stock|منتجات|منتج|المخزون|البضاعة|الأصناف|الاصناف)$/i;

function tidyStockName(raw: string): string | null {
  const name = raw
    .replace(/[؟?].*/, '')
    .replace(/\s+(?:at|in|from)\s+.+\bstore\b.*$/i, '')
    .replace(/\s+بـ\s+.+$/u, '')
    .trim();
  if (name.length < 2 || name.length > 80) return null;
  if (GENERIC_STOCK_NAME.test(name)) return null;
  if (/low[- ]stock|out of stock|منخفض|نفاذ|خلصت|خلصان|قرب/i.test(name)) return null;
  return name;
}

/** “Below N” for an integer stock count is stock 1 through N − 1. Below 1 is zero stock, not this list. */
export function stockBelowOf(text: string): number | null {
  const match = text.match(/(?:below|under|less than|أقل من|اقل من|تحت(?:\s*الـ?)?)\s*(\d{1,6})/i);
  if (!match) return null;
  const asked = Number(match[1]);
  if (!Number.isInteger(asked) || asked <= 1 || asked > 100_000) return null;
  return asked - 1;
}

/** General stock-status phrasing ("low stock", "products running low") — never a single named product. */
const GENERAL_STOCK_QUESTION =
  /\b(?:products?|items?)\b.*\b(?:stock|available|left)\b|low[- ]?(?:in\s+)?stock|out of stock|stock\s+(?:is\s+)?low|منخفض|نفاذ|خلص(?:ت|ان)?|قرب\s*يخلص/i;

/** "this one", "it", "هيدا المنتج" — a reference to a product already in play, never a literal name. */
const STARTS_WITH_DEMONSTRATIVE =
  /^(?:it|that|this|the)\b|^(?:هيدا|هيدي|هاد|هاي|هالمنتج|هالغرض)(?=\s|$)/i;

export function stockLookupOf(text: string): { name: string | null; qty: number | null } {
  // Imperative stock changes are refusals — never a named stock-item read.
  if (isStockExecutionRequest(text)) return { name: null, qty: null };
  const qtyOf = text.match(/\bdo we have\s+(\d{1,6})\s+(?:of\s+)?(.+)$/i)
    ?? text.match(/(?:^|\s)(?:في|عنا|عندنا|فيه)\s+(\d{1,6})\s+(?:من\s+)?(.+)$/);
  if (qtyOf) {
    const name = tidyStockName(qtyOf[2] ?? '');
    return { name, qty: name ? Number(qtyOf[1]) : null };
  }
  const named = text.match(/\bstock of\s+(.+)$/i)
    ?? text.match(/\bhow many\s+(.+?)\s+(?:do we have|are left)\b/i)
    ?? text.match(/شو مخزون\s+(.+)$/)
    ?? text.match(/(?:قديش|كم)\s+في\s+(?:عنا\s+|عندنا\s+|فيه\s+)?(?:من\s+)?(.+)$/)
    // Name-first phrasing: "<product name> stock / quantity / available / left" (no leading keyword).
    // A sentence opening with a question word ("What reports are available?") names no product.
    ?? (GENERAL_STOCK_QUESTION.test(text) || STARTS_WITH_DEMONSTRATIVE.test(text.trim()) || /^(?:what|which|how|who|where|when|why|are|is|do|does|can)\b/i.test(text.trim())
        ? null
        : text.match(/^(.{2,80}?)\s+(?:in\s+stock|stock|quantity|qty|available|left)\s*[؟?]?$/i))
    ?? (GENERAL_STOCK_QUESTION.test(text) || STARTS_WITH_DEMONSTRATIVE.test(text.trim())
        ? null
        : text.match(/^(.{2,80}?)\s+(?:بالمخزون|بالمخزن|موجود|متوفر|باقي)\s*[؟?]?$/));
  return { name: named ? tidyStockName(named[1] ?? '') : null, qty: null };
}

function rankLimitOf(text: string): number | 'all' {
  if (has(text, /units of each|how many units of each|each product|كل منتج|وحدات من كل|كم وحدة/i)) return 'all';
  const match = text.match(/(?:top|best|أكتر|اكتر|أول|اول)\s*(\d{1,2})/i);
  if (!match) return 5;
  const count = Number(match[1]);
  return count >= 1 && count <= 20 ? count : 5;
}

function asksForAction(text: string): boolean {
  return has(text, /complete the sale|change the stock|adjust the stock|move the cash|كمّل البيع|عدّل المخزون|حرّك المصاري/i);
}

function inclusiveDays(from: string, to: string): number | null {
  const start = parseLocalDate(from);
  const end = parseLocalDate(to);
  if (!start || !end) return null;
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

export function readRange(question: string, now: Date): ReadRange {
  const dates = [...question.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map((match) => match[1]!);
  if (dates.length >= 2) {
    const from = dates[0]!;
    const to = dates[1]!;
    const days = inclusiveDays(from, to);
    return { from, to, label: 'custom', limited: days === null || days < 1 || days > DAILY_STATS_LIMIT };
  }
  let preset: DatePreset = 'today';
  if (has(question, /yesterday|أمس|امبارح|البارحة|مبارح/i)) preset = 'yesterday';
  else if (has(question, /last month|الشهر الماضي/i)) preset = 'lastMonth';
  else if (has(question, /this week|\bweek\b|last 7|اسبوع|أسبوع|الأسبوع|الاسبوع/i)) preset = 'week';
  else if (has(question, /this month|هذا الشهر|هالشهر|الشهر/i)) preset = 'month';
  else if (has(question, /this year|\byear\b|هالسنة|السنة/i)) preset = 'year';
  const span = presetRange(preset, now);
  const days = inclusiveDays(span.from, span.to);
  return { ...span, label: preset, limited: days === null || days > DAILY_STATS_LIMIT };
}

function emptyRequest(lang: AiLang, now: Date, clarify: boolean): ReadRequest {
  const today = bounded('today', now);
  return {
    topics: [],
    gaps: [],
    range: today,
    rankRange: today,
    compareRange: null,
    rankLimit: 5,
    rankBy: 'units',
    stockBelow: null,
    stockName: null,
    stockQty: null,
    stockSales: null,
    includeProfit: false,
    profitAnswer: 'off',
    salesFigure: 'unspecified',
    refusesAction: false,
    clarify,
    lang,
  };
}

const PERIOD_FOLLOW_UP =
  /^(?:and\s+|و)?(?:today|yesterday|this week|this month|last month|this year|اليوم|هاليوم|هالنهار|أمس|امبارح|البارحة|مبارح|هالأسبوع|هالاسبوع|هالشهر|هذا الشهر|الشهر الماضي|هالسنة)\s*\??$/i;

/** A short period after a live question keeps that question and only changes the date. */
export function continueRead(previous: ReadRequest | null, question: string, now: Date = new Date()): ReadRequest | null {
  if (!previous || previous.clarify || previous.topics.length === 0) return null;
  if (!PERIOD_FOLLOW_UP.test(question.trim())) return null;
  const range = readRange(question, now);
  return { ...previous, range, rankRange: range, compareRange: null };
}

/** Null means this is not a store-data question. Documentation answers stay on the knowledge index. */
export function classifyRead(question: string, uiLang: AiLang, now: Date = new Date()): ReadRequest | null {
  const text = question.trim();
  if (text === '' || COMMAND.test(text)) return null;
  // Writes / capability / permission policy — never treat as live cash, stock, or debt reads.
  if (isForbiddenWriteRequest(text) || isFinancialCapabilityQuestion(text) || isPermissionOrPolicyAsk(text)) {
    return null;
  }
  // How-it-works / difference questions stay on knowledge even when they name cash/sales.
  if (isConceptualFinanceExplain(text) && !asksExplicitLiveFigures(text)) return null;
  // "بدي اعرف ربحي اليوم" matches the how-to cue "بدي اعرف" but is a live profit figure.
  const procedure = isProcedureQuestion(text) && !asksProfitFigure(text);
  const lang = answerLanguage(text, uiLang);
  // Procedural questions go to knowledge unless the user also asks for current figures.
  if (procedure) {
    if (asksExplicitLiveFigures(text)) return emptyRequest(lang, now, true);
    return null;
  }
  const topics = topicsOf(text);
  const gaps = gapsOf(text, topics);
  const hasLive = topics.length > 0 || gaps.length > 0;
  if (!hasLive) return null;
  const window = rankingWindow(text, now);
  const lookup = stockLookupOf(text);
  return {
    topics,
    gaps,
    range: readRange(text, now),
    rankRange: window.rankRange,
    compareRange: window.compareRange,
    rankLimit: rankLimitOf(text),
    rankBy: /by revenue|revenue ranking|rank by revenue|حسب الإيراد|بالإيراد/i.test(text) ? 'revenue' : 'units',
    stockBelow: stockBelowOf(text),
    stockName: lookup.name,
    stockQty: lookup.qty,
    stockSales: stockSalesMode(text),
    includeProfit: /profit|ربح|تكلفة|\bcost\b/i.test(text),
    profitAnswer: profitAnswerOf(text),
    salesFigure: salesFigureOf(text),
    refusesAction: asksForAction(text),
    clarify: false,
    lang,
  };
}
