import { lazy, Suspense } from 'react';
import { Link } from 'react-router';
import { track } from '../analytics';
import { CTAS } from '../content/ctas';
import { haptic } from '../haptics';
import { playSound } from '../sound/engine';
import { Words } from './Words';

const HeroScene = lazy(() => import('../scenes/HeroScene'));

export function Hero() {
  return (
    <section className="zw-hero" id="top">
      <div className="zw-hero__3d">
        <Suspense fallback={null}>
          <HeroScene />
        </Suspense>
      </div>
      <div className="zw-wrap zw-hero__grid">
        <div className="zw-hero__copy">
          <p className="zw-eyebrow zw-rise" style={{ ['--d' as string]: 0 }}>
            ZELVERO · The operating system for modern business
          </p>
          <h1>
            <Words text="Run Your Entire Business." />
            <span className="zw-hero__line2">
              <Words text="From One System." offset={4} className="zw-grad" />
            </span>
          </h1>
          <p className="zw-lead zw-rise" style={{ ['--d' as string]: 6 }}>
            POS, inventory, customers, suppliers, credit, reporting and offline selling — all connected in ZELVERO.
          </p>
          <div className="zw-hero__cta zw-rise" style={{ ['--d' as string]: 7 }}>
            <Link
              className="zw-btn zw-btn--primary zw-btn--lg"
              data-magnetic
              to={CTAS.trialLong.to}
              viewTransition
              onClick={() => {
                playSound('primary');
                haptic(16);
                track('hero_trial_click');
              }}
            >
              <span>{CTAS.trialLong.label}</span>
            </Link>
            <Link className="zw-btn zw-btn--secondary zw-btn--lg" data-magnetic to={CTAS.demo.to} viewTransition onClick={() => playSound('nav')}>
              <span>{CTAS.demo.label}</span>
            </Link>
            <Link className="zw-btn zw-btn--ghost" to={CTAS.quote.to} viewTransition>
              {CTAS.quote.label} →
            </Link>
          </div>
          <p className="zw-note zw-rise" style={{ ['--d' as string]: 8 }}>
            No credit card required.
          </p>
        </div>
      </div>
      <a className="zw-hero__scroll zw-rise" style={{ ['--d' as string]: 9 }} href="#stage" aria-label="Scroll to the product">
        <span />
      </a>
    </section>
  );
}
