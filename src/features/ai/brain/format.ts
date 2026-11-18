/**
 * Display helpers for Zelvero AI answers. Formatting only: every amount passed in was already
 * calculated from the store's own records. Nothing here rounds a business figure differently.
 */
import type { AiLang } from '../engine';

const LRI = '⁦';
const PDI = '⁩';

/** "$1,245.50". Arabic answers keep the amount as one left-to-right run. */
export function money(cents: number, lang: AiLang): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  const text = `${sign}$${whole}.${String(abs % 100).padStart(2, '0')}`;
  return lang === 'ar' ? `${LRI}${text}${PDI}` : text;
}

export function lbp(amount: number, lang: AiLang): string {
  const text = `${Math.round(amount).toLocaleString('en-US')} LBP`;
  return lang === 'ar' ? `${LRI}${text}${PDI}` : text;
}

export function count(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** One decimal, without a trailing ".0". */
export function rate(n: number): string {
  const fixed = n.toFixed(1);
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
}

/** Signed whole percent change, or null when there is no base to compare with. */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export const L = (lang: AiLang, en: string, ar: string): string => (lang === 'ar' ? ar : en);

export function joinList(items: string[], lang: AiLang): string {
  if (items.length <= 1) return items.join('');
  const sep = lang === 'ar' ? '، ' : ', ';
  const last = lang === 'ar' ? ' و' : ' and ';
  return `${items.slice(0, -1).join(sep)}${last}${items[items.length - 1]}`;
}

/** Product names are user data: shown as written, quoted so they never read as instructions. */
export function name(text: string): string {
  // First-strong isolate keeps a Latin name ("Lays Chips") in one piece inside an Arabic sentence.
  return `«\u2068${text.replace(/[«»\n\r\u2066-\u2069]/g, ' ').trim()}\u2069»`;
}

const DAYS_AR = ['الأحد', 'الاتنين', 'التلاتا', 'الأربعا', 'الخميس', 'الجمعة', 'السبت'];
const MONTHS_AR = ['كانون التاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين التاني', 'كانون الأول'];
const DAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "Wednesday 18 November" / "الأربعا 18 تشرين التاني". */
export function longDate(d: Date, lang: AiLang): string {
  return lang === 'ar'
    ? `${DAYS_AR[d.getDay()]} ${d.getDate()} ${MONTHS_AR[d.getMonth()]}`
    : `${DAYS_EN[d.getDay()]} ${d.getDate()} ${MONTHS_EN[d.getMonth()]}`;
}

/** Friendly name of a period label coming from the existing period helpers. */
export function periodWords(label: string, lang: AiLang): string {
  const words: Record<string, [string, string]> = {
    today: ['today', 'اليوم'],
    yesterday: ['yesterday', 'مبارح'],
    week: ['in the last 7 days', 'آخر 7 أيام'],
    lastWeek: ['last week', 'الجمعة الماضية'],
    month: ['this month', 'هالشهر'],
    lastMonth: ['last month', 'الشهر الماضي'],
    year: ['this year', 'هالسنة'],
  };
  const pair = words[label];
  if (pair) return lang === 'ar' ? pair[1] : pair[0];
  return lang === 'ar' ? 'بهالفترة' : 'in this period';
}

/** periodWords, or the exact dates for a custom range. */
export function periodPhrase(period: { from: string; to: string; label: string }, lang: AiLang): string {
  const known = ['today', 'yesterday', 'week', 'lastWeek', 'month', 'lastMonth', 'year'];
  if (known.includes(period.label)) return periodWords(period.label, lang);
  if (period.from === period.to) return lang === 'ar' ? `بـ ${LRI}${period.from}${PDI}` : `on ${period.from}`;
  return lang === 'ar' ? `من ${LRI}${period.from}${PDI} لـ ${LRI}${period.to}${PDI}` : `from ${period.from} to ${period.to}`;
}

/** Arabic counted noun: 1 فاتورة، 2 فاتورتين، 3–10 فواتير، 11+ فاتورة. */
export function counted(n: number, lang: AiLang, en: [string, string], ar: [string, string, string, string]): string {
  if (lang === 'en') return `${count(n)} ${n === 1 ? en[0] : en[1]}`;
  if (n === 1) return `${ar[0]} واحد`.replace(/ة واحد$/, 'ة وحدة');
  if (n === 2) return ar[1];
  if (n >= 3 && n <= 10) return `${count(n)} ${ar[2]}`;
  return `${count(n)} ${ar[3]}`;
}

export const invoicesOf = (n: number, lang: AiLang) => counted(n, lang, ['invoice', 'invoices'], ['فاتورة', 'فاتورتين', 'فواتير', 'فاتورة']);
export const customersOf = (n: number, lang: AiLang) => counted(n, lang, ['customer', 'customers'], ['زبون', 'زبونين', 'زباين', 'زبون']);
export const productsOf = (n: number, lang: AiLang) => counted(n, lang, ['product', 'products'], ['منتج', 'منتجين', 'منتجات', 'منتج']);
export const unitsOf = (n: number, lang: AiLang) => counted(n, lang, ['unit', 'units'], ['قطعة', 'قطعتين', 'قطع', 'قطعة']);
export const daysOf = (n: number, lang: AiLang) => counted(n, lang, ['day', 'days'], ['يوم', 'يومين', 'أيام', 'يوم']);

/** How to name the period a figure is compared with ("than yesterday", "than the week before"). */
export function previousWords(label: string, lang: AiLang): string {
  const words: Record<string, [string, string]> = {
    today: ['yesterday', 'مبارح'],
    yesterday: ['the day before', 'اليوم يلي قبله'],
    week: ['the 7 days before', 'الجمعة يلي قبلها'],
    lastWeek: ['the week before', 'الجمعة يلي قبلها'],
    month: ['the same days last month', 'نفس الأيام من الشهر الماضي'],
    lastMonth: ['the month before', 'الشهر يلي قبله'],
    year: ['the period before', 'الفترة يلي قبلها'],
  };
  const pair = words[label];
  if (pair) return lang === 'ar' ? pair[1] : pair[0];
  return lang === 'ar' ? 'الفترة يلي قبلها' : 'the period before';
}
