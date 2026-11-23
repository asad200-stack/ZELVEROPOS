import { describe, expect, it } from 'vitest';
import { axesOf, cleanValues, compareValues, collapseVariants, inheritedPhoto, optionCombos, photoAxisIndex, pickVariant, samePhotoLook, usableAxes, valueInStock, variantName } from './variants';

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

describe('photos per colour', () => {
  const opt = (size: string, color: string, imageUrl: string | null = null) => ({
    options: [
      { name: 'Size', value: size },
      { name: 'Color', value: color },
    ],
    imageUrl,
    imagePath: imageUrl ? `p/${imageUrl}` : null,
  });

  it('puts the photo on the colour, not the size', () => {
    expect(photoAxisIndex(axesOf([opt('S', 'Red'), opt('M', 'Blue')]))).toBe(1);
    expect(photoAxisIndex([{ values: ['Red', 'Blue'] }, { values: ['S', 'M'] }])).toBe(0);
    expect(photoAxisIndex([{ values: ['S', 'M', 'L'] }])).toBe(-1);
    expect(photoAxisIndex([{ values: ['40', '41'] }])).toBe(-1);
  });

  it('a new size starts with the photo of its colour', () => {
    const siblings = [opt('S', 'Red', 'red.webp'), opt('S', 'Blue', 'blue.webp'), opt('M', 'Blue')];
    expect(inheritedPhoto(siblings, ['XL', 'blue'])).toEqual({ imageUrl: 'blue.webp', imagePath: 'p/blue.webp' });
    expect(inheritedPhoto(siblings, ['XL', 'Green'])).toBeNull();
  });

  it('sizes only: every option shares the photo', () => {
    const siblings = [
      { options: [{ name: 'Size', value: 'S' }], imageUrl: 'a.webp', imagePath: 'p/a' },
      { options: [{ name: 'Size', value: 'M' }], imageUrl: null, imagePath: null },
    ];
    expect(inheritedPhoto(siblings, ['XL'])?.imageUrl).toBe('a.webp');
    expect(samePhotoLook(['S'], ['M'], -1)).toBe(true);
  });
});
