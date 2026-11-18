/**
 * Zelvero AI turn planner.
 *
 * Decides, for one user message and the bounded session memory, exactly one of:
 *   read     → run the existing read-only snapshot (sales, profit, stock, debts, …)
 *   compare  → grounded period comparison / "why did it change" breakdown
 *   clarify  → ask a short question instead of guessing
 *   refuse   → scope or injection attempt (other stores, hidden instructions)
 *   pass     → not a data question: the existing operator / knowledge flow answers it
 *
 * The plan is computed from rules first. Product names and numbers come from the user's own words;
 * the language layer's spelling fixes only steer routing.
 */
import type { AiLang } from '../engine';
import { classifyRead, isProcedureQuestion, readRange, stockLookupOf, type ReadRange, type ReadRequest } from '../readIntent';
import { INSIGHT_DEFAULT_LIMIT, type InsightKind, type InsightSpec } from './insights';
import { readLanguage, type LanguageRead } from './language';
import type { ClarifyTopic, CompareMetric, CompareSpec, CopilotMemory, PendingClarify, PeriodSpec } from './memory';
import { previousPeriod, resolvePeriod } from './tools';

export const MAX_QUESTION_CHARS = 1000;

export type TurnPlan =
  | { kind: 'read'; request: ReadRequest; lang: AiLang; reason: string; followUp: boolean }
  | { kind: 'compare'; spec: CompareSpec; lang: AiLang; reason: string; followUp: boolean }
  | { kind: 'clarify'; lang: AiLang; text: string; pending: PendingClarify }
  | { kind: 'refuse'; lang: AiLang; text: string; reason: 'scope' | 'injection' }
  | { kind: 'insight'; spec: InsightSpec; lang: AiLang; reason: string; followUp: boolean }
  | { kind: 'pass'; lang: AiLang; routingText: string };

export interface PlanInput {
  text: string;
  uiLang: AiLang;
  memory: CopilotMemory;
  now: Date;
  /** False on platform-only sessions: there is no store to read. */
  hasTenant: boolean;
}

/* ------------------------------------------------------------------ guards */

const INJECTION =
  /ignore (?:all |the |any )?(?:previous|prior|above|earlier) (?:instructions|rules|messages)|disregard (?:your|the) (?:rules|instructions)|system prompt|developer mode|jailbreak|you are now|act as (?:an? )?(?:admin|root|developer|super ?admin)|reveal (?:your|the) (?:prompt|instructions|rules)|تجاهل (?:كل )?(?:التعليمات|القواعد)|انسى (?:كل )?(?:التعليمات|القواعد)|اعطيني التعليمات/i;

const OTHER_STORE =
  /\b(?:other|another|different|all|every|competitor'?s?)\s+(?:stores?|shops?|tenants?|businesses|customers'? stores?)\b|\btenant\s*id\b|\btenantid\b|\bstore\s*id\b|\buid\b|\bfirestore\b|\bdatabase\b|(?:ال)?(?:محل|متجر|محلات|متاجر)\s*(?:ال)?(?:تاني|ثاني|غير|تانية|ثانية|الجيران|الآخر|الاخر)|(?:كل|باقي)\s*(?:المحلات|المتاجر)|ma[7h]al\s*(?:el\s*|l\s*)?tene/i;

function refuseText(reason: 'scope' | 'injection', lang: AiLang): string {
  if (reason === 'scope') {
    return lang === 'ar'
      ? 'بقدر استعمل بس بيانات المحل يلي إنت داخل عليه، وحسب صلاحياتك. ما بقدر شوف أو قارن محلات تانية.'
      : 'I can only use the store you are signed in to, within your permissions. Other stores are not available.';
  }
  return lang === 'ar'
    ? 'ما بقدر غيّر طريقة شغلي أو قواعدي. اسألني عن المبيعات، الربح، المخزون، الديون، أو كيف تعمل شي بالنظام.'
    : 'I can’t change how I work or my rules. Ask me about sales, profit, stock, debts, or how to do something in the POS.';
}

/* ------------------------------------------------------------------ cue words (routing text) */

