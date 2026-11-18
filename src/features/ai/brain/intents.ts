/**
 * Zelvero AI's own understanding layer. It runs before the existing rule planner and either:
 *   - answers a question type the planner does not cover (store briefing, advice, one figure), or
 *   - rewrites a natural question into the plain phrasing the tested planner already handles
 *     ("is today better than yesterday?" → "compare sales today with yesterday").
 *
 * Product names in a rewrite are copied from the person's own words, never from a spelling fix.
 */
import type { AiLang } from '../engine';
import type { PeriodSpec } from '../copilot/memory';
import { periodsInOrder } from '../copilot/orchestrator';
import { readLanguage } from '../copilot/language';
import { resolvePeriod } from '../copilot/tools';
import type { Metric } from './metrics';

export type BrainIntent =
  | { kind: 'briefing'; period: 'today' | 'week' | 'month' }
  | { kind: 'advice' }
  | { kind: 'metric'; metric: Metric; period: PeriodSpec }
  | { kind: 'stock'; product: string; qty: number | null }
  | { kind: 'rewrite'; text: string; why: string }
  | { kind: 'operator'; text: string };

/** Lebanese Arabizi words the planner's dictionary does not carry (how-to and stock phrasing). */
const EXTRA_ARABIZI: Record<string, string> = {
  kif: 'كيف', keef: 'كيف', kef: 'كيف', kiif: 'كيف',
  bzid: 'ضيف', zid: 'ضيف', bzeed: 'ضيف', bdif: 'ضيف', dif: 'ضيف', bdeef: 'ضيف', deef: 'ضيف',
  mantoj: 'منتج', mantouj: 'منتج', montaj: 'منتج', mantuj: 'منتج', mantoujet: 'منتجات', mantoujat: 'منتجات',
  jdid: 'جديد', jdide: 'جديدة', jdeed: 'جديد',
  ba3mel: 'بعمل', b3mel: 'بعمل', a3mel: 'اعمل', '3mel': 'اعمل', bsawi: 'بعمل', sawi: 'اعمل',
  return: 'مرتجع', retour: 'مرتجع', marja3: 'مرتجع', mortaja3: 'مرتجع', raje3: 'مرتجع',
  zboun: 'زبون', zbun: 'زبون', zbouneh: 'زبون', zbayen: 'زباين', zbeyen: 'زباين',
  khasem: 'خصم', '5asem': 'خصم', '7asm': 'خصم', discount: 'خصم', descount: 'خصم',
  sajjel: 'سجّل', bsajjel: 'سجّل', sajel: 'سجّل',
  fatoura: 'فاتورة', fetoura: 'فاتورة', fwatir: 'فواتير',
  sandou2: 'الصندوق', sandou: 'الصندوق',
  dyoun: 'ديون', deyn: 'دين', mowared: 'مورد', mwared: 'مورد', mushtarayat: 'مشتريات',
  bi3: 'بيع', bebi3: 'ببيع', bbi3: 'ببيع', taba3: 'طبع', ba2ba3: 'بطبع', btba3: 'بطبع', print: 'طبع',
  qadeish: 'قديش', qadesh: 'قديش', '2adeish': 'قديش', addaish: 'قديش',
  saraft: 'صرفت', sarafna: 'صرفنا', sarafet: 'صرفت',
  ana: '', please: '', plz: '', pls: '', ya: '',
};

/** Common English typos for the words routing depends on. Applied to whole words only. */
const TYPOS: Record<string, string> = {
  salse: 'sales', slaes: 'sales', sals: 'sales', sales0: 'sales', saels: 'sales', seles: 'sales',
  proft: 'profit', profti: 'profit', porfit: 'profit', profet: 'profit', prfit: 'profit', proffit: 'profit',
  stcok: 'stock', stok: 'stock', stoke: 'stock',
  todya: 'today', tody: 'today', toady: 'today', tdy: 'today',
  yestrday: 'yesterday', yesterdy: 'yesterday', yesteday: 'yesterday',
  reordr: 'reorder', reoder: 'reorder', reorer: 'reorder',
  waht: 'what', wat: 'what', whta: 'what',
  shoud: 'should', shuld: 'should', shoudl: 'should',
  bussiness: 'business', busines: 'business', buisness: 'business', bizness: 'business',
  summery: 'summary', sumary: 'summary', summry: 'summary',
  prodcts: 'products', prodcuts: 'products', proudcts: 'products', produts: 'products',
  custmers: 'customers', costumers: 'customers', customres: 'customers',
  monht: 'month', moth: 'month', weeek: 'week', wek: 'week',
  hwo: 'how', hw: 'how', mch: 'much', mcuh: 'much',
};

