/**
 * Products sold in sizes, colours or other options (a T-shirt in S/M/L, a shoe in 38–44).
 *
 * Each option is stored as its own product with its own stock, barcode and sales history, so
 * selling, returns, purchases, counts and reports keep working unchanged. The options of one
 * item share a `groupId`, the item's `groupName`, and say which values they are in `options`.
 */

export interface ProductOption {
  /** Option name, e.g. "Size" or "المقاس". */
  name: string;
  /** This product's value, e.g. "M" or "42". */
  value: string;
}

export interface OptionAxis {
  name: string;
  values: string[];
}

/** At most two kinds of option per item (e.g. size and colour). */
export const MAX_OPTION_AXES = 2;
/** At most this many options (sizes × colours) are created in one go. */
export const MAX_VARIANTS = 60;
export const OPTION_NAME_MAX = 30;
export const OPTION_VALUE_MAX = 30;

/** Ready-made value lists the owner can start from; every list can be edited. */
export const OPTION_PRESETS = {
  clothes: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'],
  shoes: ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46'],
  kids: ['0-3M', '3-6M', '6-12M', '1Y', '2Y', '3Y', '4Y', '6Y', '8Y', '10Y', '12Y', '14Y'],
  pants: ['28', '29', '30', '31', '32', '33', '34', '36', '38', '40'],
  colors: [] as string[],
  custom: [] as string[],
} as const;
export type OptionPreset = keyof typeof OPTION_PRESETS;
export const OPTION_PRESET_KEYS = Object.keys(OPTION_PRESETS) as OptionPreset[];

