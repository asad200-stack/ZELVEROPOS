/**
 * Query plans for the catalogs. These are the shapes catalogQuery.ts sends.
 * There is no offset. A cursor is startAfter the last document of the previous page.
 * Firestore allows one range, so a name prefix replaces a stock range for that request.
 *
 * There is no SKU column. The indexed code is `barcode`.
 */

import { nameNormalized, prefixEnd } from './searchKey';

export const CATALOG_PAGE_SIZE = 50;

export type ProductListMode = 'browse' | 'archived' | 'out' | 'low' | 'recent' | 'expiry';

export interface ProductQuery {
  mode: ProductListMode;
  category: string;
  search: string;
  lowStockAt: number;
  expiryFrom?: string;
  expiryTo?: string;
}

export function emptyProductQuery(patch: Partial<ProductQuery> = {}): ProductQuery {
  return { mode: 'browse', category: '', search: '', lowStockAt: 10, ...patch };
}

export type Planned =
  | { op: 'where'; field: string; cmp: '==' | '>=' | '<=' | '>' | 'in'; value: unknown }
  | { op: 'orderBy'; field: string; dir: 'asc' | 'desc' }
  | { op: 'startAfter' }
  | { op: 'limit'; n: number };

export function planProducts(spec: ProductQuery, hasCursor: boolean): Planned[] {
  const prefix = nameNormalized(spec.search);
  const plan: Planned[] = [];
  if (spec.mode === 'archived') plan.push({ op: 'where', field: 'status', cmp: '==', value: 'archived' });
  else if (spec.mode !== 'expiry') plan.push({ op: 'where', field: 'status', cmp: '==', value: 'active' });
  if (spec.category && spec.mode !== 'expiry') plan.push({ op: 'where', field: 'category', cmp: '==', value: spec.category });

  if (prefix && spec.mode !== 'expiry') {
    plan.push(
      { op: 'where', field: 'nameNormalized', cmp: '>=', value: prefix },
      { op: 'where', field: 'nameNormalized', cmp: '<=', value: prefixEnd(prefix) },
      { op: 'orderBy', field: 'nameNormalized', dir: 'asc' },
    );
  } else if (spec.mode === 'out') {
    plan.push({ op: 'where', field: 'stock', cmp: '==', value: 0 }, { op: 'orderBy', field: 'nameNormalized', dir: 'asc' });
  } else if (spec.mode === 'low') {
    plan.push(
      { op: 'where', field: 'stock', cmp: '>', value: 0 },
      { op: 'where', field: 'stock', cmp: '<=', value: Math.max(0, spec.lowStockAt) },
      { op: 'orderBy', field: 'stock', dir: 'asc' },
    );
  } else if (spec.mode === 'recent') {
    plan.push({ op: 'orderBy', field: 'updatedAt', dir: 'desc' });
  } else if (spec.mode === 'expiry') {
    plan.push({ op: 'where', field: 'expiryDate', cmp: '>=', value: spec.expiryFrom ?? '0000-01-01' });
    if (spec.expiryTo) plan.push({ op: 'where', field: 'expiryDate', cmp: '<=', value: spec.expiryTo });
    plan.push({ op: 'orderBy', field: 'expiryDate', dir: 'asc' });
  } else {
    plan.push({ op: 'orderBy', field: 'nameNormalized', dir: 'asc' });
  }
  plan.push({ op: 'orderBy', field: '__name__', dir: spec.mode === 'recent' ? 'desc' : 'asc' });
  if (hasCursor) plan.push({ op: 'startAfter' });
  plan.push({ op: 'limit', n: CATALOG_PAGE_SIZE });
  return plan;
}

/** Exact barcode. There is no SKU field; this is the code lookup. */
export function planBarcode(code: string, activeOnly: boolean): Planned[] {
  const plan: Planned[] = [{ op: 'where', field: 'barcode', cmp: '==', value: code.trim() }];
  if (activeOnly) plan.push({ op: 'where', field: 'status', cmp: '==', value: 'active' });
  plan.push({ op: 'limit', n: 1 });
  return plan;
}

/** True when the search box should try an exact barcode before the name prefix. */
export function looksLikeCode(search: string): boolean {
  const code = search.trim();
  return code.length >= 4 && !nameNormalized(code).includes(' ') && !/[^\w-]/.test(code);
}

export interface PartyQuery {
  search: string;
  debtOnly?: boolean;
  recent?: boolean;
}

export function planParty(collectionName: 'customers' | 'suppliers', spec: PartyQuery, hasCursor: boolean): Planned[] | { exact: 'email' | 'phone'; value: string } {
  const raw = spec.search.trim();
  if (raw.includes('@')) return { exact: 'email', value: raw.trim().toLowerCase().slice(0, 200) };
  const digits = raw.replace(/\D/g, '');
  if (digits && digits === raw.replace(/\s+/g, '') && !/[a-z\u0600-\u06ff]/i.test(raw)) return { exact: 'phone', value: digits.slice(0, 40) };
  const prefix = nameNormalized(raw);
  const plan: Planned[] = [];
  const descending = !prefix && (spec.recent || (spec.debtOnly && collectionName === 'customers'));
  if (prefix) {
    plan.push(
      { op: 'where', field: 'nameNormalized', cmp: '>=', value: prefix },
      { op: 'where', field: 'nameNormalized', cmp: '<=', value: prefixEnd(prefix) },
      { op: 'orderBy', field: 'nameNormalized', dir: 'asc' },
    );
  } else if (spec.debtOnly && collectionName === 'customers') {
    plan.push({ op: 'where', field: 'debtUsdCents', cmp: '>', value: 0 }, { op: 'orderBy', field: 'debtUsdCents', dir: 'desc' });
  } else if (spec.recent) {
    plan.push({ op: 'orderBy', field: 'createdAtMs', dir: 'desc' });
  } else {
    plan.push({ op: 'orderBy', field: 'nameNormalized', dir: 'asc' });
  }
  plan.push({ op: 'orderBy', field: '__name__', dir: descending ? 'desc' : 'asc' });
  if (hasCursor) plan.push({ op: 'startAfter' });
  plan.push({ op: 'limit', n: CATALOG_PAGE_SIZE });
  return plan;
}
