import { describe, expect, it } from 'vitest';
import { boltPath, onRect, writeRibbon } from './lightning';

function seeded(seed = 7) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

describe('procedural lightning', () => {
  it('subdivides a bolt with fixed endpoints and an irregular path', () => {
    const r = seeded();
    const pts = boltPath({ x: 0, y: 0 }, { x: 1, y: 0 }, 5, 0.4, r);
    expect(pts).toHaveLength(33);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[32]).toEqual({ x: 1, y: 0 });
    expect(pts.some((p) => Math.abs(p.y) > 0.01)).toBe(true);
  });

  it('writes two triangles per segment and never overflows', () => {
    const pts = boltPath({ x: 0, y: 0 }, { x: 1, y: 1 }, 3, 0.3, seeded(3));
    const out = new Float32Array(6 * 3 * 4);
    const verts = writeRibbon(pts, 0.01, 0, out, 0);
    expect(verts).toBe(24);
  });

  it('samples points on the cube outline', () => {
    const p = onRect(0, 0, 1, 1, seeded(11));
    expect(Math.abs(p.x) === 1 || Math.abs(p.y) === 1 || Math.abs(Math.abs(p.x) - 1) < 1e-9 || Math.abs(Math.abs(p.y) - 1) < 1e-9).toBe(true);
  });
});
