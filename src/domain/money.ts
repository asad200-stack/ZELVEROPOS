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

/** Parses a user-typed decimal ("1,234.50", "12") into cents; null if invalid or negative. */
export function parseUsdInput(raw: string | number): Cents | null {
  const s = String(raw ?? '').replace(/[,\s$]/g, '').trim();
  if (!s) return null;
  if (!/^\d*\.?\d*$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return toCents(n);
}

/** Parses a user-typed LBP amount (integer, separators allowed); null if invalid or negative. */
export function parseLbpInput(raw: string | number): number | null {
  const s = String(raw ?? '').replace(/[,\s]/g, '').replace(/(l\.?l\.?|lbp|ل\.ل\.?)$/i, '').trim();
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
