/**
 * Stored search keys. Firestore can do equality and a single prefix range.
 * It cannot scan a catalog in the browser. A future search provider can read these
 * same keys without a POS rewrite.
 *
 * `nameNormalized` is lowercase, trimmed, with repeated spaces collapsed, and with
 * Arabic letter forms folded so a prefix query matches what a cashier types.
 * Existing documents do not have this field until the backfill in
 * scripts/verify/backfill-search-keys.mjs is run. That script refuses any project
 * other than the local demo emulator.
 */

export function nameNormalized(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 200);
}

export function phoneKey(value: string): string {
  return value.replace(/\D/g, '').slice(0, 40);
}

export function emailKey(value: string): string {
  return value.trim().toLowerCase().slice(0, 200);
}

/** Upper bound of a Firestore string prefix range. */
export function prefixEnd(prefix: string): string {
  return `${prefix}\uf8ff`;
}
