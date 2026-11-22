import type { CSSProperties, ReactNode } from 'react';
import type { PublicProduct } from '@/domain/onlineStore';

interface Props {
  title: string;
  subtitle: string;
  cta: string;
  items: PublicProduct[];
  price: (p: PublicProduct) => string;
  hint: string;
  touchHint: string;
  onOpen: (id: string) => void;
  onCta: () => void;
  eyebrow?: ReactNode;
  secondary?: ReactNode;
}

function Hanger() {
  return (
    <svg className="at-hanger" viewBox="0 0 120 60" aria-hidden="true">
      <path d="M60 4c-6 0-9 4-9 8 0 5 4 7 9 9v6" fill="none" />
      <path d="M60 27 6 52c-4 2-3 6 2 6h104c5 0 6-4 2-6Z" fill="none" />
    </svg>
  );
}

/**
 * Atelier theme hero: the owner's chosen pieces hang on a clothes rail. Each piece sways a
 * little, turns in 3D on hover and opens the quick view on click. Cut-out photos (background
 * removed) hang freely; ordinary photos hang as small framed prints.
 */
export default function AtelierRail({ title, subtitle, cta, items, price, hint, touchHint, onOpen, onCta, eyebrow, secondary }: Props) {
  return (
    <section className="at-hero">
      <div className="sf-wrap at-hero-copy">
        {eyebrow ? <div className="at-eyebrow">{eyebrow}</div> : null}
        <h1 className="at-title">{title}</h1>
        <p className="at-sub">{subtitle}</p>
        <div className="at-actions">
          <button type="button" className="at-cta" onClick={onCta}>
            {cta}
          </button>
          {secondary}
        </div>
      </div>
      {items.length > 0 && (
        <div className="at-rail-wrap">
          <div className="at-rail" style={{ '--n': String(items.length) } as CSSProperties}>
            <span className="at-rod" aria-hidden="true" />
            {items.map((p, i) => (
              <button
                key={p.id}
                type="button"
                className={p.cutoutUrl ? 'at-hang is-cutout' : 'at-hang'}
                style={{ '--i': String(i) } as CSSProperties}
                onClick={() => onOpen(p.id)}
                aria-label={`${p.name}, ${price(p)}`}
              >
                <Hanger />
                <span className="at-piece">
                  <img src={p.cutoutUrl ?? p.imageUrl ?? ''} alt="" decoding="async" loading={i < 5 ? 'eager' : 'lazy'} />
                </span>
                <span className="at-tag" aria-hidden="true">
                  {p.name}, {price(p)}
                </span>
              </button>
            ))}
          </div>
          <p className="at-hint" aria-hidden="true">
            <span className="at-hint-mouse">{hint}</span>
            <span className="at-hint-touch">{touchHint}</span>
          </p>
        </div>
      )}
    </section>
  );
}
