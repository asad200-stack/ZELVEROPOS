import type { Feature } from '../content/features';
import { GlassCard } from './GlassCard';

export function FeatureCard({ feature }: { feature: Feature }) {
  return (
    <GlassCard className="zw-feature-card" tilt>
      <h3>{feature.name}</h3>
      <p>{feature.summary}</p>
    </GlassCard>
  );
}
