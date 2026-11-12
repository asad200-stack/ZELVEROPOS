import { lazy, Suspense, useEffect, useId, useRef } from 'react';
import { WHY_ZELVERO } from '../content/why';
import { useInView } from '../hooks/useInView';
import { setIconGrid, useScene3dMode } from '../scenes/icons3d';
import type { IconPointer } from '../scenes/IndustryIcons';
import { GlassCard } from './GlassCard';
import { Section } from './Section';

const Mark3D = lazy(() => import('../scenes/WhyIcons').then((m) => ({ default: m.WhyMark3D })));

export function WhyZelvero() {
  const use3d = useScene3dMode() !== 'off';
  const ref = useRef<HTMLDivElement>(null);
  const near = useInView(ref, '240px');
  const gridId = useId();
  useEffect(() => {
    if (!use3d) return;
    setIconGrid(gridId, near);
  }, [gridId, near, use3d]);
  useEffect(() => () => setIconGrid(gridId, null), [gridId]);

  return (
    <Section id="why" title="Why businesses choose ZELVERO">
      <div ref={ref} className="zw-cards zw-why">
        {WHY_ZELVERO.map((item, index) => (
          <WhyCard key={item.id} item={item} index={index} use3d={use3d} />
        ))}
      </div>
    </Section>
  );
}

function WhyCard({ item, index, use3d }: { item: (typeof WHY_ZELVERO)[number]; index: number; use3d: boolean }) {
  const pointer = useRef<IconPointer>({ x: 0, y: 0, hover: false });
  return (
    <div
      className="zw-why-hit"
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        pointer.current.x = (e.clientX - r.left) / r.width - 0.5;
        pointer.current.y = (e.clientY - r.top) / r.height - 0.5;
        pointer.current.hover = e.pointerType === 'mouse';
      }}
      onPointerLeave={() => {
        pointer.current.hover = false;
      }}
    >
      <GlassCard className={`zw-feature-card zw-why-card zw-why-card--${item.id}${use3d ? ' is-3d' : ''}`} tilt>
        {use3d ? (
          <Suspense fallback={<span className="zw-why__3d" aria-hidden />}>
            <Mark3D id={item.id} index={index} pointer={pointer} />
          </Suspense>
        ) : (
          <span className="zw-why__icon" aria-hidden>
            {item.icon}
          </span>
        )}
        <p className="zw-eyebrow">{item.title}</p>
        <p>{item.body}</p>
      </GlassCard>
    </div>
  );
}
