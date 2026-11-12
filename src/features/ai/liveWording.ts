/**
 * The store note is the answer. Model wording is shown only when it
 * keeps the same amounts, empty status, and incomplete-result warning.
 */

const AMOUNT = /\$\d[\d,]*\.\d{2}\s*USD|\d[\d,]*\s*LBP/gi;

const EMPTY_STATUS = /no sales are recorded|nothing (?:is|was) recorded|لا توجد مبيعات مسجّلة|ما في مبيعات مسجّلة/i;
const EMPTY_UNITS = /no net units were sold|لا توجد وحدات صافية/i;
const NO_RANK = /no ranking is shown|لا يُعرض ترتيب/i;
const INCOMPLETE_STATUS = /incomplete|first page|not the full|ناقصة|الصفحة الأولى|غير مكتمل|ليس العدد الكامل/i;
const RANKING_WORD = /net units|وحدات صافية|no ranking is shown|لا يُعرض ترتيب/;
const STOCK_WORD = /on hand|الكمية الحالية/;
const EXTRA_WORD = new Set('product ranking invoice invoices returns return stored names name local business date range every sale sales counted listed order winner equal amounts units unit net sold selling best today yesterday week month from this that with were was the and for not shown zero period compared higher lower same between store signed only most also recorded line lines queued offline included subtracted stay stays still currently left void cancelled canceled status finish list did does these those your about there current quantity available requested exactly named unique chosen threshold setting default above through active archived specific minimum applied question asked whole result hand count full'.split(' '));
const EXTRA_ARABIC = new Set(['منتج', 'منتجات', 'وحدات', 'صافية', 'مباعة', 'فترة', 'ترتيب', 'ترتيباً', 'صفرياً', 'فواتير', 'مرتجع', 'مرتجعات', 'تاريخ', 'اسم', 'أسماء', 'تعادل', 'فائز', 'متجر', 'جلسة', 'نطاق', 'اليوم', 'أمس', 'أسبوع', 'شهر', 'صافي', 'وحدة', 'مباع', 'مسجلة', 'محفوظة', 'سطور', 'البيع', 'فاتورة', 'مؤجلة', 'قائمة', 'تكتمل', 'مجموعة', 'الليرة', 'الدولار']);

function compact(text: string): string {
  return text.replace(/,/g, '').replace(/\s+/g, ' ').toLowerCase();
}

function amounts(text: string): string[] {
  return [...text.matchAll(AMOUNT)].map((match) => compact(match[0]));
}

function hasExactNumber(text: string, value: string): boolean {
  return new RegExp(`(?:^|\\D)${value}(?:\\D|$)`).test(text);
}

interface FigureRow {
  keys: string[];
  onHand: number | null;
  netUnits: number | null;
}

function figureRows(canonical: string): FigureRow[] {
  const rows: FigureRow[] = [];
  for (const line of canonical.split('\n')) {
    const joined = line.match(/«([^»]+)»\s+([A-Za-z0-9_-]+):\s*(\d+)\s+on hand,\s*(\d+)\s+net units/)
      ?? line.match(/«([^»]+)»\s+([A-Za-z0-9_-]+):\s*(\d+)\s+كمية حالية،\s*(\d+)\s+وحدات صافية/);
    if (joined) {
      rows.push({ keys: [joined[1], joined[2]], onHand: Number(joined[3]), netUnits: Number(joined[4]) });
      continue;
    }
    const held = line.match(/«([^»]+)»\s+([A-Za-z0-9_-]+):\s*(\d+)\s+on hand/) ?? line.match(/«([^»]+)»:\s*(\d+)\s+on hand/);
    if (held) {
      rows.push({ keys: held[2] && held[3] ? [held[1], held[2]] : [held[1]], onHand: Number(held[3] ?? held[2]), netUnits: null });
      continue;
    }
    const ranked = line.match(/«([^»]+)»:\s*(\d+)\s+net units/) ?? line.match(/«([^»]+)»:\s*(\d+)\s+وحدات صافية/);
    if (ranked) rows.push({ keys: [ranked[1]], onHand: null, netUnits: Number(ranked[2]) });
  }
  return rows;
}

function rowsBeside(before: string, rows: FigureRow[]): FigureRow[] {
  const lower = before.toLowerCase();
  let bestAt = -1;
  const hits: FigureRow[] = [];
  for (const row of rows) {
    for (const key of row.keys) {
      const at = lower.lastIndexOf(key.toLowerCase());
      if (at < 0 || before.length - (at + key.length) > 40) continue;
      if (at > bestAt) {
        bestAt = at;
        hits.length = 0;
        hits.push(row);
      } else if (at === bestAt && !hits.includes(row)) hits.push(row);
    }
  }
  return hits;
}

