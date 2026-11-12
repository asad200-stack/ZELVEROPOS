import { useEffect, useRef } from 'react';
import { useIsCoarsePointer, usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';

export function CursorGlow() {
  const ref = useRef<HTMLDivElement>(null);
  const coarse = useIsCoarsePointer();
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (coarse || reduced) return;
    const el = ref.current;
    if (!el) return;
    const move = (e: PointerEvent) => {
      el.style.transform = `translate3d(${e.clientX - 12}px, ${e.clientY - 12}px, 0)`;
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => window.removeEventListener('pointermove', move);
  }, [coarse, reduced]);

  if (coarse || reduced) return null;
  return <div ref={ref} className="zw-cursor" aria-hidden />;
}
