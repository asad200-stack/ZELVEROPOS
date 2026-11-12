/**
 * Language handling for Zelvero AI: Lebanese Arabic, Modern Standard Arabic, English, Arabizi, and mixes.
 *
 * `routingText` is only used to decide WHICH read to run. Product names, quantities and amounts are
 * always taken from the user's original words, so a spelling fix can never change a business value.
 */
import type { AiLang } from '../engine';

export type InputLanguage = 'ar' | 'en' | 'arabizi' | 'mixed';

/** Harakat, superscript alef, Quranic marks and tatweel. */
const ARABIC_MARKS = /[ً-ٰٟۖ-ۭـ]/g;

/**
 * Lebanese Arabizi → the Arabic spelling the existing intent rules recognise.
 * Keys are lower-case Latin words after repeat folding (see `foldRepeats`).
 */
const ARABIZI: Record<string, string> = {
  // how much / how many
  addeh: 'قديش', adde: 'قديش', adesh: 'قديش', addesh: 'قديش', adeh: 'قديش', '2adde': 'قديش', '2addeh': 'قديش', '2adeh': 'قديش',
  '2addesh': 'قديش', '2adesh': 'قديش', adaysh: 'قديش', addaysh: 'قديش', addaish: 'قديش', addech: 'قديش', adech: 'قديش', ad2esh: 'قديش',
  kam: 'كم', kem: 'كم',
  // profit
  rbe7na: 'ربحنا', rbi7na: 'ربحنا', rba7na: 'ربحنا', rbehna: 'ربحنا', rbihna: 'ربحنا', rbe7t: 'ربحت', rbi7t: 'ربحت', rbe7: 'ربح',
  rib7: 'ربح', ribe7: 'ربح', ribh: 'ربح', rebe7: 'ربح', ar7a7: 'أرباح', arba7: 'أرباح', arbah: 'أرباح', ribe7na: 'ربحنا', rbe7ne: 'ربحنا',
  // today / yesterday / week / month / year
  lyom: 'اليوم', lyoum: 'اليوم', lyowm: 'اليوم', lyawm: 'اليوم', elyom: 'اليوم', elyoum: 'اليوم', alyom: 'اليوم', lyome: 'اليوم',
  ilyom: 'اليوم', halyom: 'اليوم', halnhar: 'اليوم',
  mbere7: 'امبارح', mbereh: 'امبارح', mberi7: 'امبارح', embere7: 'امبارح', imbere7: 'امبارح', mbari7: 'امبارح', mberha: 'امبارح',
  mbare7: 'امبارح',
  jem3a: 'الاسبوع', jim3a: 'الاسبوع', jem3e: 'الاسبوع', esbou3: 'الاسبوع', isbou3: 'الاسبوع', osbou3: 'الاسبوع', esbu3: 'الاسبوع',
  isbu3: 'الاسبوع',
  shaher: 'الشهر', shahr: 'الشهر', chahr: 'الشهر', chaher: 'الشهر',
  sene: 'السنة', seni: 'السنة',
  madye: 'الماضي', madi: 'الماضي', madeye: 'الماضي', lmadi: 'الماضي', lmadye: 'الماضي', '2abel': 'الماضي', '2abl': 'الماضي',
  // sales, stock, products
  mabi3at: 'مبيعات', mabee3at: 'مبيعات', mabi3: 'مبيع', bay3: 'المبيعات', bey3: 'المبيعات', bee3: 'المبيعات', bi3na: 'بعنا', be3na: 'بعنا', b3na: 'بعنا', bi3it: 'بعت', be3et: 'بعت',
  enba3: 'انباع', nba3: 'انباع', inba3: 'انباع', enba3o: 'انباعوا', nba3o: 'انباعوا', byenba3: 'انباع',
  ma5zan: 'المخزون', makhzan: 'المخزون', mkhzan: 'المخزون', m5zan: 'المخزون', ma5zoun: 'المخزون', makhzoun: 'المخزون',
  bda3a: 'البضاعة', bde3a: 'البضاعة', bada3a: 'البضاعة', bade3a: 'البضاعة',
  mantoujat: 'منتجات', montajat: 'منتجات', ghrad: 'منتجات', '8rad': 'منتجات',
  '5elis': 'خلصان', '5ales': 'خلصان', '5elset': 'خلصت', khelis: 'خلصان', '5ilis': 'خلصان', '5elsit': 'خلصت',
  '2alil': 'قليل', alil: 'قليل', '2alile': 'قليلة', alile: 'قليلة',
  akter: 'أكتر', aktar: 'أكتر', a7san: 'أحسن', a7sen: 'أحسن',
  // debts, cash
  masari: 'مصاري', mesari: 'مصاري', dyoun: 'ديون', dyun: 'ديون', deyn: 'دين', dayn: 'دين', '3aleh': 'عليه',
  sandou2: 'الصندوق', sandou: 'الصندوق', sandu2: 'الصندوق', sandouk: 'الصندوق', kesh: 'كاش',
  // question / follow-up words
  shu: 'شو', sho: 'شو', chou: 'شو', shou: 'شو', lesh: 'ليش', lech: 'ليش', leish: 'ليش',
  nezlet: 'نزلت', nizlet: 'نزلت', nezel: 'نزل', nizil: 'نزل', nezlo: 'نزلوا', '2alet': 'قلّت',
  tel3et: 'طلعت', tel3it: 'طلعت', tele3: 'طلع', zedet: 'زادت', zedit: 'زادت',
  farjine: 'فرجيني', farjini: 'فرجيني', farjeene: 'فرجيني', farjeeni: 'فرجيني', warjine: 'وريني', werjine: 'وريني',
  tafasil: 'التفاصيل', tafaseel: 'التفاصيل', tafesil: 'التفاصيل', tafseel: 'التفاصيل', tafsil: 'التفاصيل',
  '2aren': 'قارن', '2arin': 'قارن', qaren: 'قارن', '2arne': 'قارن', mo2arane: 'مقارنة', mu2arane: 'مقارنة',
  ma3: 'مع', meen: 'مين', yalli: 'يلي', yelli: 'يلي', ma3e: 'معي', ma3i: 'معي', '3am': 'عم',
  wa2fe: 'واقفة', wa2ef: 'واقف', to2af: 'توقف', ti2af: 'توقف', twa2af: 'توقف', jemde: 'جامدة',
  hayda: 'هيدا', hayde: 'هيدي', hal: 'هال', w: 'و', el: 'ال', l: 'ال',
  baddi: 'بدي', badde: 'بدي', masarif: 'مصاريف', masaref: 'مصاريف',
  // Milestone B: suppliers, ordering, expiry, running out
  mowared: 'مورد', mwared: 'مورد', mored: 'مورد', mowaredin: 'الموردين', mwardin: 'الموردين',
  mushtarayat: 'مشتريات', moshtarayat: 'مشتريات', shtarayna: 'اشترينا', eshtarayna: 'اشترينا',
  otlob: 'اطلب', etlob: 'اطلب', otlub: 'اطلب', lezim: 'لازم', lezem: 'لازم', lazem: 'لازم', lezm: 'لازم',
  sala7iye: 'صلاحية', salahiye: 'صلاحية', sala7ye: 'صلاحية', tentehe: 'تنتهي', tenteheh: 'تنتهي', '5asara': 'خسارة', khasara: 'خسارة',
  ye5las: 'يخلص', yekhlas: 'يخلص', ra7: 'رح', byekfe: 'بيكفي', bikaffe: 'بيكفي', byikfi: 'بيكفي',
  wa2fin: 'واقفة',
};

