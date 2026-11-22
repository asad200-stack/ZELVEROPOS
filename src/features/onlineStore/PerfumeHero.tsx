import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

interface Props {
  title: string;
  subtitle: string;
  cta: string;
  imageUrl: string | null;
  /** The image is a cut-out (transparent background): shown whole, standing in the window. */
  cutout?: boolean;
  /** Small line above the title (e.g. "Open now"). */
  eyebrow?: ReactNode;
  onCta: () => void;
  secondary?: ReactNode;
}

/**
 * Perfume theme hero: a pinned scroll story. While the visitor scrolls through it the bottle
 * window turns in 3D, the light sweeps across the glass and the words arrive one after another.
 * Progress is written to a CSS variable (--p, 0..1) on every animation frame, so React never
 * re-renders while scrolling. With reduced motion the section is a plain, still hero.
 */
export default function PerfumeHero({ title, subtitle, cta, imageUrl, cutout = false, eyebrow, onCta, secondary }: Props) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      el.style.setProperty('--p', '0.6');
      el.style.setProperty('--pf-head', `${Math.round(document.querySelector('.sf-top')?.getBoundingClientRect().height ?? 0)}px`);
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      // The sticky stage sits under the sticky shop header, whatever its height on this screen.
      const head = document.querySelector('.sf-top')?.getBoundingClientRect().height ?? 0;
      el.style.setProperty('--pf-head', `${Math.round(head)}px`);
      const r = el.getBoundingClientRect();
      const stage = el.firstElementChild?.getBoundingClientRect().height ?? window.innerHeight;
      // 0 when the stage pins under the header, 1 when the section is about to scroll away.
      const travel = Math.max(1, r.height - stage);
      const p = Math.min(1, Math.max(0, (head - r.top) / travel));
      el.style.setProperty('--p', p.toFixed(4));
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <section ref={ref} className="pf-hero" style={{ '--p': '0' } as CSSProperties}>
      <div className="pf-stage">
        <div className="pf-mist" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="pf-word" aria-hidden="true">
          {title}
        </p>
        <div className="pf-window-wrap" aria-hidden="true">
          <div className={cutout ? 'pf-window is-cutout' : 'pf-window'}>
            {imageUrl ? <img src={imageUrl} alt="" decoding="async" fetchPriority="high" /> : <span className="pf-window-empty" />}
            <span className="pf-glass" />
            <span className="pf-sweep" />
          </div>
          <div className="pf-reflect">{imageUrl ? <img src={imageUrl} alt="" decoding="async" /> : null}</div>
          <span className="pf-plinth" />
        </div>
        <div className="pf-copy">
          {eyebrow ? <div className="pf-eyebrow">{eyebrow}</div> : null}
          <h1 className="pf-title">{title}</h1>
          <p className="pf-sub">{subtitle}</p>
          <div className="pf-actions">
            <button type="button" className="pf-cta" onClick={onCta}>
              {cta}
            </button>
            {secondary}
          </div>
        </div>
        <span className="pf-scroll" aria-hidden="true" />
      </div>
    </section>
  );
}
