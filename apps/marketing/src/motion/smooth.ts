import Lenis from 'lenis';

let lenis: Lenis | null = null;

/** Inertial smooth scrolling for fine pointers; native scrolling stays on touch and reduced motion. */
export function startSmoothScroll(): () => void {
  if (typeof window === 'undefined') return () => {};
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  if (reduced || coarse || lenis) return () => {};
  lenis = new Lenis({ autoRaf: true, lerp: 0.085, wheelMultiplier: 0.95, anchors: true });
  return () => {
    lenis?.destroy();
    lenis = null;
  };
}

export function scrollToTop(): void {
  if (lenis) lenis.scrollTo(0, { immediate: true, force: true });
  else window.scrollTo({ top: 0, behavior: 'instant' });
}