/** Multi-word Arabizi phrases, applied before single words. */
const ARABIZI_PHRASES: Array<[RegExp, string]> = [
  [/\b(?:(?:hal|el|l)\s*)?(?:jem3a|jim3a|esbou3|isbou3)\s+(?:(?:el|l)\s*)?(?:madye|madi|li\s*fetet|lfetet|2abel)\b/gi, 'الاسبوع الماضي'],
  [/\b(?:(?:el|l)\s*)?(?:shaher|shahr)\s+(?:(?:el|l)\s*)?(?:madye|madi|li\s*fet|lfet|2abel)\b/gi, 'الشهر الماضي'],
  [/\bhal\s*(?:jem3a|esbou3|isbou3)\b/gi, 'هالاسبوع'],
  [/\bhal\s*(?:shaher|shahr)\b/gi, 'هالشهر'],
  [/\bhal\s*sene\b/gi, 'هالسنة'],
  [/\b(?:el|al|il)\s*(?:yom|yoom|youm)\b/gi, 'اليوم'],
];

/** Arabic spelling variants (Lebanese forms, common typos) → the form the intent rules use. */
const ARABIC_VARIANTS: Array<[RegExp, string]> = [
  [/(?<!\p{L})(?:أديش|اديش|كديش|قديه|شقد)(?!\p{L})/gu, 'قديش'],
  [/(?<!\p{L})(?:البارح|إمبارح)(?!\p{L})/gu, 'امبارح'],
  [/(?<!\p{L})(?:الجمعة الماضية|الجمعة اللي فاتت|الجمعة يلي فاتت|الأسبوع يلي فات|الاسبوع يلي فات|الأسبوع اللي فات|الاسبوع اللي فات)(?!\p{L})/gu, 'الاسبوع الماضي'],
  [/(?<!\p{L})(?:هالجمعة|هالجمعه)(?!\p{L})/gu, 'هالاسبوع'],
  [/(?<!\p{L})(?:الشهر يلي فات|الشهر اللي فات)(?!\p{L})/gu, 'الشهر الماضي'],
  [/(?<!\p{L})(?:ربحنه|ربحنى)(?!\p{L})/gu, 'ربحنا'],
];

