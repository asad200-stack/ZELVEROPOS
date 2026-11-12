import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { Words } from './Words';

interface Props {
  id?: string;
  eyebrow?: string;
  title?: string;
  lead?: string;
  children?: ReactNode;
  className?: string;
}

export function Section({ id, eyebrow, title, lead, children, className = '' }: Props) {
  const ref = useRef<HTMLElement>(null);
  const reduced = usePrefersReducedMotion();
  const [seen, setSeen] = useState(reduced);
  useEffect(() => {
    if (reduced) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setSeen(true);
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);
  return (
    <section id={id} ref={ref} className={`zw-section ${seen ? 'is-in' : ''} ${className}`}>
      <div className="zw-wrap">
        {(eyebrow || title || lead) && (
          <header className="zw-section__head">
            {eyebrow ? <p className="zw-eyebrow">{eyebrow}</p> : null}
            {title ? (
              <h2>
                <Words text={title} />
              </h2>
            ) : null}
            {lead ? <p className="zw-lead">{lead}</p> : null}
          </header>
        )}
        {children}
      </div>
    </section>
  );
}
