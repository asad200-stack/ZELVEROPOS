/** Procedural branching lightning: midpoint displacement, rebuilt every few frames. */
export type V2 = { x: number; y: number };

export function boltPath(a: V2, b: V2, depth: number, rough: number, rand: () => number = Math.random): V2[] {
  let pts: V2[] = [a, b];
  let amp = Math.hypot(b.x - a.x, b.y - a.y) * rough;
  for (let d = 0; d < depth; d++) {
    const next: V2[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i];
      const q = pts[i + 1];
      const nx = -(q.y - p.y);
      const ny = q.x - p.x;
      const len = Math.hypot(nx, ny) || 1;
      const off = (rand() - 0.5) * amp;
      next.push({ x: (p.x + q.x) / 2 + (nx / len) * off, y: (p.y + q.y) / 2 + (ny / len) * off }, q);
    }
    pts = next;
    amp *= 0.55;
  }
  return pts;
}

/** Writes a camera-facing ribbon (2 triangles per segment) into `out`; returns vertex count written. */
export function writeRibbon(pts: V2[], width: number, z: number, out: Float32Array, offset: number): number {
  let o = offset;
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    const taper = Math.sin(Math.PI * ((i + 0.5) / (pts.length - 1)));
    const w = width * (0.35 + 0.65 * taper);
    const nx = (-dy / len) * w;
    const ny = (dx / len) * w;
    const quad = [p.x + nx, p.y + ny, p.x - nx, p.y - ny, q.x + nx, q.y + ny, q.x + nx, q.y + ny, p.x - nx, p.y - ny, q.x - nx, q.y - ny];
    if (o + 18 > out.length) break;
    for (let k = 0; k < 6; k++) {
      out[o++] = quad[k * 2];
      out[o++] = quad[k * 2 + 1];
      out[o++] = z;
    }
  }
  return (o - offset) / 3;
}

/** Random point on a rectangle perimeter. */
export function onRect(cx: number, cy: number, hw: number, hh: number, rand: () => number = Math.random): V2 {
  const t = rand() * 4;
  if (t < 1) return { x: cx - hw + 2 * hw * t, y: cy + hh };
  if (t < 2) return { x: cx + hw, y: cy + hh - 2 * hh * (t - 1) };
  if (t < 3) return { x: cx + hw - 2 * hw * (t - 2), y: cy - hh };
  return { x: cx - hw, y: cy - hh + 2 * hh * (t - 3) };
}