/** Trimmed, length-limited, de-duplicated (case-insensitive) values in their original order. */
export function cleanValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = raw.trim().replace(/\s+/g, ' ').slice(0, OPTION_VALUE_MAX);
    const k = v.toLowerCase();
    if (!v || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/** Axes that have a name and at least one value, cleaned. */
export function usableAxes(axes: readonly OptionAxis[]): OptionAxis[] {
  return axes
    .slice(0, MAX_OPTION_AXES)
    .map((a) => ({ name: a.name.trim().slice(0, OPTION_NAME_MAX), values: cleanValues(a.values) }))
    .filter((a) => a.name && a.values.length > 0);
}

/** Every combination of the axes' values, first axis outermost: S/Black, S/White, M/Black… */
export function optionCombos(axes: readonly OptionAxis[]): string[][] {
  let out: string[][] = [[]];
  for (const axis of axes) out = out.flatMap((prefix) => axis.values.map((v) => [...prefix, v]));
  return axes.length === 0 ? [] : out;
}

/** Stable key of one combination, used to keep the quantities typed for it. */
export function comboKey(values: readonly string[]): string {
  return values.join('\u0001');
}

/** "T-shirt - M / Black". */
export function variantName(base: string, values: readonly string[]): string {
  const name = base.trim();
  return values.length ? `${name} - ${values.join(' / ')}`.slice(0, 200) : name;
}

/* ------------------------------------------------------------------ storefront */

interface Variantish {
  id: string;
  name: string;
  priceUsdCents: number;
  inStock: boolean;
  imageUrl: string | null;
  cutoutUrl: string | null;
  isNew: boolean;
  groupId?: string | null;
  groupName?: string;
  options?: ProductOption[];
}

export interface CollapsedCatalog<P extends Variantish> {
  /** One entry per item: stand-alone products as they are, each option set as its lead option renamed to the item. */
  listed: P[];
  /** Any product id → the id of the entry listed for it. */
  leadOf: Map<string, string>;
  /** groupId → its options in catalogue order. */
  siblings: Map<string, P[]>;
  /** Lead ids whose options do not all cost the same (the card says "from"). */
  priceVaries: Set<string>;
}

/**
 * Folds the options of an item into one catalogue entry. The entry keeps the id of its first
 * option in stock (else its first option), shows the item's name, its lowest price, a photo
 * from any option, and counts as in stock when any option is.
 */
export function collapseVariants<P extends Variantish>(products: readonly P[]): CollapsedCatalog<P> {
  const siblings = new Map<string, P[]>();
  for (const p of products) {
    if (!p.groupId) continue;
    const list = siblings.get(p.groupId);
    if (list) list.push(p);
    else siblings.set(p.groupId, [p]);
  }
  const listed: P[] = [];
  const leadOf = new Map<string, string>();
  const priceVaries = new Set<string>();
  const done = new Set<string>();
  for (const p of products) {
    const group = p.groupId ? siblings.get(p.groupId) : undefined;
    if (!group || group.length < 2 || !p.groupId) {
      listed.push(p);
      leadOf.set(p.id, p.id);
      continue;
    }
    if (done.has(p.groupId)) continue;
    done.add(p.groupId);
    const lead = group.find((v) => v.inStock) ?? group[0]!;
    const prices = group.map((v) => v.priceUsdCents).filter((c) => c > 0);
    const low = prices.length ? Math.min(...prices) : lead.priceUsdCents;
    const pic = group.find((v) => v.imageUrl);
    const cut = group.find((v) => v.cutoutUrl);
    listed.push({
      ...lead,
      name: lead.groupName?.trim() || lead.name,
      priceUsdCents: low,
      inStock: group.some((v) => v.inStock),
      imageUrl: lead.imageUrl ?? pic?.imageUrl ?? null,
      cutoutUrl: lead.cutoutUrl ?? cut?.cutoutUrl ?? null,
      isNew: group.some((v) => v.isNew),
    });
    if (new Set(prices).size > 1) priceVaries.add(lead.id);
    for (const v of group) leadOf.set(v.id, lead.id);
  }
  return { listed, leadOf, siblings, priceVaries };
}

const SIZE_LISTS: readonly (readonly string[])[] = [OPTION_PRESETS.clothes, OPTION_PRESETS.kids, OPTION_PRESETS.shoes, OPTION_PRESETS.pants];

/** Sizes in their natural order (S before M before L, 38 before 40); other values keep their order. */
export function compareValues(a: string, b: string): number {
  for (const list of SIZE_LISTS) {
    const i = list.indexOf(a.toUpperCase());
    const j = list.indexOf(b.toUpperCase());
    if (i >= 0 && j >= 0) return i - j;
  }
  const x = Number(a.replace(',', '.'));
  const y = Number(b.replace(',', '.'));
  if (a.trim() && b.trim() && Number.isFinite(x) && Number.isFinite(y)) return x - y;
  return 0;
}

/** The option kinds of a set and their values, sizes in size order. */
export function axesOf(variants: readonly { options?: ProductOption[] }[]): OptionAxis[] {
  const axes: OptionAxis[] = [];
  for (const v of variants) {
    (v.options ?? []).forEach((o, i) => {
      const axis = (axes[i] ??= { name: o.name, values: [] });
      if (!axis.values.includes(o.value)) axis.values.push(o.value);
    });
  }
  for (const axis of axes) axis.values.sort(compareValues);
  return axes;
}

function valuesOf(v: { options?: ProductOption[] }): string[] {
  return (v.options ?? []).map((o) => o.value);
}

/**
 * The option a visitor lands on after choosing `value` for axis `axis`, keeping their other
 * choices where possible; an option in stock wins over one that is sold out.
 */
export function pickVariant<V extends { inStock: boolean; options?: ProductOption[] }>(
  variants: readonly V[],
  current: readonly string[],
  axis: number,
  value: string,
): V | null {
  const matching = variants.filter((v) => valuesOf(v)[axis] === value);
  const score = (v: V) => valuesOf(v).reduce((s, x, i) => s + (i !== axis && x === current[i] ? 2 : 0), 0) + (v.inStock ? 1 : 0);
  return [...matching].sort((a, b) => score(b) - score(a))[0] ?? null;
}

/** Whether `value` on axis `axis` can be bought together with the visitor's other choices. */
export function valueInStock(
  variants: readonly { inStock: boolean; options?: ProductOption[] }[],
  current: readonly string[],
  axis: number,
  value: string,
): boolean {
  return variants.some((v) => {
    const vals = valuesOf(v);
    return v.inStock && vals[axis] === value && vals.every((x, i) => i === axis || i > axis || x === current[i]);
  });
}
