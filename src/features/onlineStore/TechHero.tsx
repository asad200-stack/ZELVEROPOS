import { useRef, useState, type PointerEvent, type ReactNode } from 'react';
import type { PublicProduct } from '@/domain/onlineStore';

interface Props {
  title: string;
  subtitle: string;
  cta: string;
  items: PublicProduct[];
  price: (p: PublicProduct) => string;
  onOpen: (id: string) => void;
  onCta: () => void;
  pickLabel: (name: string) => string;
  eyebrow?: ReactNode;
  secondary?: ReactNode;
}

/**
 * Lab theme hero (phones, laptops, accessories): one device floats over a lit grid floor and
 * leans toward the pointer as if held in the hand, with the light following it. The visitor
 * switches devices from the dock below. Touch screens get a slow idle float instead.
 */
export default function TechHero({ title, subtitle, cta, items, price, onOpen, onCta, pickLabel, eyebrow, secondary }: Props) {
  const [active, setActive] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const count = items.length;
  const current = items[Math.min(active, count - 1)];

  // Pointer position as -1..1 on both axes, written straight to CSS variables (no re-render).
  const lean = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return;
    const el = stage.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 2 - 1;
    const y = ((e.clientY - r.top) / r.height) * 2 - 1;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      el.style.setProperty('--tx', x.toFixed(3));
      el.style.setProperty('--ty', y.toFixed(3));
      el.classList.add('is-leaning');
    });
  };
  const settle = () => {
    const el = stage.current;
    if (!el) return;
    cancelAnimationFrame(frame.current);
    el.style.setProperty('--tx', '0');
    el.style.setProperty('--ty', '0');
    el.classList.remove('is-leaning');
  };

  return (
    <section className="tc-hero">
      <div className="sf-wrap tc-grid">
        <div className="tc-copy">
          {eyebrow ? <div className="tc-eyebrow">{eyebrow}</div> : null}
          <h1 className="tc-title">{title}</h1>
          <p className="tc-sub">{subtitle}</p>
          <div className="tc-actions">
            <button type="button" className="tc-cta" onClick={onCta}>
              {cta}
            </button>
            {secondary}
          </div>
        </div>

        {current && (
          <div className="tc-stage" ref={stage} onPointerMove={lean} onPointerLeave={settle}>
            <span className="tc-floor" aria-hidden="true" />
            <span className="tc-halo" aria-hidden="true" />
            <button type="button" className="tc-device" key={current.id} onClick={() => onOpen(current.id)} aria-label={`${current.name}, ${price(current)}`}>
              <span className={current.cutoutUrl ? 'tc-tilt is-cutout' : 'tc-tilt'}>
                <img src={current.cutoutUrl ?? current.imageUrl ?? ''} alt="" decoding="async" fetchPriority="high" />
                {!current.cutoutUrl && <span className="tc-sheen" aria-hidden="true" />}
              </span>
            </button>
            <span className="tc-shadow" aria-hidden="true" />
            <p className="tc-label" aria-live="polite">
              <b>{current.name}</b>
              <span>{price(current)}</span>
            </p>
          </div>
        )}
      </div>

      {count > 1 && (
        <div className="sf-wrap tc-dock" role="group">
          {items.map((p, i) => (
            <button key={p.id} type="button" className="tc-thumb" aria-pressed={i === active} aria-label={pickLabel(p.name)} onClick={() => setActive(i)}>
              <img src={p.cutoutUrl ?? p.imageUrl ?? ''} alt="" loading="lazy" decoding="async" />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
