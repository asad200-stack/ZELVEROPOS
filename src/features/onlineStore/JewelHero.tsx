import { useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import type { PublicProduct } from '@/domain/onlineStore';

interface Props {
  title: string;
  subtitle: string;
  cta: string;
  items: PublicProduct[];
  price: (p: PublicProduct) => string;
  onOpen: (id: string) => void;
  onCta: () => void;
  hint: string;
  touchHint: string;
  eyebrow?: ReactNode;
  secondary?: ReactNode;
}

/** Display order on the tray: the first pick in the middle, the next ones alternating outward. */
function trayOrder<T>(list: T[]): T[] {
  const out: T[] = [];
  list.forEach((item, i) => (i % 2 === 1 ? out.unshift(item) : out.push(item)));
  return out;
}

/**
 * Vitrine theme hero (jewellery, watches): pieces rest on cushions in a dark velvet case. A small
 * spotlight follows the pointer and makes whatever is under it sparkle; without a mouse the light
 * drifts slowly across the case by itself. The piece under the light is named below the case.
 */
export default function JewelHero({ title, subtitle, cta, items, price, onOpen, onCta, hint, touchHint, eyebrow, secondary }: Props) {
  const pieces = items.slice(0, 5);
  const [lit, setLit] = useState(0);
  const caseRef = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const shown = pieces[Math.min(lit, pieces.length - 1)];

  const follow = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return;
    const el = caseRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      el.style.setProperty('--mx', `${x.toFixed(0)}px`);
      el.style.setProperty('--my', `${y.toFixed(0)}px`);
      el.classList.add('is-following');
    });
  };
  const leave = () => {
    cancelAnimationFrame(frame.current);
    caseRef.current?.classList.remove('is-following');
  };

  return (
    <section className="jw-hero">
      <div className="sf-wrap jw-inner">
        <div className="jw-copy">
          {eyebrow ? <div className="jw-eyebrow">{eyebrow}</div> : null}
          <h1 className="jw-title">{title}</h1>
          <p className="jw-sub">{subtitle}</p>
          <div className="jw-actions">
            <button type="button" className="jw-cta" onClick={onCta}>
              {cta}
            </button>
            {secondary}
          </div>
        </div>

        {pieces.length > 0 && (
          <>
            <div className="jw-case" ref={caseRef} onPointerMove={follow} onPointerLeave={leave} style={{ '--n': String(pieces.length) } as CSSProperties}>
              {trayOrder(pieces.map((p, i) => ({ p, i }))).map(({ p, i }) => (
                <button
                  key={p.id}
                  type="button"
                  className={i === 0 ? 'jw-piece is-main' : i >= 3 ? 'jw-piece is-far' : 'jw-piece'}
                  onPointerEnter={() => setLit(i)}
                  onFocus={() => setLit(i)}
                  onClick={() => onOpen(p.id)}
                  aria-label={`${p.name}, ${price(p)}`}
                >
                  <span className="jw-cushion" aria-hidden="true" />
                  <span className={p.cutoutUrl ? 'jw-gem is-cutout' : 'jw-gem'}>
                    <img src={p.cutoutUrl ?? p.imageUrl ?? ''} alt="" decoding="async" loading={i === 0 ? 'eager' : 'lazy'} />
                  </span>
                  <span className="jw-glint" aria-hidden="true" style={{ '--d': `${(i * 0.7).toFixed(1)}s` } as CSSProperties} />
                </button>
              ))}
              <span className="jw-dark" aria-hidden="true" />
              <span className="jw-glass" aria-hidden="true" />
            </div>
            {shown && (
              <p className="jw-label" aria-live="polite">
                <b>{shown.name}</b>
                <span>{price(shown)}</span>
              </p>
            )}
            <p className="jw-hint">
              <span className="jw-hint-mouse">{hint}</span>
              <span className="jw-hint-touch">{touchHint}</span>
            </p>
          </>
        )}
      </div>
    </section>
  );
}
