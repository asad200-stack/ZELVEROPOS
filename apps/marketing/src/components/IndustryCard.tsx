import { lazy, Suspense, useEffect, useId, useRef } from 'react';
import { Link } from 'react-router';
import { INDUSTRIES, type Industry } from '../content/industries';
import { useInView } from '../hooks/useInView';
import { setIconGrid, useIconLayer, useScene3dMode } from '../scenes/icons3d';
import type { IconPointer } from '../scenes/IndustryIcons';
import { GlassCard } from './GlassCard';

const Mark3D = lazy(() => import('../scenes/IndustryIcons').then((m) => ({ default: m.IndustryMark3D })));
const IconsCanvas = lazy(() => import('../scenes/IndustryIcons').then((m) => ({ default: m.IndustryIconsCanvas })));

const MARK: Record<string, string> = {
  'mobile-electronics': '▣',
  supermarkets: '▦',
  'fashion-retail': '◇',
  wholesale: '▢',
  beauty: '○',
  'general-retail': '▶',
};

export function IndustryCard({ industry, index = 0, use3d = false }: { industry: Industry; index?: number; use3d?: boolean }) {
  const pointer = useRef<IconPointer>({ x: 0, y: 0, hover: false });
  const mark = (
    <span className="zw-industry__mark" aria-hidden>
      {MARK[industry.slug] ?? '◆'}
    </span>
  );
  return (
    <Link
      to={`/industries/${industry.slug}`}
      className="zw-industry-link"
      viewTransition
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        pointer.current.x = (e.clientX - r.left) / r.width - 0.5;
        pointer.current.y = (e.clientY - r.top) / r.height - 0.5;
        pointer.current.hover = e.pointerType === 'mouse';
      }}
      onPointerLeave={() => {
        pointer.current.hover = false;
      }}
      onFocus={() => {
        pointer.current.hover = true;
      }}
      onBlur={() => {
        pointer.current.hover = false;
      }}
    >
      <GlassCard className={`zw-industry-card zw-industry-card--${industry.slug}${use3d ? ' is-3d' : ''}`} tilt>
        {use3d ? (
          <Suspense fallback={<span className="zw-industry__3d" aria-hidden />}>
            <Mark3D slug={industry.slug} index={index} pointer={pointer} />
          </Suspense>
        ) : (
          mark
        )}
        <h3>{industry.name}</h3>
        <p>{industry.summary}</p>
      </GlassCard>
    </Link>
  );
}

export function IndustryGrid() {
  const use3d = useScene3dMode() !== 'off';
  const ref = useRef<HTMLDivElement>(null);
  const near = useInView(ref, '240px');
  const id = useId();
  useEffect(() => {
    if (!use3d) return;
    setIconGrid(id, near);
  }, [id, near, use3d]);
  useEffect(() => () => setIconGrid(id, null), [id]);
  return (
    <div ref={ref} className="zw-cards">
      {INDUSTRIES.map((i, n) => (
        <IndustryCard key={i.slug} industry={i} index={n} use3d={use3d} />
      ))}
    </div>
  );
}

export function IndustryIconLayer() {
  const { mounted, active } = useIconLayer();
  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <IconsCanvas active={active} />
    </Suspense>
  );
}
