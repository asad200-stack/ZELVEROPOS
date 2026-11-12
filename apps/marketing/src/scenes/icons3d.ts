import { useSyncExternalStore } from 'react';
import { useIsMobile, usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { hasWebGL, shouldLoadHero3d } from './policy';

let webgl: boolean | undefined;

export function useScene3dMode(): 'full' | 'simple' | 'off' {
  const reduced = usePrefersReducedMotion();
  const mobile = useIsMobile();
  if (webgl === undefined) webgl = typeof document !== 'undefined' && hasWebGL();
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { connection?: { saveData?: boolean } }) : undefined;
  return shouldLoadHero3d({
    reducedMotion: reduced,
    webgl,
    mobile,
    saveData: Boolean(nav?.connection?.saveData),
    cores: nav?.hardwareConcurrency || 8,
  });
}

/* One shared WebGL layer renders every 3D icon; grids report whether they are near the viewport. */
const grids = new Map<string, boolean>();
const listeners = new Set<() => void>();
let snapshot = { mounted: false, active: false };

export function setIconGrid(id: string, near: boolean | null): void {
  if (near === null) grids.delete(id);
  else grids.set(id, near);
  const active = [...grids.values()].some(Boolean);
  const mounted = snapshot.mounted || grids.size > 0;
  if (active === snapshot.active && mounted === snapshot.mounted) return;
  snapshot = { mounted, active };
  listeners.forEach((l) => l());
}

export function useIconLayer(): { mounted: boolean; active: boolean } {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
    () => snapshot,
  );
}