const COMPARE = /\bcompare\b|\bcomparison\b|\bvs\.?\b|\bversus\b|against last|قارن|مقارنة|مقابل|بالمقارنة/i;
// Arabic cue words must stand alone: "ليه" is also the tail of "عليه" ("who owes").
const WHY = /\bwhy\b|how come|what happened|reason|(?<![\u0600-\u06FF])(?:ليش|ليه|لماذا|لشو)(?![\u0600-\u06FF])|شو السبب|السبب/i;
const CHANGE_WORD = /drop|dropp|fell|fall|down|decreas|lower|less|declin|rose|rise|up\b|increas|higher|grew|more|نزل|نزلت|قلّ|قلّت|قلت|خف|خفّت|تراجع|انخفض|طلع|طلعت|زاد|زادت|ارتفع|تحسن/i;
const DETAILS = /^(?:(?:and |ok |okay |so |و|طيب |طب |يلا )?(?:show|give|tell)?\s*(?:me\s+)?(?:the\s+)?(?:details?|more|breakdown|break it down|full list|all of them|the rest|everything)\b|^(?:طيب |طب |و)?(?:فرجيني|وريني|اعطيني|عطيني|بدي)?\s*(?:التفاصيل|تفاصيل|تفصيل|الكل|كلهن|كلن|الباقي|أكتر|اكتر)\s*[؟?.!]*$)/i;
const PRODUCT_REF =
  /\b(?:it|that one|this one|that product|this product|the (?:first|second|third|1st|2nd|3rd|last) one|the (?:first|second|third|last)|#\s*[1-9])\b|هيدا|هيدي|هاد|هاي|هالمنتج|هالغرض|منو|منه|منها|الأول|الاول|التاني|الثاني|التالت|الثالث|الأخير|الاخير/i;
const STOCK_ASK = /stock|left|how many|in store|available|remaining|قديش|كم|باقي|في منو|في منه|بالمخزون|المخزون|موجود/i;
const PERIOD_WORD =
  /today|yesterday|week|month|year|اليوم|هاليوم|هالنهار|أمس|امبارح|البارحة|مبارح|اسبوع|أسبوع|الاسبوع|الأسبوع|الشهر|هالشهر|السنة|هالسنة|\d{4}-\d{2}-\d{2}/i;
const SLOW_MOVERS =
  /slow[- ]?moving|slow sellers?|not selling|isn'?t selling|aren'?t selling|dead stock|stuck (?:stock|items|products)|overstock|راكد|راكدة|واقفة|عم توقف|عم يوقف|ما عم تنباع|ما عم ينباع|ما بتنباع|ما بينباع|جامدة|جامد|كاسدة/i;
const INSIGHT_PATTERNS: Array<[InsightKind, RegExp]> = [
  [
    'bestProfit',
    /most profitable|highest profit|best (?:by )?profit|profit (?:by|per) product|which products? (?:make|made|bring|brought|earn|earned) (?:us )?(?:the )?most (?:profit|money)|أكتر (?:منتج )?(?:ربح|بيربح|ربّح)|الأكثر ربح|أربح منتج|اربح منتج|ربح كل منتج|شو (?:بيربحني|بيربّحني|عم يربحني)|أكتر شي بيربح|أحسن ربح/i,
  ],
  [
    'reorder',
    /re-?order|what (?:should|do) (?:i|we) (?:order|buy|restock)|how (?:much|many) (?:should|do) (?:i|we) (?:order|buy)|\brestock|purchase (?:suggestion|plan)|شو لازم (?:اطلب|اشتري|جيب)|شو بدي اطلب|قديش لازم اطلب|شو اطلب|اقتراح طلبية/i,
  ],
  [
    'stockout',
    /run(?:ning)? out|stock-?outs?\b|how long (?:will|does|would) .{0,40}last|days of (?:stock|cover)|when will .{0,40}(?:finish|run out)|رح يخلص|حيخلص|قرب يخلص|عم يخلص|قديش بيكفي|بيكفي|بتكفي|لإيمتى|لامتى بيكفي/i,
  ],
  ['slowMovers', SLOW_MOVERS],
  [
    'expiryRisk',
    /waste|spoil|at risk|before (?:it|they) expires?|expir\w* (?:loss|value|risk|cost)|(?:loss|lose|value) .{0,20}expir|خسارة|تلف|تخرب|قبل ما تنتهي|رح تنتهي قبل|صلاحية.{0,15}(?:خسارة|خطر)/i,
  ],
  ['suppliers', /\bsuppliers?\b|\bvendors?\b|\bpurchases?\b|bought from|spent on stock|what did we buy|cost (?:went|has gone) up|مورد|موردين|المورد|الموردين|مشتريات|المشتريات|اشترينا|دفعنا للمورد|غليت الكلفة/i],
  ['trends', /\btrends?\b|trending|rising|falling|growing|declining|selling (?:more|less)|gaining|losing (?:popularity|sales)|عم يطلع|عم ينزل|ترند|اتجاه|عم يزيد مبيع|عم يقل مبيع|مبيعو عم/i],
];

function insightKindOf(routing: string, raw: string): InsightKind | null {
  if (isProcedureQuestion(routing) && !/run(?:ning)? out|how long .{0,40}last/i.test(routing)) return null;
  for (const [kind, pattern] of INSIGHT_PATTERNS) if (pattern.test(routing) || pattern.test(raw)) return kind;
  return null;
}

const BARE_AMBIGUOUS = /^(?:how much|how many|how much\?|what about it|قديش|كم|اديش|addeh|2adde|adde|kam)\s*[؟?!.]*$/i;
const TOPIC_WORDS: Array<[ClarifyTopic, RegExp]> = [
  ['profit', /profit|margin|ربح|أرباح|ارباح/i],
  ['sales', /sales|sold|revenue|turnover|مبيع|مبيعات|بعنا|انباع|ايراد|إيراد|دخل/i],
  ['bestSellers', /best[- ]?sell|top (?:products?|sellers?)|most sold|الأكثر مبيع|اكتر شي انباع|أكتر شي انباع/i],
  ['stock', /stock|inventory|مخزون|المخزون|بضاعة|البضاعة/i],
  ['debts', /debt|owe|دين|ديون|مديون/i],
  ['cashbox', /cash|drawer|صندوق|الصندوق|كاش/i],
];

function topicOf(text: string): ClarifyTopic | null {
  for (const [topic, pattern] of TOPIC_WORDS) if (pattern.test(text)) return topic;
  return null;
}

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/* ------------------------------------------------------------------ periods */

type NamedPeriod = 'today' | 'yesterday' | 'week' | 'lastWeek' | 'month' | 'lastMonth' | 'year';

const PERIOD_PATTERNS: Array<[RegExp, NamedPeriod]> = [
  [/last week|previous week|week before|الاسبوع الماضي|الأسبوع الماضي|الجمعة الماضية/i, 'lastWeek'],
  [/last month|previous month|الشهر الماضي/i, 'lastMonth'],
  [/yesterday|أمس|امبارح|البارحة|مبارح/i, 'yesterday'],
  [/this week|\bweek\b|هالاسبوع|هالأسبوع|الاسبوع|الأسبوع|اسبوع|أسبوع/i, 'week'],
  [/this month|\bmonth\b|هالشهر|هذا الشهر|الشهر/i, 'month'],
  [/this year|\byear\b|هالسنة|السنة/i, 'year'],
  [/today|اليوم|هاليوم|هالنهار/i, 'today'],
];

/** Period words in the order they appear. "this week with last week" → [week, lastWeek]. */
export function periodsInOrder(text: string): NamedPeriod[] {
  const found: Array<{ at: number; preset: NamedPeriod }> = [];
  let rest = text;
  for (const [pattern, preset] of PERIOD_PATTERNS) {
    const global = new RegExp(pattern.source, 'gi');
    for (const match of rest.matchAll(global)) {
      found.push({ at: match.index ?? 0, preset });
    }
    // Blank out matches so "last week" is not also read as "week".
    rest = rest.replace(global, (m) => ' '.repeat(m.length));
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.preset);
}

function periodFromRange(range: ReadRange): PeriodSpec {
  return { from: range.from, to: range.to, label: range.label };
}

function comparePeriodsFor(text: string, now: Date, memory: CopilotMemory): { current: PeriodSpec; previous: PeriodSpec } {
  const named = periodsInOrder(text);
  if (named.length >= 2) {
    const a = resolvePeriod({ preset: named[0]! }, now);
    const b = resolvePeriod({ preset: named[1]! }, now);
    return a.from >= b.from ? { current: a, previous: b } : { current: b, previous: a };
  }
  const base = memory.lastCompare?.current ?? (memory.lastRead ? periodFromRange(memory.lastRead.range) : null);
  if (named.length === 1) {
    const only = resolvePeriod({ preset: named[0]! }, now);
    const pastOnly = named[0] === 'lastWeek' || named[0] === 'lastMonth' || named[0] === 'yesterday';
    if (pastOnly) {
      // "compare with last week" → this week vs last week; "with yesterday" → today vs yesterday.
      const current =
        base && base.from > only.to
          ? base
          : resolvePeriod({ preset: named[0] === 'lastMonth' ? 'month' : named[0] === 'yesterday' ? 'today' : 'week' }, now);
      return { current, previous: named[0] === 'lastMonth' ? only : current.label === 'today' && named[0] === 'yesterday' ? only : previousPeriod(current) };
    }
    return { current: only, previous: named[0] === 'month' ? resolvePeriod({ preset: 'lastMonth' }, now) : previousPeriod(only) };
  }
  // No period named: keep the last comparison as it was, otherwise compare the last read (or 7 days) with the period before.
  if (memory.lastCompare) return { current: memory.lastCompare.current, previous: memory.lastCompare.previous };
  const current = base ?? resolvePeriod({ preset: 'week' }, now);
  return { current, previous: previousPeriod(current) };
}

/* ------------------------------------------------------------------ clarify */

const CLARIFY_LABEL: Record<ClarifyTopic, { en: string; ar: string }> = {
  sales: { en: 'sales', ar: 'المبيعات' },
  profit: { en: 'profit', ar: 'الربح' },
  stock: { en: 'stock', ar: 'المخزون' },
  debts: { en: 'customer debts', ar: 'ديون الزباين' },
  cashbox: { en: 'cash drawer', ar: 'الصندوق' },
  bestSellers: { en: 'best sellers', ar: 'الأكثر مبيعاً' },
};

function clarifyPlan(lang: AiLang, question: string, options: ClarifyTopic[], compare: boolean): TurnPlan {
  const list = options.map((o, i) => `${i + 1}. ${lang === 'ar' ? CLARIFY_LABEL[o].ar : CLARIFY_LABEL[o].en}`).join('  ');
  const text = compare
    ? lang === 'ar'
      ? `شو بدك قارن؟ ${list}`
      : `What should I compare? ${list}`
    : lang === 'ar'
      ? `قصدك شو بالضبط؟ ${list}`
      : `Which one do you mean? ${list}`;
  return { kind: 'clarify', lang, text, pending: { need: 'topic', question, options, compare } };
}

function answerToClarify(text: string, pending: PendingClarify): ClarifyTopic | null {
  const trimmed = text.trim();
  const index = /^[1-6]$/.test(trimmed) ? Number(trimmed) - 1 : -1;
  if (index >= 0 && index < pending.options.length) return pending.options[index]!;
  return topicOf(trimmed);
}

/* ------------------------------------------------------------------ builders */

function readFor(topic: ClarifyTopic, routing: string, lang: AiLang, now: Date): ReadRequest | null {
  const phrase: Record<ClarifyTopic, string> = {
    sales: 'how much sales',
    profit: 'how much profit',
    stock: 'low stock',
    debts: 'who owes',
    cashbox: 'how much cash in the drawer',
    bestSellers: 'best selling products',
  };
  const period = periodsInOrder(routing)[0];
  const periodWords = period === 'lastWeek' ? '' : period ? ` ${period === 'lastMonth' ? 'last month' : period}` : '';
  const request = classifyRead(`${phrase[topic]}${periodWords}`, lang, now);
  if (!request) return null;
  if (period === 'lastWeek') {
    const span = resolvePeriod({ preset: 'lastWeek' }, now);
    const range: ReadRange = { from: span.from, to: span.to, label: 'custom', limited: false };
    return { ...request, range, rankRange: range, lang };
  }
  return { ...request, lang };
}

function metricFor(routing: string, memory: CopilotMemory): CompareMetric | null {
  if (/profit|margin|ربح|أرباح|ارباح/i.test(routing)) return 'profit';
  if (/sales|sold|revenue|مبيع|مبيعات|بعنا|انباع|ايراد|إيراد/i.test(routing)) return 'sales';
  if (memory.lastCompare) return memory.lastCompare.metric;
  if (memory.lastRead?.profitAnswer && memory.lastRead.profitAnswer !== 'off') return 'profit';
  if (memory.lastRead?.topics.includes('sales')) return 'sales';
  return null;
}

/* ------------------------------------------------------------------ main */

export function planTurn(input: PlanInput): TurnPlan {
  // eslint-disable-next-line no-control-regex -- deliberate: strips control characters from raw user input before any processing.
  const raw = input.text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, MAX_QUESTION_CHARS);
  const language: LanguageRead = readLanguage(raw, input.uiLang);
  const lang = language.reply;
  const routing = language.routingText;
  const { memory, now } = input;

  if (INJECTION.test(raw) || INJECTION.test(routing)) return { kind: 'refuse', lang, text: refuseText('injection', lang), reason: 'injection' };
  if (OTHER_STORE.test(raw) || OTHER_STORE.test(routing)) return { kind: 'refuse', lang, text: refuseText('scope', lang), reason: 'scope' };
  if (!input.hasTenant) return { kind: 'pass', lang, routingText: routing };

  // 1. Answer to an open clarification.
  if (memory.pending) {
    const topic = answerToClarify(routing, memory.pending);
    if (topic) {
      const context = `${memory.pending.question} ${routing}`;
      if (memory.pending.compare && (topic === 'sales' || topic === 'profit')) {
        const periods = comparePeriodsFor(context, now, memory);
        return { kind: 'compare', lang, followUp: true, reason: 'clarified-compare', spec: { metric: topic, ...periods, explain: false, detail: false } };
      }
      const read = readFor(topic, context, lang, now);
      if (read) return { kind: 'read', request: read, lang, followUp: true, reason: 'clarified' };
    }
  }

  const hasData = Boolean(memory.lastRead || memory.lastCompare || memory.lastInsight);

  // 2. "Why did sales drop?" — always grounded comparison with breakdown.
  if (WHY.test(routing) && (CHANGE_WORD.test(routing) || (hasData && words(routing) <= 4))) {
    const metric = metricFor(routing, memory) ?? 'sales';
    const periods = comparePeriodsFor(routing, now, memory);
    return { kind: 'compare', lang, followUp: hasData, reason: 'why', spec: { metric, ...periods, explain: true, detail: true } };
  }

  // 3. Explicit comparison.
  if (COMPARE.test(routing) && !/best|top|product|منتج|انباع/i.test(routing)) {
    // Periods named without a metric ("compare this week with last week") default to sales.
    const metric = metricFor(routing, memory) ?? (periodsInOrder(routing).length > 0 ? 'sales' : null);
    if (!metric) return clarifyPlan(lang, routing, ['sales', 'profit'], true);
    const periods = comparePeriodsFor(routing, now, memory);
    return { kind: 'compare', lang, followUp: !/sales|profit|ربح|مبيع/i.test(routing), reason: 'compare', spec: { metric, ...periods, explain: false, detail: false } };
  }

  // 4a. "the second one", "هيدا", "it" → a product listed in the last answer.
  if (memory.products.length > 0 && words(routing) <= 12 && PRODUCT_REF.test(routing) && STOCK_ASK.test(routing)) {
    const index = /second|2nd|#\s*2|التاني|الثاني/i.test(routing)
      ? 1
      : /third|3rd|#\s*3|التالت|الثالث/i.test(routing)
        ? 2
        : /\blast\b|الأخير|الاخير/i.test(routing)
          ? memory.products.length - 1
          : 0;
    const name = memory.products[Math.min(index, memory.products.length - 1)]!;
    const request = classifyRead(`how many ${name} do we have in stock`, lang, now);
    if (request) return { kind: 'read', request: { ...request, stockName: name, lang }, lang, followUp: true, reason: 'product-reference' };
  }

  // 4b. Short follow-ups on the last data answer.
  if (hasData && words(routing) <= 6) {
    if (DETAILS.test(routing.trim())) {
      if (memory.lastKind === 'insight' && memory.lastInsight) {
        return { kind: 'insight', lang, followUp: true, reason: 'details', spec: { ...memory.lastInsight, limit: 20 } };
      }
      if (memory.lastKind === 'compare' && memory.lastCompare) {
        return { kind: 'compare', lang, followUp: true, reason: 'details', spec: { ...memory.lastCompare, detail: true } };
      }
      if (memory.lastRead) {
        const last = memory.lastRead;
        const request: ReadRequest = {
          ...last,
          lang,
          rankLimit: last.topics.includes('productRank') ? 'all' : last.rankLimit,
          profitAnswer: last.profitAnswer === 'off' ? 'off' : 'detail',
        };
        return { kind: 'read', request, lang, followUp: true, reason: 'details' };
      }
    }
    if (PERIOD_WORD.test(routing) && !topicOf(routing)) {
      if (memory.lastKind === 'insight' && memory.lastInsight) {
        const named = periodsInOrder(routing)[0];
        if (named) return { kind: 'insight', lang, followUp: true, reason: 'period-swap', spec: { ...memory.lastInsight, period: resolvePeriod({ preset: named }, now) } };
      }
      if (memory.lastKind === 'compare' && memory.lastCompare) {
        const periods = comparePeriodsFor(routing, now, { ...memory, lastCompare: null, lastRead: null });
        return { kind: 'compare', lang, followUp: true, reason: 'period-swap', spec: { ...memory.lastCompare, ...periods } };
      }
      if (memory.lastRead) {
        const named = periodsInOrder(routing)[0];
        const span = named === 'lastWeek' ? resolvePeriod({ preset: 'lastWeek' }, now) : null;
        const range: ReadRange = span ? { from: span.from, to: span.to, label: 'custom', limited: false } : readRange(routing, now);
        return { kind: 'read', request: { ...memory.lastRead, range, rankRange: range, compareRange: null, lang }, lang, followUp: true, reason: 'period-swap' };
      }
    }
  }

  // 5a. Business insights: profit ranking, slow movers, stock-outs, reorder, trends, suppliers, expiry risk.
  const insight = insightKindOf(routing, raw);
  if (insight) {
    const named = periodsInOrder(routing)[0];
    const fallback: NamedPeriod = insight === 'trends' ? 'week' : 'month';
    const period = resolvePeriod({ preset: named ?? fallback }, now);
    const all = /\ball\b|full list|everything|كل|كلهن|الكل/i.test(routing);
    return {
      kind: 'insight',
      lang,
      followUp: false,
      reason: 'insight',
      spec: { kind: insight, period, limit: all ? 20 : INSIGHT_DEFAULT_LIMIT },
    };
  }

  // 5b. Direct data question through the existing, tested intent rules.
  const request = classifyRead(routing, lang, now);
  if (request) {
    if (request.clarify) return clarifyPlan(lang, routing, ['sales', 'profit', 'stock'], false);
    // Names and quantities always come from the original words, never from the spelling-fixed text.
    const original = stockLookupOf(raw);
    const fixed: ReadRequest = {
      ...request,
      lang,
      stockName: request.stockName ? (original.name ?? request.stockName) : null,
      stockQty: request.stockName ? (original.qty ?? request.stockQty) : request.stockQty,
    };
    const lastWeek = periodsInOrder(routing).includes('lastWeek') && !COMPARE.test(routing);
    if (lastWeek) {
      const span = resolvePeriod({ preset: 'lastWeek' }, now);
      const range: ReadRange = { from: span.from, to: span.to, label: 'custom', limited: false };
      return { kind: 'read', request: { ...fixed, range, rankRange: range }, lang, followUp: false, reason: 'direct' };
    }
    return { kind: 'read', request: fixed, lang, followUp: false, reason: 'direct' };
  }

  // 6. Too vague to route: ask instead of guessing.
  if (BARE_AMBIGUOUS.test(routing.trim()) || BARE_AMBIGUOUS.test(raw.trim())) {
    return clarifyPlan(lang, routing, ['sales', 'profit', 'stock'], false);
  }

  return { kind: 'pass', lang, routingText: routing };
}