/** Fixes known English typos word by word; everything else is left exactly as written. */
export function fixTypos(text: string): string {
  return text.replace(/[A-Za-z]+/g, (w) => {
    const hit = TYPOS[w.toLowerCase()];
    return hit ?? w;
  });
}

function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFC')
    .replace(/[ً-ْـ]/g, '')
    .replace(/([a-z])\1{2,}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Arabic-script routing text including the extra Arabizi words above (routing only). */
export function arabiziRouting(raw: string, uiLang: AiLang): string {
  const base = readLanguage(raw, uiLang).routingText;
  return base
    .replace(/[A-Za-z0-9']+/g, (token) => {
      const key = token.toLowerCase().replace(/^(?:el|l|al)(?=[a-z2-9]{3,})/, '');
      const hit = EXTRA_ARABIZI[token.toLowerCase()] ?? EXTRA_ARABIZI[key];
      return hit === undefined ? token : hit;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

const HOW_TO = /\bhow (?:do|to|should) i (?:make|record|add|give|do|enter|create|register|print|process|handle|issue)\b|\bhow (?:do|to) (?:you |we )?(?:make|record|add|give|do|enter|create|print|process)\b|كيف (?:ب)?(?:عمل|اعمل|سجّل|سجل|ضيف|طبع|ساوي)|kif (?:b)?(?:a3mel|3mel|sajjel|dif|zid|taba3|sawi|ba3mel)\b/i;

const BRIEFING =
  /how(?:'s| is| are)? (?:business|things|the (?:shop|store|business|day)|it going|work going)\b|how(?:'s| is) (?:today|my (?:shop|store|business|day))\b|\b(?:summary|summarize|summarise|overview|recap|briefing|daily report|morning report)\b|what'?s (?:new|up|happening)\b|anything (?:i should know|important|urgent|to (?:watch|worry about))|what needs (?:my )?attention|كيف (?:ال)?(?:شغل|شغلة|شغلات|وضع|محل|دكان|نهار)(?![\u0600-\u06FF])|كيف الحال بالمحل|ملخص|ملخّص|لخص|لخّص|نظرة عامة|تقرير (?:عن )?(?:اليوم|يومي|هال?شهر|الشهر|شهري|هال?اسبوع|الاسبوع|هالجمعة|اسبوعي|المحل)|\b(?:daily|weekly|monthly) report\b|\breport (?:for|of|on) (?:today|this week|this month|the (?:shop|store))\b|شو (?:في )?(?:جديد|الجديد)|شو صاير|في شي لازم (?:انتبه|اعرفه)|شو لازم انتبه|شو المهم(?![\u0600-\u06FF])|kif (?:el |l )?(?:shoghol|sho8ol|shoghl|shogl|wad3|ma7al|mahal|nhar|dekene|dikkene|shoghel)\b|kif l ?yom\b|(?:shu|sho|chou) (?:fi )?(?:el |l )?jdid\b|mula5as|mulakhas|mol5as|la5esle|lakhesle|la55esle/i;

const ADVICE =
  /how (?:can|do|could|should) (?:i|we) (?:increase|boost|grow|improve|raise|get more|double)\b|make more (?:money|profit|sales)|sell more\b|\b(?:tips|advice|recommendations?|suggestions?)\b|what (?:should|do you suggest|would you suggest) (?:i|we) do|what do you (?:think|recommend|suggest)|your (?:opinion|advice)|كيف (?:ب)?(?:زيد|زوّد|زود|كبّر|كبر|حسّن|حسن|علّي) (?:ال)?(?:مبيعات|ربح|أرباح|ارباح|بيع|شغل)|كيف (?:بربح|ببيع|بطلّع) أكتر|نصيحة|نصايح|نصائح|شو بتنصحني|شو بتقترح|شو رأيك|شو رايك|kif (?:b)?(?:zid|zeed|zawed|kabber|7assen|hassen) (?:el |l )?(?:mabi3at|mabee3at|rib7|ribh|arba7|bay3|bey3|shoghol)|kif (?:brba7|berba7|bebi3|bbi3) (?:aktar|akter)|nasi7a|nasaye7|(?:shu|sho) (?:btnsa7ne|btinsa7ni|btnsa7ni|bt2tere7|bt2tari7)|ra2yak|ra2ik/i;

const METRIC_PATTERNS: Array<[Metric, RegExp]> = [
  ['average', /\baverage (?:sale|ticket|basket|invoice|order)|\bavg (?:sale|ticket)|basket size|ticket size|معدّل (?:ال)?(?:فاتورة|بيعة|البيعة|الفاتورة)|معدل (?:ال)?(?:فاتورة|بيعة|البيعة|الفاتورة)|متوسط (?:ال)?(?:فاتورة|بيع|البيع|الفاتورة)|mo3adal|m3adal|wasati/i],
  ['expenses', /\bexpenses?\b|مصاريف|مصروف|صرفت|صرفنا|masarif|masaref|masrouf|\bsaraf(?:na|t|et)\b/i],
  ['returns', /\breturns?\b|\brefunds?\b|مرتجع|مرتجعات|رجّعوا|رجعوا|marja3|mrtaja3|raja3o/i],
  ['invoices', /how many (?:sales|invoices|receipts|orders|transactions|customers|clients)\b|number of (?:sales|invoices|customers|orders)|(?:قديش|كم|اديش) (?:فاتورة|زبون|زباين|عملية بيع)|عدد (?:ال)?(?:فواتير|زباين|زبائن)|(?:addeh|adde|2adde|kam) (?:fatoura|fetoura|zboun|zbun|zbayen)/i],
  ['discounts', /(?:total|how much) discounts?|discounts? (?:given|today|this|last|yesterday)|خصومات|(?:قديش|كم) .{0,15}(?:ال)?خصم|(?:addeh|adde|2adde|qadeish) .{0,15}(?:discount|7asm|khasem)/i],
  ['credit', /(?:sold|sales?) on credit|credit sales|بيع بالدين|مبيعات بالدين|بعنا بالدين|بعت بالدين|bi3na bl deyn|be3et bl deyn/i],
  ['collected', /(?:debts?|debt payments?) (?:collected|paid|received)|collected (?:debts?|payments?)|(?:تحصّل|تحصل|حصّلت|حصلت|قبضت|سدّدوا|سددوا) (?:من )?(?:ال)?(?:دين|ديون)|ديون (?:تحصّلت|تحصلت|انقبضت)/i],
];

const TOP_PRODUCTS =
  /\btop\s*(\d{1,2})?\s*(?:products|items|sellers|selling)\b|best[- ]?sell(?:ers|ing)|most sold|sold the most|selling the most|what (?:sold|sells|is selling) (?:the )?(?:most|best)|(?:أكتر|اكتر|أكثر) (?:شي|منتج|منتجات|أغراض|غرض) (?:انباع|عم ينباع|بينباع|مبيعاً)|(?:أحسن|احسن) (?:منتجات|منتج|شي) (?:انباع|عم ينباع|بينباع)|الأكثر مبيع|(?:a7san|aktar|akter|a7sen) (?:shi|mantoj|mantoujet|ghrad|8rad)? ?(?:enba3|nba3|inba3|byenba3|3am yenba3|mabi3an|mbi3an)/i;

const WORST_PRODUCTS =
  /\bworst (?:products|items|sellers|selling)|\bleast sold|lowest sales|not selling|isn'?t selling|aren'?t selling|(?:أقل|اقل) (?:شي|منتج|منتجات) (?:انباع|مبيعاً)|ما عم (?:ين|تن)باع|ما (?:بين|بتن)باع|(?:a2al|a2all|a2el) (?:shi|mantoj) (?:enba3|nba3)|ma (?:3am )?(?:yenba3|byenba3|tenba3)/i;

const OUT_NOW =
  /\bout of stock\b|\bsold out\b|what (?:ran|has run|is) out\b|شو (?:ال)?(?:بضاعة |منتجات |أغراض |اغراض )?(?:يلي |اللي )?(?:خلص|خلصت|خلصو|خلصوا|خالصة|خالص)|(?:5eles|5elset|5elso|5elsu|khelset|khelso|khales|5ales) ?(?:min|men)? ?(?:el |l )?(?:bda3a|bde3a|ma5zan|makhzan)?/i;

const FUTURE = /\bwill\b|going to|about to|soon|\bra7\b|رح |قرّب|قرب|عم ي|lal ?2ayem|forecast/i;

const TODAY_VS_YESTERDAY =
  /(?:today|el ?yom|lyom) .{0,20}(?:better|worse|more|less|a7san|ashwa|aktar|a2al) .{0,10}(?:than|men|min)? ?(?:yesterday|mbere7|mbare7|embere7|imbere7)|(?:better|worse) than yesterday|today vs\.? yesterday|today (?:compared|versus) (?:to |with )?yesterday|(?:أحسن|احسن|أسوأ|أعلى|أقل|اقل|أكتر|اكتر) من (?:امبارح|مبارح|أمس|البارحة)|(?:a7san|ashwa|aktar|a2al) (?:men|min) (?:mbere7|mbare7|embere7|imbere7)/i;

const MADE_MONEY =
  /how much (?:did|have) (?:we|i) (?:make|made|earn|earned)\b|what did (?:we|i) (?:make|earn)\b|how much (?:money )?(?:did|have) (?:we|i) (?:made|make)|(?:قديش|كم) (?:طلّعت|طلعت|طلّعنا|طلعنا|عملت|عملنا|كسبت|كسبنا)|(?:addeh|adde|2adde) (?:tala3et|tala3na|3melet|3mlt|3melna|kasabet|ksebt)/i;

const ENOUGH_FOR = /(?:is there|do (?:we|i) have|have (?:we|i) got|is it) enough (.{2,40}?) for (\d{1,5})\b|(?:في|بيكفي|بيكفّي) (?:عنا )?(?:كفاية |بيكفي )?(.{2,30}?) (?:لـ|ل) ?(\d{1,5})|(?:fi|byekfe|bikaffe) (?:3anna )?(.{2,30}?) (?:la|l) ?(\d{1,5})/i;

const LOW_NOW = /\blow (?:on )?stock\b|running low|(?:شو|shu|sho|which|what)\b.{0,25}(?:قليل|قليلة|2alil|2alile|alil|low)(?![\u0600-\u06FF])/i;

const STOCK_OF: RegExp[] = [
  /^(?:do|does) (?:we|i|you) (?:still )?(?:have|got) (?:any )?(.{2,40}?)(?: (?:in stock|left|available|in the shop))?[?.!]*$/i,
  /^(?:في عنا|في عندي|عنا|عندي|بعد في) (.{2,40}?)[؟?.!]*$/,
  /^(?:fi 3anna|fi 3ande|3anna|3ande|ba3d fi) (.{2,40}?)[?.!]*$/i,
  /how many (.{2,40}?) (?:do (?:we|i) have|are (?:there )?left|left|in stock|remaining)\b/i,
  /how much (.{2,40}?) (?:is left|do (?:we|i) have|left|in stock)\b/i,
  /\bstock (?:of|for) (.{2,40}?)[?.!]*$/i,
  /(?:قديش|كم|اديش|أديش) (?:باقي|بقي|في|عنا|عندي|ضل) (?:من |عنا من |عندي من )?(.{2,40}?)[؟?.!]*$/i,
  /(?:addeh|adde|2adde|2addeh|adesh|kam) (?:ba2e|ba2i|baki|b2i|fi|3anna|3ana|3ande|dal) (?:men |min |3anna men )?(.{2,40}?)[?.!]*$/i,
];

/** Words that make a "how many X" question about money/customers/sales, not a product. */
const NOT_A_PRODUCT = /masari|mesari|masare|money|cash|sandou|drawer|dyoun|deyn|debt|mabi3at|sales|rib7|profit|zboun|customer|fatoura|invoice|مصاري|الصندوق|صندوق|ديون|دين|مبيعات|ربح|زبون|زباين|فاتورة|فواتير|كاش|مخزون|بضاعة|bda3a|ma5zan|يوم|اليوم|lyom|today|week|month|hal|جمعة|شهر/i;

function namedPeriod(text: string, now: Date, fallback: 'today' | 'week' | 'month' = 'today'): PeriodSpec {
  const named = periodsInOrder(text)[0];
  return resolvePeriod({ preset: named ?? fallback }, now);
}

function periodPhrase(text: string): string {
  const named = periodsInOrder(text)[0];
  if (!named) return '';
  const map: Record<string, string> = { today: 'today', yesterday: 'yesterday', week: 'this week', lastWeek: 'last week', month: 'this month', lastMonth: 'last month', year: 'this year' };
  return ` ${map[named] ?? ''}`;
}

export function detectBrainIntent(rawInput: string, uiLang: AiLang, now: Date): BrainIntent | null {
  const raw = fixTypos(rawInput);
  const text = fold(raw);
  if (!text || text.length > 300) return null;
  const routing = arabiziRouting(raw, uiLang);
  const both = `${text} || ${routing}`;
  const howTo = HOW_TO.test(both);

  if (!howTo && BRIEFING.test(both)) {
    const named = periodsInOrder(routing)[0];
    const period = named === 'week' || named === 'lastWeek' ? 'week' : named === 'month' || named === 'lastMonth' ? 'month' : 'today';
    return { kind: 'briefing', period };
  }
  if (ADVICE.test(both)) return { kind: 'advice' };

  if (TODAY_VS_YESTERDAY.test(both)) {
    const metric = /profit|ربح|rib7|rbe7|arba7/i.test(both) ? 'profit' : 'sales';
    return { kind: 'rewrite', text: `compare ${metric} today with yesterday`, why: 'today-vs-yesterday' };
  }
  if (!howTo) {
    for (const [metric, pattern] of METRIC_PATTERNS) {
      if (pattern.test(both)) return { kind: 'metric', metric, period: namedPeriod(routing, now) };
    }
  }
  if (MADE_MONEY.test(both)) {
    return { kind: 'rewrite', text: `how much profit${periodPhrase(routing) || ' today'}`, why: 'made-money' };
  }

  const top = TOP_PRODUCTS.exec(text) ?? TOP_PRODUCTS.exec(routing);
  if (top && !/profit|ربح|rib7|margin/i.test(both)) {
    const n = top[1] ? Number(top[1]) : null;
    return { kind: 'rewrite', text: `top ${n ?? 5} best selling products${periodPhrase(routing) || ' this week'}`, why: 'top-products' };
  }
  if (WORST_PRODUCTS.test(both)) return { kind: 'rewrite', text: 'slow moving products', why: 'worst-products' };
  if (OUT_NOW.test(both) && !FUTURE.test(both)) return { kind: 'rewrite', text: 'which products are out of stock', why: 'out-of-stock' };

  if (LOW_NOW.test(both) && !FUTURE.test(both)) return { kind: 'rewrite', text: 'which products are low on stock', why: 'low-stock' };

  const enough = ENOUGH_FOR.exec(raw.trim());
  if (enough) {
    const product = (enough[1] ?? enough[3] ?? enough[5] ?? '').replace(/^(?:the|el|l|al|ال)\s*/i, '').trim();
    const qty = Number(enough[2] ?? enough[4] ?? enough[6]);
    if (product && !NOT_A_PRODUCT.test(product) && Number.isFinite(qty)) return { kind: 'stock', product, qty };
  }
  for (const pattern of STOCK_OF) {
    const m = pattern.exec(raw.trim());
    const product = m?.[1]?.replace(/^(?:the|el|l|al|ال)\s*/i, '').replace(/\s+(?:in stock|left|بالمحل|بالمخزون)$/i, '').trim();
    if (product && !NOT_A_PRODUCT.test(product) && product.split(/\s+/).length <= 5) {
      return { kind: 'stock', product, qty: null };
    }
  }

  // Arabizi how-to: hand the Arabic routing text back to the existing operator (guides + offers).
  if (/[a-z]/.test(text) && !/[\u0600-\u06FF]/.test(raw) && routing !== text && /كيف|طريقة/.test(routing)) {
    return { kind: 'operator', text: routing };
  }
  if (raw !== rawInput) return { kind: 'rewrite', text: raw, why: 'typos' };
  return null;
}
