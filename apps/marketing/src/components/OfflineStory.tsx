import { useEffect, useRef, useState } from 'react';
import { useInView } from '../hooks/useInView';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { playSound } from '../sound/engine';
import { GlassCard } from './GlassCard';

export const OFFLINE_STEPS = ['ONLINE', 'CONNECTION LOST', 'SALE QUEUED', 'ONLINE AGAIN', 'SYNCHRONIZED'] as const;

export function OfflineStory() {
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const visible = useInView(ref);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (reduced || !visible) return;
    const id = window.setInterval(() => {
      setStep((s) => {
        const next = (s + 1) % OFFLINE_STEPS.length;
        if (next === 2 || next === 4) playSound('demo');
        return next;
      });
    }, 1400);
    return () => window.clearInterval(id);
  }, [reduced, visible]);

  return (
    <div ref={ref}>
      <GlassCard className="zw-offline">
        <ol>
          {OFFLINE_STEPS.map((label, i) => (
            <li key={label} className={i === step || reduced ? 'is-on' : ''}>
              <span className="zw-offline__dot" />
              {label}
            </li>
          ))}
        </ol>
      </GlassCard>
    </div>
  );
}
