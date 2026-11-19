import { describe, expect, it } from 'vitest';
import { apparelSize, fitKind, shoeSize, withSizes } from './sizeAdvisor';

describe('sizeAdvisor', () => {
  it('detects shoes before apparel, in English and Arabic', () => {
    expect(fitKind({ name: 'Running Sneaker', category: 'Sport' })).toBe('shoes');
    expect(fitKind({ name: 'حذاء جلد', category: '' })).toBe('shoes');
    expect(fitKind({ name: 'Linen Shirt', category: '' })).toBe('apparel');
    expect(fitKind({ name: 'فستان سهرة', category: 'ملابس' })).toBe('apparel');
    expect(fitKind({ name: 'iPhone 15', category: 'Phones' })).toBeNull();
  });

  it('maps height and weight to a letter size and shifts with fit', () => {
    expect(apparelSize(175, 70)).toBe('M');
    expect(apparelSize(175, 70, 'snug')).toBe('S');
    expect(apparelSize(175, 70, 'loose')).toBe('L');
    expect(apparelSize(190, 70)).toBe('L');
    expect(apparelSize(150, 45, 'snug')).toBe('XS');
    expect(apparelSize(200, 150, 'loose')).toBe('3XL');
  });

  it('rejects out-of-range or non-numeric measurements', () => {
    expect(apparelSize(Number.NaN, 70)).toBeNull();
    expect(apparelSize(100, 70)).toBeNull();
    expect(apparelSize(170, 250)).toBeNull();
    expect(shoeSize(10)).toBeNull();
    expect(shoeSize(Number.NaN)).toBeNull();
  });

  it('converts foot length to EU size', () => {
    expect(shoeSize(26)).toBe('41');
    expect(shoeSize(24)).toBe('38');
  });

  it('puts sizes on top of the note and respects the max length', () => {
    expect(withSizes(' hi ', [], 300)).toBe('hi');
    expect(withSizes('', [{ name: 'Shirt', size: 'M' }], 300)).toBe('[Shirt: M]');
    expect(withSizes('ring bell', [{ name: 'A', size: 'M' }, { name: 'B', size: '42' }], 300)).toBe('[A: M | B: 42]\nring bell');
    expect(withSizes('x'.repeat(400), [{ name: 'A', size: 'M' }], 300)).toHaveLength(300);
  });
});
