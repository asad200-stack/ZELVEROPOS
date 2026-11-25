import { describe, expect, it } from 'vitest';
import { guessLookSlot, toLookHem } from './onlineStore';

describe('guessLookSlot', () => {
  it('reads the name first, then the category', () => {
    expect(guessLookSlot('Bullet Casual Color-Block Denim Bomber Jacket', 'Women clothing')).toBe('top');
    expect(guessLookSlot('High-Waist Button-Detail Barrel Jeans', 'Women clothing')).toBe('bottom');
    expect(guessLookSlot('Ivory knit Cardigan', '')).toBe('top');
    expect(guessLookSlot('Silk evening dress', 'Tops')).toBe('full');
    expect(guessLookSlot('Model 12', 'Skirts')).toBe('bottom');
    expect(guessLookSlot('بنطلون جينز أزرق', '')).toBe('bottom');
    expect(guessLookSlot('كنزة صوف', '')).toBe('top');
    expect(guessLookSlot('Something', 'Misc')).toBe('full');
  });

  it('keeps only hems in range', () => {
    expect(toLookHem(55)).toBe(55);
    expect(toLookHem(10)).toBe(0);
    expect(toLookHem('55')).toBe(0);
  });
});
