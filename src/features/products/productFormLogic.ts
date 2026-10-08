import { centsToInput, isValidExchangeRate, parseLbpInput, suggestedLbpInput, usdCentsToLbp } from '@/domain/money';
import { NEW_OPTION } from './inlineCreate';

export const PRICE_TIERS = ['retail', 'wholesale', 'vip'] as const;
export type PriceTierName = (typeof PRICE_TIERS)[number];
export type LbpMode = 'auto' | 'manual';

export interface TierPriceDraft {
  usd: string;
  lbp: string;
  lbpMode: LbpMode;
}

/** LBP to display for a USD field. Null when the rate or the USD text cannot be converted. */
export function suggestedTierLbp(usdRaw: string, rate: number): string | null {
  return suggestedLbpInput(usdRaw, rate);
}

export function draftFromStored(usdCents: number, lbp: number | null, rate: number, hideZeroUsd: boolean): TierPriceDraft {
  const usd = !usdCents ? (hideZeroUsd ? '' : centsToInput(0)) : centsToInput(usdCents);
  const expected = isValidExchangeRate(rate) && usdCents > 0 ? usdCentsToLbp(usdCents, rate) : null;
  const manual = lbp != null && lbp > 0 && expected !== lbp;
  if (manual) return { usd, lbp: String(lbp), lbpMode: 'manual' };
  const suggestion = suggestedLbpInput(usd, rate);
  return { usd, lbp: suggestion ?? '', lbpMode: 'auto' };
}

/** USD edits recalculate LBP only while that tier is still automatic. Invalid USD leaves LBP untouched. */
export function usdEdited(draft: TierPriceDraft, usd: string, rate: number): TierPriceDraft {
  const next = { ...draft, usd };
  if (next.lbpMode === 'manual') return next;
  if (!isValidExchangeRate(rate)) return { ...next, lbp: '' };
  const suggestion = suggestedLbpInput(usd, rate);
  if (suggestion === null) return next;
  return { ...next, lbp: suggestion };
}

/** A cleared LBP field returns to automatic mode. Any other edit is kept. */
export function lbpEdited(draft: TierPriceDraft, lbp: string, rate: number): TierPriceDraft {
  if (!lbp.trim()) {
    const suggestion = suggestedLbpInput(draft.usd, rate);
    return { ...draft, lbpMode: 'auto', lbp: suggestion ?? '' };
  }
  return { ...draft, lbpMode: 'manual', lbp };
}

/** A new store rate updates automatic LBP only. Manual overrides and invalid rates do not invent a price. */
export function rateChanged(draft: TierPriceDraft, rate: number): TierPriceDraft {
  if (draft.lbpMode === 'manual') return draft;
  if (!isValidExchangeRate(rate)) return { ...draft, lbp: '' };
  const suggestion = suggestedLbpInput(draft.usd, rate);
  if (suggestion === null) return draft;
  return { ...draft, lbp: suggestion };
}

/** Automatic LBP is stored as null so the register keeps using the live rate. */
export function lbpToSave(draft: TierPriceDraft): number | null {
  if (draft.lbpMode !== 'manual') return null;
  return parseLbpInput(draft.lbp);
}

export interface FieldTarget {
  tag: string;
  name: string;
  type?: string;
  inInline: boolean;
}

export type EnterAction = { type: 'ignore' } | { type: 'stay' } | { type: 'add-serial' } | { type: 'focus'; name: string };

export function productFieldOrder(options: { showCost: boolean; showInitialStock: boolean; showImeiEntry: boolean }): string[] {
  const fields = ['name', 'category', 'barcode', 'supplierId', 'retail', 'wholesale', 'vip', 'retailLbp', 'wholesaleLbp', 'vipLbp'];
  if (options.showCost) fields.push('cost');
  fields.push('minStock', 'expiryDate');
  if (options.showInitialStock) fields.push('initialStock');
  fields.push('imeiTracking');
  if (options.showImeiEntry) fields.push('imeiEntry');
  fields.push('product-image');
  return fields;
}

export function nextProductField(current: string, visible: readonly string[]): string | null {
  const index = visible.indexOf(current);
  if (index < 0) return null;
  return visible[index + 1] ?? null;
}

/**
 * Enter never submits the product. Selects keep the browser's own open-list behavior.
 * The IMEI box adds a serial. Every other field moves forward, or stays on the last one.
 */
export function enterAction(target: FieldTarget, visible: readonly string[]): EnterAction {
  if (target.inInline || target.tag === 'BUTTON' || target.tag === 'SELECT' || target.tag === 'TEXTAREA') return { type: 'ignore' };
  if (target.type === 'file') return { type: 'stay' };
  if (target.name === 'imeiEntry' || target.name === 'imeiEdit') return { type: 'add-serial' };
  const next = nextProductField(target.name, visible);
  return next ? { type: 'focus', name: next } : { type: 'stay' };
}

/** After a closed select accepts Enter, move on — unless that choice opened inline create. */
export function selectEnterMoves(value: string, panelOpen: boolean): boolean {
  if (panelOpen || value === NEW_OPTION) return false;
  return true;
}

export function focusProductField(root: ParentNode | null, name: string): void {
  root?.querySelector<HTMLElement>(`[name="${name}"]`)?.focus();
}

const IMEI_MAX = 64;

export type SerialError = 'empty' | 'duplicate' | 'long';

export function normalizeSerial(raw: string): string {
  return raw.trim();
}

export function addSerial(list: readonly string[], raw: string): { list: string[]; error: SerialError | null; serial: string } {
  const serial = normalizeSerial(raw);
  if (!serial) return { list: [...list], error: 'empty', serial };
  if (serial.length > IMEI_MAX) return { list: [...list], error: 'long', serial };
  if (list.includes(serial)) return { list: [...list], error: 'duplicate', serial };
  return { list: [...list, serial], error: null, serial };
}

export function replaceSerial(list: readonly string[], index: number, raw: string): { list: string[]; error: SerialError | null } {
  const serial = normalizeSerial(raw);
  if (!serial) return { list: list.filter((_, i) => i !== index), error: null };
  if (serial.length > IMEI_MAX) return { list: [...list], error: 'long' };
  if (list.some((item, i) => i !== index && item === serial)) return { list: [...list], error: 'duplicate' };
  const next = [...list];
  next[index] = serial;
  return { list: next, error: null };
}

/**
 * Create-only. Empty initial stock means "use the serial count".
 * A typed count that does not match is rejected so stock cannot claim devices that have no serial.
 */
export function resolveCreateInventory(
  tracking: boolean,
  stock: number | null,
  serials: readonly string[],
): { ok: true; initialStock: number; initialImeis: string[] } | { ok: false; stock: number; count: number } {
  if (!tracking) return { ok: true, initialStock: stock ?? 0, initialImeis: [] };
  const initialImeis = serials.map(normalizeSerial).filter(Boolean);
  const count = initialImeis.length;
  if (stock !== null && stock !== count) return { ok: false, stock, count };
  return { ok: true, initialStock: count, initialImeis };
}

/** Edit never sends opening stock or a new serial list. Those stay on the adjust-stock flow. */
export function editOmitsOpeningInventory(payload: Record<string, unknown>): boolean {
  return !('initialStock' in payload) && !('initialImeis' in payload) && !('stock' in payload) && !('imeis' in payload);
}
