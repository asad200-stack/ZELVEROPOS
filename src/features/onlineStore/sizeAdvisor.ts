/**
 * Client-only size helpers for the public storefront. Nothing here is sent to
 * the server except the final "sizes" line that is folded into the order note.
 */

export type FitKind = 'apparel' | 'shoes';
export type FitPref = 'snug' | 'regular' | 'loose';

export const APPAREL_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'] as const;
export const SHOE_SIZES = ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46'] as const;

const SHOE_WORDS = [
  'shoe', 'sneaker', 'boot', 'sandal', 'heel', 'slipper', 'loafer', 'trainer',
  'حذاء', 'أحذية', 'احذية', 'بوط', 'صندل', 'شحاطة', 'كندرة', 'سنيكرز',
];
const APPAREL_WORDS = [
  'shirt', 'dress', 'jacket', 'hoodie', 'pants', 'jeans', 'skirt', 'coat', 'sweater', 'blouse',
  'abaya', 'trouser', 'shorts', 'clothing', 'apparel', 'polo', 'cardigan', 'suit',
  'قميص', 'فستان', 'جاكيت', 'جاكيط', 'بنطلون', 'بنطال', 'تنورة', 'كنزة', 'بلوزة', 'ملابس', 'تيشيرت',
  'عباية', 'هودي', 'جينز', 'معطف', 'شورت', 'بدلة',
];

/** Guess whether a product needs a clothing or shoe size, from its name and category. */
export function fitKind(product: { name: string; category: string }): FitKind | null {
  const text = `${product.name} ${product.category}`.toLowerCase();
  if (SHOE_WORDS.some((w) => text.includes(w))) return 'shoes';
  if (APPAREL_WORDS.some((w) => text.includes(w))) return 'apparel';
  return null;
}

/** Rough letter size from height (cm), weight (kg) and preferred fit. */
export function apparelSize(heightCm: number, weightKg: number, fit: FitPref = 'regular'): string | null {
  if (!Number.isFinite(heightCm) || !Number.isFinite(weightKg)) return null;
  if (heightCm < 120 || heightCm > 220 || weightKg < 30 || weightKg > 200) return null;
  const bounds = [50, 60, 72, 85, 100, 115];
  let i = bounds.findIndex((b) => weightKg < b);
  if (i < 0) i = bounds.length;
  if (heightCm > 185) i += 1;
  if (heightCm < 155) i -= 1;
  i += fit === 'snug' ? -1 : fit === 'loose' ? 1 : 0;
  const clamped = Math.max(0, Math.min(APPAREL_SIZES.length - 1, i));
  return APPAREL_SIZES[clamped] ?? null;
}

/** EU shoe size from foot length in cm (heel to longest toe). */
export function shoeSize(footCm: number): string | null {
  if (!Number.isFinite(footCm) || footCm < 15 || footCm > 35) return null;
  return String(Math.round(1.5 * (footCm + 1.5)));
}

/** Put the chosen sizes at the top of the order note, within the server limit. */
export function withSizes(note: string, sizes: { name: string; size: string }[], max: number): string {
  const head = sizes.map((s) => `${s.name}: ${s.size}`).join(' | ');
  const body = note.trim();
  const full = head ? (body ? `[${head}]\n${body}` : `[${head}]`) : body;
  return full.slice(0, max);
}
