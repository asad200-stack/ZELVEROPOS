/**
 * Query plans for sales history. The screen sends these shapes.
 * There is no offset and no listener on the sales collection.
 * A cursor is startAfter(localDate, createdAtMs, document id).
 */

import { PAGE_SIZE } from '@/constants/app';
import type { Planned } from './catalogPlan';

export const SALES_PAGE_SIZE = PAGE_SIZE;
export const RETURNS_PAGE_SIZE = 50;
export const DAILY_STATS_LIMIT = 1000;

export interface SalesListQuery {
  from: string;
  to: string;
  kind?: 'cash' | 'credit' | 'all';
  customerId?: string | null;
  hasCursor: boolean;
}

export function planSales(spec: SalesListQuery): Planned[] {
  const plan: Planned[] = [
    { op: 'where', field: 'localDate', cmp: '>=', value: spec.from },
    { op: 'where', field: 'localDate', cmp: '<=', value: spec.to },
  ];
  if (spec.kind && spec.kind !== 'all') plan.push({ op: 'where', field: 'kind', cmp: '==', value: spec.kind });
  if (spec.customerId) plan.push({ op: 'where', field: 'customerId', cmp: '==', value: spec.customerId });
  plan.push(
    { op: 'orderBy', field: 'localDate', dir: 'desc' },
    { op: 'orderBy', field: 'createdAtMs', dir: 'desc' },
    { op: 'orderBy', field: '__name__', dir: 'desc' },
    { op: 'limit', n: SALES_PAGE_SIZE },
  );
  if (spec.hasCursor) plan.push({ op: 'startAfter' });
  return plan;
}

export function planInvoiceLookup(invoiceNumber: string): Planned[] {
  return [
    { op: 'where', field: 'invoiceNumber', cmp: '==', value: invoiceNumber.trim().toUpperCase() },
    { op: 'limit', n: 1 },
  ];
}

export function planReturnsForSale(hasCursor: boolean): Planned[] {
  const plan: Planned[] = [
    { op: 'where', field: 'saleId', cmp: '==', value: 'sale' },
    { op: 'orderBy', field: 'createdAtMs', dir: 'desc' },
    { op: 'orderBy', field: '__name__', dir: 'desc' },
    { op: 'limit', n: RETURNS_PAGE_SIZE },
  ];
  if (hasCursor) plan.push({ op: 'startAfter' });
  return plan;
}

export function planDailyStats(): Planned[] {
  return [
    { op: 'where', field: 'date', cmp: '>=', value: 'from' },
    { op: 'where', field: 'date', cmp: '<=', value: 'to' },
    { op: 'orderBy', field: 'date', dir: 'asc' },
    { op: 'limit', n: DAILY_STATS_LIMIT },
  ];
}