/** English words the routing rules care about. Only these are spell-corrected. */
const ENGLISH_VOCAB = [
  'profit', 'profits', 'sales', 'sale', 'revenue', 'today', 'yesterday', 'week', 'month', 'year', 'stock', 'inventory',
  'compare', 'comparison', 'versus', 'best', 'selling', 'seller', 'sellers', 'products', 'product', 'expenses', 'returns',
  'customers', 'debts', 'drawer', 'cashbox', 'expiry', 'expired', 'expiring', 'average', 'order', 'orders', 'details',
  'detail', 'how', 'much', 'many', 'what', 'which', 'show', 'last', 'this', 'why', 'dropped', 'decreased', 'increased',
  'lower', 'higher', 'margin', 'gross', 'net', 'units', 'top', 'worst', 'slow', 'moving', 'owes', 'low', 'out',
];
const ENGLISH_SET = new Set(ENGLISH_VOCAB);

export function stripArabicMarks(text: string): string {
  return text.replace(ARABIC_MARKS, '');
}

/** "addeeeeh" → "addeh", "rbe77na" → "rbe7na": folds stretched letters (3+) and repeated digit-letters. */
export function foldRepeats(word: string): string {
  return word.replace(/([a-z])\1{2,}/g, '$1').replace(/([2-9])\1+/g, '$1');
}

function damerau(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[] = new Array<number>(rows * cols).fill(0);
  const at = (i: number, j: number) => d[i * cols + j]!;
  for (let i = 0; i < rows; i += 1) d[i * cols] = i;
  for (let j = 0; j < cols; j += 1) d[j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, at(i - 2, j - 2) + 1);
      d[i * cols + j] = v;
    }
  }
  return at(a.length, b.length);
}

/** Closest routing word for an English typo, or null. Short, numeric, and ambiguous words are left alone. */
export function correctEnglishWord(word: string): string | null {
  const w = word.toLowerCase();
  if (w.length < 4 || ENGLISH_SET.has(w) || /\d/.test(w)) return null;
  const limit = w.length >= 7 ? 2 : 1;
  let best: string | null = null;
  let bestDistance = limit + 1;
  let tie = false;
  for (const candidate of ENGLISH_VOCAB) {
    if (Math.abs(candidate.length - w.length) > limit) continue;
    const distance = damerau(w, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
      tie = false;
    } else if (distance === bestDistance) {
      tie = true;
    }
  }
  return bestDistance <= limit && !tie ? best : null;
}

export interface LanguageRead {
  input: InputLanguage;
  /** Language to answer in. Arabizi is answered in Arabic script. */
  reply: AiLang;
  /** Text used only for routing. Never shown, never used for names or numbers. */
  routingText: string;
  arabiziHits: number;
  corrections: Array<{ from: string; to: string }>;
}

export function readLanguage(original: string, uiLang: AiLang): LanguageRead {
  const text = stripArabicMarks(original.normalize('NFC')).replace(/\s+/g, ' ').trim();
  const corrections: Array<{ from: string; to: string }> = [];
  let routing = text;
  for (const [pattern, replacement] of ARABIC_VARIANTS) routing = routing.replace(pattern, replacement);

  const digitLetters = /[a-z][2-9]|[2-9][a-z]/i.test(text);
  let hits = 0;
  for (const [pattern, replacement] of ARABIZI_PHRASES) {
    routing = routing.replace(pattern, (match) => {
      hits += 1;
      corrections.push({ from: match, to: replacement });
      return ` ${replacement} `;
    });
  }
  let englishWords = 0;
  // Very short words ("w", "el", "shu") only translate when the sentence is clearly Arabizi somewhere.
  const longArabizi = (routing.match(/[A-Za-z0-9']+/g) ?? []).some((t) => {
    const w = foldRepeats(t.toLowerCase());
    return w.length > 3 && /[a-z]/.test(w) && ARABIZI[w] !== undefined;
  });
  routing = routing.replace(/[A-Za-z0-9']+/g, (token) => {
    const lower = foldRepeats(token.toLowerCase());
    if (!/[a-z]/.test(lower)) return token;
    const arabizi = ARABIZI[lower];
    if (arabizi && (lower.length > 3 || hits > 0 || digitLetters || longArabizi)) {
      hits += 1;
      corrections.push({ from: token, to: arabizi });
      return arabizi;
    }
    if (ENGLISH_SET.has(lower)) {
      englishWords += 1;
      return token;
    }
    const fixed = correctEnglishWord(lower);
    if (fixed) {
      englishWords += 1;
      corrections.push({ from: token, to: fixed });
      return fixed;
    }
    return token;
  });
  routing = routing.replace(/\s+/g, ' ').trim();

  const arabicLetters = (text.match(/[؀-ۿ]/g) ?? []).length;
  const latinLetters = (text.match(/[A-Za-z]/g) ?? []).length;
  let input: InputLanguage;
  if (arabicLetters > 0 && latinLetters === 0) input = 'ar';
  else if (latinLetters > 0 && arabicLetters === 0) input = hits > 0 && hits >= englishWords ? 'arabizi' : 'en';
  else if (arabicLetters === 0 && latinLetters === 0) input = uiLang === 'ar' ? 'ar' : 'en';
  else input = 'mixed';
  let reply: AiLang;
  if (input === 'ar' || input === 'arabizi') reply = 'ar';
  else if (input === 'en') reply = 'en';
  else reply = arabicLetters >= latinLetters ? 'ar' : 'en';
  return { input, reply, routingText: routing, arabiziHits: hits, corrections };
}
