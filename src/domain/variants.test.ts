import { describe, expect, it } from 'vitest';
import { axesOf, cleanValues, compareValues, collapseVariants, optionCombos, pickVariant, usableAxes, valueInStock, variantName } from './variants';

const v = (id: string, size: string, color: string, stock: boolean, price = 1000) => ({
  id,
  name: `Tee - ${size} / ${color}`,
  priceUsdCents: price,
  inStock: stock,
  imageUrl: null as string | null,
  cutoutUrl: null as string | null,
  isNew: false,
  groupId: 'g1',
  groupName: 'Tee',
  options: [
    { name: 'Size', value: size },
    { name: 'Color', value: color },
  ],
});

describe('option values', () => {
  it('cleans, de-duplicates and keeps the order', () => {
    expect(cleanValues([' M ', 'm', 'L', '', 'XL'])).toEqual(['M', 'L', 'XL']);
  });

  it('drops empty axes and builds every combination', () => {
    const axes = usableAxes([
      { name: 'Size', values: ['S', 'M'] },
      { name: 'Color', values: ['Black', 'White'] },
      { name: 'Extra', values: ['x'] },
    ]);
    expect(axes).toHaveLength(2);
    expect(optionCombos(axes)).toEqual([
      ['S', 'Black'],
      ['S', 'White'],
      ['M', 'Black'],
      ['M', 'White'],
    ]);
    expect(optionCombos([])).toEqual([]);
    expect(variantName(' Tee ', ['M', 'Black'])).toBe('Tee - M / Black');
  });
});

describe('storefront grouping', () => {
  const plain = { id: 'p', name: 'Cap', priceUsdCents: 500, inStock: true, imageUrl: 'x', cutoutUrl: null, isNew: false };
  const items = [v('a', 'S', 'Black', false, 1000), plain, v('b', 'M', 'Black', true, 1200), v('c', 'M', 'White', true, 1200)];

  it('shows a set once, under its name, at its lowest price, led by an option in stock', () => {
    const c = collapseVariants(items);
    expect(c.listed.map((p) => p.id)).toEqual(['b', 'p']);
    expect(c.listed[0]).toMatchObject({ name: 'Tee', priceUsdCents: 1000, inStock: true });
    expect(c.leadOf.get('a')).toBe('b');
    expect(c.priceVaries.has('b')).toBe(true);
    expect(c.siblings.get('g1')).toHaveLength(3);
  });

  it('knows the axes and which values can still be bought', () => {
    const group = items.filter((p) => 'groupId' in p) as ReturnType<typeof v>[];
    expect(axesOf(group)).toEqual([
      { name: 'Size', values: ['S', 'M'] },
      { name: 'Color', values: ['Black', 'White'] },
    ]);
    expect(valueInStock(group, ['M', 'Black'], 0, 'S')).toBe(false);
    expect(valueInStock(group, ['M', 'Black'], 1, 'White')).toBe(true);
    expect(pickVariant(group, ['M', 'White'], 1, 'Black')?.id).toBe('b');
    expect(pickVariant(group, ['M', 'Black'], 0, 'S')?.id).toBe('a');
  });
});

describe('value order', () => {
  it('puts sizes in size order whatever order the catalogue had', () => {
    expect(['L', 'S', 'XL', 'M'].sort(compareValues)).toEqual(['S', 'M', 'L', 'XL']);
    expect(['42', '38', '40'].sort(compareValues)).toEqual(['38', '40', '42']);
    expect(['Red', 'Blue'].sort(compareValues)).toEqual(['Red', 'Blue']);
  });
});
