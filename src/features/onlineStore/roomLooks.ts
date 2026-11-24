import type { PublicProduct } from '@/domain/onlineStore';

/** The fitting room shows once this many pieces have a fitting-room photo. */
export const FITTING_ROOM_MIN = 2;

/** One piece in the fitting room: its options that also have a fitting-room photo. */
export interface Look {
  key: string;
  /** Options of the piece (colours...) that have a photo; the first is shown first. */
  variants: PublicProduct[];
}

/** Pieces with a fitting-room photo, in stock, one per size/colour set, in catalogue order. */
export function fittingLooks(products: readonly PublicProduct[]): Look[] {
  const out: Look[] = [];
  const byKey = new Map<string, Look>();
  for (const p of products) {
    if (!p.lookUrl || !p.inStock) continue;
    const key = p.groupId ?? p.id;
    const have = byKey.get(key);
    if (have) {
      // One option per look: two sizes of the same colour share a photo.
      if (!have.variants.some((v) => v.lookUrl === p.lookUrl)) have.variants.push(p);
      continue;
    }
    const look = { key, variants: [p] };
    byKey.set(key, look);
    out.push(look);
  }
  return out;
}

/** Categories of the pieces in the fitting room, most common first. */
export function lookCategories(looks: readonly Look[], max = 3): string[] {
  const count = new Map<string, number>();
  for (const l of looks) {
    const c = l.variants[0]?.category.trim() ?? '';
    if (c) count.set(c, (count.get(c) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([c]) => c);
}

/** Wraps an index around a list of n items. */
export const wrap = (i: number, n: number): number => (n === 0 ? 0 : ((i % n) + n) % n);

const COLOUR_WORDS: Record<string, string> = {
  black: '#1f1f1f', white: '#f5f5f0', ivory: '#f3eedd', cream: '#efe6d0', beige: '#d9c6a5', ecru: '#e8dfc8',
  grey: '#9a9a9a', gray: '#9a9a9a', navy: '#1f2b4d', blue: '#3563b5', 'light blue': '#a9c6e8', red: '#b3262e',
  rust: '#a6482a', orange: '#e07b2a', yellow: '#e6c14a', green: '#3f7a43', olive: '#5b5f2e', khaki: '#a39a6b',
  brown: '#6b4428', camel: '#b8864f', pink: '#e7a0b4', purple: '#6a3f8f', burgundy: '#6d1a2a', denim: '#4b6a93',
  أسود: '#1f1f1f', اسود: '#1f1f1f', أبيض: '#f5f5f0', ابيض: '#f5f5f0', رمادي: '#9a9a9a', كحلي: '#1f2b4d',
  أزرق: '#3563b5', ازرق: '#3563b5', أحمر: '#b3262e', احمر: '#b3262e', أخضر: '#3f7a43', اخضر: '#3f7a43',
  بني: '#6b4428', بيج: '#d9c6a5', زهري: '#e7a0b4', وردي: '#e7a0b4', خمري: '#6d1a2a', زيتي: '#5b5f2e',
};

/** A swatch colour for an option value ("Navy", "أسود", "#123456"), or null when unknown. */
export function swatchOf(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (COLOUR_WORDS[v]) return COLOUR_WORDS[v] ?? null;
  const word = Object.keys(COLOUR_WORDS).find((w) => v.includes(w));
  return word ? (COLOUR_WORDS[word] ?? null) : null;
}
