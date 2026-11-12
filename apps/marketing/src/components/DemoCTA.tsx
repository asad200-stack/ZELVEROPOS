import { Link } from 'react-router';
import { track } from '../analytics';
import { CTAS, DEMO_LIVE } from '../content/ctas';
import { playSound } from '../sound/engine';
import { GlassCard } from './GlassCard';

export function DemoCTA() {
  return (
    <GlassCard className="zw-demo-cta">
      <p className="zw-eyebrow">Interactive Demo</p>
      <h2>{DEMO_LIVE ? 'Explore the live ZELVERO demo' : 'Interactive demo access is coming soon.'}</h2>
      <p className="zw-lead">
        {DEMO_LIVE
          ? 'Open the isolated demo environment — it never uses a real production business.'
          : 'Preview ZELVERO now or request a guided demo.'}
      </p>
      <div className="zw-hero__cta">
        <Link
          className="zw-btn zw-btn--primary"
          to={CTAS.preview.to}
          onClick={() => {
            playSound('primary');
            track('demo_open');
          }}
        >
          {CTAS.preview.label}
        </Link>
        <Link className="zw-btn zw-btn--secondary" to={CTAS.sales.to}>
          Request a Demo
        </Link>
      </div>
    </GlassCard>
  );
}
