import { type CSSProperties, type ReactNode, useRef } from 'react';
import { useIsCoarsePointer, usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';

interface Props {
  children: ReactNode;
  className?: string;
  tilt?: boolean;
}

export function GlassCard({ children, className = '', tilt = false }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const coarse = useIsCoarsePointer();
  const liveTilt = tilt && !reduced && !coarse;

  return (
    <div
      ref={ref}
      className={`zw-glass ${className}`}
      onMouseMove={
        liveTilt
          ? (e) => {
              const el = ref.current;
              if (!el) return;
              const r = el.getBoundingClientRect();
              const x = (e.clientX - r.left) / r.width - 0.5;
              const y = (e.clientY - r.top) / r.height - 0.5;
              el.style.setProperty('--tilt-x', `${(-y * 4).toFixed(2)}deg`);
              el.style.setProperty('--tilt-y', `${(x * 6).toFixed(2)}deg`);
              el.style.setProperty('--spot-x', `${e.clientX - r.left}px`);
              el.style.setProperty('--spot-y', `${e.clientY - r.top}px`);
            }
          : undefined
      }
      onMouseLeave={
        liveTilt
          ? () => {
              const el = ref.current;
              if (!el) return;
              el.style.setProperty('--tilt-x', '0deg');
              el.style.setProperty('--tilt-y', '0deg');
            }
          : undefined
      }
      style={liveTilt ? ({ transform: 'rotateX(var(--tilt-x, 0deg)) rotateY(var(--tilt-y, 0deg))' } as CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}
