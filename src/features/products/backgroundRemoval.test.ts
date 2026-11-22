import { describe, expect, it } from 'vitest';
import { alphaBounds } from './backgroundRemoval';

describe('alphaBounds', () => {
  const img = (w: number, h: number, on: [number, number][]) => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (const [x, y] of on) d[(y * w + x) * 4 + 3] = 255;
    return d;
  };

  it('finds the box around visible pixels', () => {
    expect(alphaBounds(img(10, 8, [[2, 3], [6, 5]]), 10, 8)).toEqual({ x: 2, y: 3, w: 5, h: 3 });
  });

  it('returns null for a fully transparent image', () => {
    expect(alphaBounds(img(4, 4, []), 4, 4)).toBeNull();
  });
});
