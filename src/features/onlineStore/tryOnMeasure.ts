/**
 * Pure helpers for the on-device "try it on" view. Points are in the photo's
 * natural pixel space; nothing here touches the network.
 */
import { APPAREL_SIZES, type FitPref } from './sizeAdvisor';

export interface Pt {
  x: number;
  y: number;
}

export interface BodyMarks {
  head: Pt;
  feet: Pt;
  leftShoulder: Pt;
  rightShoulder: Pt;
}

export interface Placement {
  /** Centre of the overlay as a fraction of the photo width / height. */
  cx: number;
  cy: number;
  /** Overlay width as a fraction of the photo width. */
  w: number;
  /** Rotation in degrees. */
  rot: number;
}

const SHOULDER_BOUNDS = [38, 41, 44, 47, 50, 53];

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Letter size from shoulder width (cm) and preferred fit. */
export function sizeFromShoulders(shoulderCm: number, fit: FitPref = 'regular'): string | null {
  if (!Number.isFinite(shoulderCm) || shoulderCm < 28 || shoulderCm > 70) return null;
  let i = SHOULDER_BOUNDS.findIndex((b) => shoulderCm < b);
  if (i < 0) i = SHOULDER_BOUNDS.length;
  i += fit === 'snug' ? -1 : fit === 'loose' ? 1 : 0;
  return APPAREL_SIZES[Math.max(0, Math.min(APPAREL_SIZES.length - 1, i))] ?? null;
}

/**
 * Estimate shoulder width from four taps and the person's real height.
 * Returns null when the marks or height are implausible.
 */
export function measureBody(marks: BodyMarks, heightCm: number, fit: FitPref = 'regular'): { shoulderCm: number; size: string } | null {
  if (!Number.isFinite(heightCm) || heightCm < 120 || heightCm > 220) return null;
  const bodyPx = dist(marks.head, marks.feet);
  if (bodyPx < 50) return null;
  const cmPerPx = heightCm / bodyPx;
  const shoulderCm = Math.round(dist(marks.leftShoulder, marks.rightShoulder) * cmPerPx * 10) / 10;
  const size = sizeFromShoulders(shoulderCm, fit);
  return size ? { shoulderCm, size } : null;
}

/** Place a garment image over the shoulders: wider than the shoulder line, hanging below it. */
export function garmentPlacement(left: Pt, right: Pt, photoW: number, photoH: number): Placement | null {
  if (photoW <= 0 || photoH <= 0) return null;
  const span = dist(left, right);
  if (span <= 0) return null;
  const mx = (left.x + right.x) / 2;
  const my = (left.y + right.y) / 2;
  const w = clamp((span * 1.6) / photoW, 0.1, 1.5);
  // The garment's top sits slightly above the shoulder line; its centre is lower.
  const cy = (my + span * 0.55) / photoH;
  const a = left.x <= right.x ? [left, right] : [right, left];
  const rot = (Math.atan2(a[1]!.y - a[0]!.y, a[1]!.x - a[0]!.x) * 180) / Math.PI;
  return { cx: clamp(mx / photoW, 0, 1), cy: clamp(cy, 0, 1), w, rot: clamp(rot, -45, 45) };
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