/** A number placed next to a product must be that product's own on-hand stock or net units. */
function figuresContradictRows(canonical: string, wording: string): boolean {
  const rows = figureRows(canonical);
  if (rows.length === 0) return false;
  for (const match of wording.matchAll(/(\d+)\s+(on hand|net units|كمية حالية|وحدات صافية)/gi)) {
    const value = Number(match[1]);
    const kind = /on hand|كمية حالية/i.test(match[2] ?? '') ? 'onHand' : 'netUnits';
    const beside = rowsBeside(wording.slice(Math.max(0, (match.index ?? 0) - 80), match.index ?? 0), rows);
    if (beside.length === 0) continue;
    if (!beside.some((row) => row[kind] === value)) return true;
  }
  return false;
}

function noteListsResults(canonical: string): boolean {
  if (/^\d+\. «/m.test(canonical)) return true;
  const count = canonical.match(/Full count:\s*(\d+)/) ?? canonical.match(/العدد الكامل:\s*(\d+)/);
  return Boolean(count && Number(count[1]) > 0);
}

function rankingWordsStayInside(canonical: string, wording: string): boolean {
  const note = canonical.toLowerCase();
  const latin = [...wording.toLowerCase().matchAll(/[a-z]{4,}/g)].map((match) => match[0]);
  if (latin.some((word) => !EXTRA_WORD.has(word) && !note.includes(word))) return false;
  const arabic = [...wording.matchAll(/[\u0600-\u06FF]{3,}/g)].map((match) => match[0]);
  if (arabic.some((word) => !EXTRA_ARABIC.has(word) && !canonical.includes(word))) return false;
  const numbers = [...wording.matchAll(/\d+/g)].map((match) => match[0]);
  return numbers.every((value) => hasExactNumber(canonical, value));
}

/** True when the wording may be shown beside the store note. It never replaces that note. */
export function acceptLiveWording(canonical: string, wording: string): boolean {
  const said = wording.trim();
  if (said === '') return false;
  const note = compact(canonical);
  if (EMPTY_STATUS.test(canonical) && !EMPTY_STATUS.test(said)) return false;
  if (EMPTY_UNITS.test(canonical) && !EMPTY_UNITS.test(said)) return false;
  if (NO_RANK.test(canonical) && !NO_RANK.test(said)) return false;
  if (INCOMPLETE_STATUS.test(canonical) && !INCOMPLETE_STATUS.test(said)) return false;
  if (/equal net units are a tie|equal net amounts are a tie|تساوي الوحدات يعني تعادل|تساوي المبلغ يعني تعادل/i.test(canonical) && /sold the most|الأكثر مبيع/i.test(said)) return false;
  const leader = canonical.match(/1\. «([^»]+)»([^\n]*)/);
  const leaderTied = Boolean(leader?.[2] && /tie|تعادل/.test(leader[2]));
  if (leader && !leaderTied && /sold the most|الأكثر مبيع/i.test(said) && !said.includes(leader[1])) return false;
  if ((RANKING_WORD.test(canonical) || STOCK_WORD.test(canonical)) && !rankingWordsStayInside(canonical, said)) return false;
  if (STOCK_WORD.test(canonical) && !RANKING_WORD.test(canonical) && /\bsold\b|انباع|مبيع/i.test(said)) return false;
  if (/no purchase quantity or days of stock is calculated|لا تُحسب كمية شراء/i.test(canonical) && /reorder|days of stock remaining|purchase \d+/i.test(said)) return false;
  if (noteListsResults(canonical) && /no products (?:are|were|had)|nothing (?:was|is) (?:sold|recorded)|there are no products|لا توجد منتجات|ما في منتجات/i.test(said)) return false;
  if (figuresContradictRows(canonical, said)) return false;
  if ([...said.matchAll(/\d{4}-\d{2}-\d{2}/g)].some((match) => !canonical.includes(match[0]))) return false;
  if (/\bEUR\b|€|\bGBP\b|£/.test(said)) return false;
  if (/availability is not answered|لا تُحسم التوفّر/.test(canonical) && /available:\s*yes|متوفرة:\s*نعم/i.test(said)) return false;
  if (/no product is named|لا يُذكر اسم منتج/.test(canonical)) {
    if (!/no product is named|لا يُذكر اسم منتج/.test(said)) return false;
    if (/sold the most|top seller|الأكثر مبيع/.test(said)) return false;
  }
  if (/was not read|could not be read|لم تُقرأ|تعذّرت قراءة/.test(canonical) && !/was not read|could not be read|لم تُقرأ|تعذّرت قراءة/.test(said)) return false;
  if ((/profit is omitted|الربح غير معروض/i.test(canonical)) && /gross profit|الربح الإجمالي/i.test(said)) return false;
  if ((/were not added together|لم تُجمعا/i.test(canonical)) && /combined total|المجموع الكلي/i.test(said)) return false;
  return amounts(said).every((amount) => note.includes(amount));
}

export function composeLiveAnswer(canonical: string, wording: string | null): { text: string; wording: string | null } {
  if (!wording || !acceptLiveWording(canonical, wording)) return { text: canonical, wording: null };
  return { text: canonical, wording };
}
