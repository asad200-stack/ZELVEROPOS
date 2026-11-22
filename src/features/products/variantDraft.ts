import {
  MAX_OPTION_AXES,
  MAX_VARIANTS,
  OPTION_PRESETS,
  cleanValues,
  comboKey,
  optionCombos,
  type OptionAxis,
  type OptionPreset,
} from '@/domain/variants';
import type { TranslationKey } from '@/i18n/i18n';

/** One kind of option while the owner builds it: every value offered, and the ones ticked. */
export interface AxisDraft {
  name: string;
  preset: OptionPreset;
  /** Values shown as chips (the preset's plus any typed). */
  values: string[];
  /** Ticked values, in the order of `values`. */
  on: string[];
}

export interface RowDraft {
  stock: string;
  barcode: string;
  /** Retail price for this option only ('' = the item's price). */
  price: string;
}

export interface VariantDraft {
  axes: AxisDraft[];
  rows: Record<string, RowDraft>;
}

export const EMPTY_ROW: RowDraft = { stock: '', barcode: '', price: '' };

export function newAxis(name: string, preset: OptionPreset): AxisDraft {
  return { name, preset, values: [...OPTION_PRESETS[preset]], on: [] };
}

/** Switches an axis to another ready-made list, keeping values the owner typed. */
export function withPreset(axis: AxisDraft, preset: OptionPreset): AxisDraft {
  const typed = axis.values.filter((v) => !Object.values(OPTION_PRESETS).some((list: readonly string[]) => list.includes(v)));
  return { ...axis, preset, values: cleanValues([...OPTION_PRESETS[preset], ...typed]), on: axis.on.filter((v) => typed.includes(v)) };
}

export function toggleValue(axis: AxisDraft, value: string): AxisDraft {
  const on = axis.on.includes(value) ? axis.on.filter((v) => v !== value) : [...axis.on, value];
  return { ...axis, on: axis.values.filter((v) => on.includes(v)) };
}

/** Adds typed values ("Red, Blue" or one per line) and ticks them. */
export function addValues(axis: AxisDraft, text: string): AxisDraft {
  const added = cleanValues(text.split(/[,،\n]/));
  const values = cleanValues([...axis.values, ...added]);
  const on = cleanValues([...axis.on, ...added.map((a) => values.find((v) => v.toLowerCase() === a.toLowerCase()) ?? a)]);
  return { ...axis, values, on: values.filter((v) => on.includes(v)) };
}

export function selectAll(axis: AxisDraft, all: boolean): AxisDraft {
  return { ...axis, on: all ? [...axis.values] : [] };
}

/** The axes as they will be saved: named, with only the ticked values. */
export function chosenAxes(draft: VariantDraft): OptionAxis[] {
  return draft.axes
    .slice(0, MAX_OPTION_AXES)
    .map((a) => ({ name: a.name.trim(), values: cleanValues(a.on) }))
    .filter((a) => a.values.length > 0);
}

export function draftCombos(draft: VariantDraft, existing?: ReadonlySet<string>): string[][] {
  const all = optionCombos(chosenAxes(draft));
  return existing ? all.filter((values) => !existing.has(comboKey(values).toLowerCase())) : all;
}

function wholeNumber(raw: string): number | null {
  const t = raw.trim();
  if (!t) return 0;
  return /^\d{1,7}$/.test(t) ? Number(t) : null;
}

function cents(raw: string): number | null | undefined {
  const t = raw.trim().replace(',', '.');
  if (!t) return null;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(t)) return undefined;
  return Math.round(Number(t) * 100);
}

export type DraftResult =
  | { ok: true; axes: OptionAxis[]; rows: { values: string[]; stock: number; barcode: string; retailUsdCents: number | null }[] }
  | { ok: false; error: TranslationKey; params?: Record<string, string | number> };

/** Checks the builder and turns it into what the server creates; `existing` combinations are left out. */
export function readDraft(draft: VariantDraft, existing?: ReadonlySet<string>): DraftResult {
  const axes = chosenAxes(draft);
  if (draft.axes.some((a) => a.on.length > 0 && !a.name.trim())) return { ok: false, error: 'products.variants.errName' };
  if (axes.length === 0) return { ok: false, error: 'products.variants.errNone' };
  const combos = optionCombos(axes).filter((values) => !existing?.has(comboKey(values).toLowerCase()));
  if (existing && combos.length === 0) return { ok: false, error: 'products.variants.errNothingNew' };
  if (combos.length > MAX_VARIANTS) return { ok: false, error: 'products.variants.errTooMany', params: { max: MAX_VARIANTS } };
  const rows = [];
  const codes = new Set<string>();
  for (const values of combos) {
    const row = draft.rows[comboKey(values)] ?? EMPTY_ROW;
    const stock = wholeNumber(row.stock);
    const label = values.join(' / ');
    if (stock === null) return { ok: false, error: 'products.variants.errQty', params: { option: label } };
    const price = cents(row.price);
    if (price === undefined) return { ok: false, error: 'products.variants.errPrice', params: { option: label } };
    const barcode = row.barcode.trim();
    if (barcode && codes.has(barcode)) return { ok: false, error: 'products.variants.errBarcode', params: { option: label } };
    if (barcode) codes.add(barcode);
    rows.push({ values, stock, barcode, retailUsdCents: price });
  }
  return { ok: true, axes, rows };
}

/** Total pieces typed across all options. */
export function totalStock(draft: VariantDraft, existing?: ReadonlySet<string>): number {
  return draftCombos(draft, existing).reduce((s, values) => s + (wholeNumber(draft.rows[comboKey(values)]?.stock ?? '') ?? 0), 0);
}
