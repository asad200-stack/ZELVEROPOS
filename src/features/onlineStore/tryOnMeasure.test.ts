import { describe, expect, it } from 'vitest';
import { garmentPlacement, measureBody, sizeFromShoulders } from './tryOnMeasure';

describe('tryOnMeasure', () => {
  it('maps shoulder width to a letter size, adjusted by fit', () => {
    expect(sizeFromShoulders(36)).toBe('XS');
    expect(sizeFromShoulders(42)).toBe('M');
    expect(sizeFromShoulders(45)).toBe('L');
    expect(sizeFromShoulders(60)).toBe('3XL');
    expect(sizeFromShoulders(42, 'snug')).toBe('S');
    expect(sizeFromShoulders(42, 'loose')).toBe('L');
    expect(sizeFromShoulders(36, 'snug')).toBe('XS');
    expect(sizeFromShoulders(20)).toBeNull();
    expect(sizeFromShoulders(Number.NaN)).toBeNull();
  });

  it('scales shoulder taps by the real height', () => {
    // 1000px head-to-feet for 175cm → 0.175 cm/px; 250px shoulders → 43.75cm → M
    const r = measureBody(
      { head: { x: 500, y: 100 }, feet: { x: 500, y: 1100 }, leftShoulder: { x: 375, y: 300 }, rightShoulder: { x: 625, y: 300 } },
      175,
    );
    expect(r).toEqual({ shoulderCm: 43.8, size: 'M' });
  });

  it('rejects implausible input', () => {
    const marks = { head: { x: 0, y: 0 }, feet: { x: 0, y: 30 }, leftShoulder: { x: 0, y: 5 }, rightShoulder: { x: 10, y: 5 } };
    expect(measureBody(marks, 175)).toBeNull();
    expect(measureBody({ ...marks, feet: { x: 0, y: 1000 } }, 90)).toBeNull();
  });

  it('places a garment centred below the shoulders', () => {
    const p = garmentPlacement({ x: 400, y: 300 }, { x: 600, y: 300 }, 1000, 1500);
    expect(p).not.toBeNull();
    expect(p!.cx).toBeCloseTo(0.5);
    expect(p!.w).toBeCloseTo(0.32);
    expect(p!.cy).toBeCloseTo((300 + 110) / 1500);
    expect(p!.rot).toBeCloseTo(0);
    expect(garmentPlacement({ x: 1, y: 1 }, { x: 1, y: 1 }, 100, 100)).toBeNull();
  });
});
