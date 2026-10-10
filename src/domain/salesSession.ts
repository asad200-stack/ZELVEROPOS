/**
 * Sales history keeps one page of invoices. Next and back remember cursor keys
 * (date, time, id), not the invoices themselves.
 */

export interface SalesCursorKey {
  localDate: string;
  createdAtMs: number;
  id: string;
}

export interface SalesWindow<T> {
  items: T[];
  /** Start cursor of each page already left, oldest first. Page 0 is null. */
  back: (SalesCursorKey | null)[];
  start: SalesCursorKey | null;
}

export function emptySalesWindow<T>(): SalesWindow<T> {
  return { items: [], back: [], start: null };
}

export function showSalesPage<T>(window: SalesWindow<T>, items: T[]): SalesWindow<T> {
  return { ...window, items };
}

/** Moves the cursor and keeps the rows already on screen until the next page arrives. */
export function goToNextSalesPage<T>(window: SalesWindow<T>, end: SalesCursorKey): SalesWindow<T> {
  return { items: window.items, back: [...window.back, window.start], start: end };
}

export function goToPreviousSalesPage<T>(window: SalesWindow<T>): SalesWindow<T> {
  if (window.back.length === 0) return window;
  const back = window.back.slice(0, -1);
  return { items: window.items, back, start: window.back[window.back.length - 1] ?? null };
}

/** A response applies only when it belongs to the latest request. */
export function acceptSalesResult(requestId: number, currentId: number): boolean {
  return requestId === currentId;
}
