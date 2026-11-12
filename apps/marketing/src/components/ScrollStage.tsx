import { useEffect, useRef } from 'react';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { PosInterface } from './PosInterface';
import { Words } from './Words';

/**
 * Apple-style product stage: the POS lies back in 3D and stands up as you scroll,
 * while the headline and floating capability tags travel at different depths.
 */
export function ScrollStage() {
  const ref = useRef<HTMLElement>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduced) {
      el.style.setProperty('--p', '1');
      el.classList.add('is-in');
      return;
    }
    let raf = 0;
    const update = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const p = Math.min(1, Math.max(0, (vh - r.top) / (vh * 0.95)));
      const out = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height - vh * 0.4)));
      el.style.setProperty('--p', p.toFixed(4));
      el.style.setProperty('--out', out.toFixed(4));
      if (p > 0.2) el.classList.add('is-in');
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [reduced]);

  return (
    <section className="zw-stage" ref={ref} aria-label="The ZELVERO POS">
      <div className="zw-stage__sticky">
        <div className="zw-wrap zw-stage__head">
          <p className="zw-eyebrow">The ZELVERO POS</p>
          <h2 id="zw-stage-title" className="zw-reveal">
            <Words text="Your whole store." />
            <br />
            <Words text="One screen." offset={3} className="zw-grad" />
          </h2>
        </div>
        <div className="zw-stage__scene">
          <div className="zw-stage__glow" aria-hidden />
          <div className="zw-stage__device">
            <PosInterface scene="pos" />
          </div>
          <span className="zw-stage__tag zw-stage__tag--a" aria-hidden>
            Online · Offline
          </span>
          <span className="zw-stage__tag zw-stage__tag--b" aria-hidden>
            USD / LBP
          </span>
          <span className="zw-stage__tag zw-stage__tag--c" aria-hidden>
            Customer credit
          </span>
          <span className="zw-stage__tag zw-stage__tag--d" aria-hidden>
            Live stock
          </span>
        </div>
      </div>
    </section>
  );
}
