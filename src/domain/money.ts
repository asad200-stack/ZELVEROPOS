/**
 * Integer money helpers. USD amounts are cents, LBP amounts are whole pounds.
 * Never do arithmetic on floating dollars; convert at the edges (input parsing / display).
 */
export type Cents = number;

export function toCents(usd: number): Cents {
  const n = Number(usd);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Number((n * 100).toFixed(4)));
}

export function centsToUsd(cents: Cents): number {
  return Math.round(Number(cents) || 0) / 100;
}

export function roundLbp(lbp: number): number {
  const n = Number(lbp);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

export function isValidExchangeRate(rate: number): boolean {
  return Number.isInteger(rate) && rate > 0 && rate <= 1_000_000_000_000;
}

export function usdCentsToLbp(cents: Cents, rate: number): number {
  if (!isValidExchangeRate(rate)) return 0;
  return Math.round(((Number(cents) || 0) * rate) / 100);
}

/** Grouped LBP string for an input, or '' when USD is empty. Null if the rate or USD cannot be converted. */
export function suggestedLbpInput(usdRaw: string, rate: number): string | null {
  if (!isValidExchangeRate(rate)) return null;
  if (!String(usdRaw ?? '').trim()) return '';
  const cents = parseUsdInput(usdRaw);
  if (cents === null) return null;
  return usdCentsToLbp(cents, rate).toLocaleString('en-US');
}

export function lbpToUsdCents(lbp: number, rate: number): Cents {
  if (!(rate > 0)) return 0;
  return Math.round(((Number(lbp) || 0) * 100) / rate);
}

/** Tolerance (in LBP) equivalent to one USD cent, used when comparing converted amounts. */
export function lbpCentTolerance(rate: number): number {
  return Math.max(1, Math.ceil(rate / 100));
}

const GROUPING = /[\s,\u00A0\u202F\u066C\u2019'`_]/g;

function stripMoneyMarks(raw: string | number): string {
  return String(raw ?? '')
    .replace(/[$\u2066\u2067\u2068\u2069]/g, '')
    .replace(GROUPING, '')
    .replace(/ل\.?ل\.?|lbp/gi, '')
    .trim();
}

/**
 * Display dollars → cents, exactly once.
 * "2400" / "2,400" / "2,400.00" → 240000. Never treats a formatted string as cents.
 */
export function parseUsdInput(raw: string | number): Cents | null {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0) return null;
    return toCents(raw);
  }
  const s = stripMoneyMarks(raw);
  if (!s) return null;
  if (!/^\d*\.?\d*$/.test(s)) return null;
  const dot = s.indexOf('.');
  const wholeRaw = dot < 0 ? s : s.slice(0, dot);
  const fracRaw = dot < 0 ? '' : s.slice(dot + 1);
  if (fracRaw.length > 2) {
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return null;
    return toCents(n);
  }
  if (wholeRaw.startsWith('-') || fracRaw.startsWith('-')) return null;
  const dollars = wholeRaw === '' ? 0 : Number(wholeRaw);
  if (!Number.isFinite(dollars) || dollars < 0 || !Number.isInteger(dollars)) return null;
  const fracCents = Number((fracRaw + '00').slice(0, 2));
  return dollars * 100 + fracCents;
}

/** Parses a user-typed LBP amount (integer pounds, separators allowed); null if invalid or negative. */
export function parseLbpInput(raw: string | number): number | null {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0) return null;
    return Math.round(raw);
  }
  const s = stripMoneyMarks(raw).replace(/(l\.?l\.?|lbp|ل\.ل\.?)$/i, '').trim();
  if (!s) return null;
  if (!/^\d*\.?\d*$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

export function sum(values: number[]): number {
  let total = 0;
  for (const v of values) total += Number(v) || 0;
  return total;
}

/** Cents → plain decimal string for inputs ("12.5" → "12.50"). */
export function centsToInput(cents: Cents | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toFixed(2);
}

export type MoneyKind = 'usd' | 'lbp';

function groupInt(digits: string): string {
  const trimmed = digits.replace(/^0+(?=\d)/, '');
  if (!trimmed) return '';
  return trimmed.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function digitCount(value: string): number {
  return (value.match(/\d/g) ?? []).length;
}

function caretFromDigits(formatted: string, digits: number): number {
  if (digits <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i += 1) {
    const ch = formatted.charCodeAt(i);
    if (ch >= 48 && ch <= 57) {
      seen += 1;
      if (seen >= digits) return i + 1;
    }
  }
  return formatted.length;
}

/** Grouped USD while typing. Keeps a trailing "." and up to two decimal digits. */
export function formatUsdTyped(raw: string): string {
  const cleaned = String(raw ?? '').replace(/[^\d.]/g, '');
  if (!cleaned) return '';
  const dot = cleaned.indexOf('.');
  const intRaw = (dot < 0 ? cleaned : cleaned.slice(0, dot)).replace(/\D/g, '');
  const fracRaw = dot < 0 ? '' : cleaned.slice(dot + 1).replace(/\D/g, '').slice(0, 2);
  const trailingDot = dot >= 0 && fracRaw === '';
  const grouped = groupInt(intRaw) || (fracRaw || trailingDot ? '0' : '');
  if (!grouped) return '';
  if (trailingDot) return `${grouped}.`;
  if (fracRaw) return `${grouped}.${fracRaw}`;
  return grouped;
}

/** USD display for a settled field: 2000 → 2,000.00 */
export function formatUsdComplete(raw: string): string {
  if (!String(raw ?? '').trim()) return '';
  const cents = parseUsdInput(raw);
  if (cents === null) return formatUsdTyped(raw);
  return formatUsdCentsInput(cents);
}

export function formatUsdCentsInput(cents: Cents): string {
  return (Math.max(0, Math.round(cents)) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Grouped LBP pounds while typing. */
export function formatLbpTyped(raw: string): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return '';
  return groupInt(digits);
}

export function formatLbpComplete(raw: string): string {
  if (!String(raw ?? '').trim()) return '';
  const n = parseLbpInput(raw);
  if (n === null) return formatLbpTyped(raw);
  return formatLbpAmountInput(n);
}

export function formatLbpAmountInput(lbp: number): string {
  return Math.max(0, Math.round(lbp)).toLocaleString('en-US');
}

export function completeMoneyInput(kind: MoneyKind, raw: string): string {
  return kind === 'usd' ? formatUsdComplete(raw) : formatLbpComplete(raw);
}

/** Formats a typed money string and maps the caret so commas do not jump the cursor. */
export function applyTypedMoney(kind: MoneyKind, raw: string, caret: number): { value: string; caret: number } {
  const value = kind === 'usd' ? formatUsdTyped(raw) : formatLbpTyped(raw);
  const cleaned = kind === 'usd' ? String(raw ?? '').replace(/[^\d.]/g, '') : String(raw ?? '').replace(/\D/g, '');
  const keepDot = kind === 'usd' && cleaned.endsWith('.') && cleaned.indexOf('.') === cleaned.length - 1;
  const digits = digitCount(String(raw ?? '').slice(0, Math.max(0, caret)));
  let next = caretFromDigits(value, digits);
  if (keepDot && value.endsWith('.')) next = value.length;
  return { value, caret: next };
}
