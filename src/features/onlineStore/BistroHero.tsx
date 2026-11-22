import type { CSSProperties, ReactNode } from 'react';
import type { PublicProduct } from '@/domain/onlineStore';

interface Props {
  title: string;
  subtitle: string;
  cta: string;
  items: PublicProduct[];
  price: (p: PublicProduct) => string;
  onOpen: (id: string) => void;
  onCta: () => void;
  eyebrow?: ReactNode;
  secondary?: ReactNode;
}

/**
 * Bistro theme hero (restaurants, bakeries, sweets): the table seen from above. The main dish
 * turns slowly on its plate in the middle; the other picks sit around it and come forward on
 * hover. Top-down dish photos (ideally cut out) turn naturally because a plate is round.
 */
export default function BistroHero({ title, subtitle, cta, items, price, onOpen, onCta, eyebrow, secondary }: Props) {
  const [main, ...rest] = items;
  const around = rest.slice(0, 6);
  return (
    <section className="bi-hero">
      <div className="sf-wrap bi-grid">
        <div className="bi-copy">
          {eyebrow ? <div className="bi-eyebrow">{eyebrow}</div> : null}
          <h1 className="bi-title">{title}</h1>
          <p className="bi-sub">{subtitle}</p>
          <div className="bi-actions">
            <button type="button" className="bi-cta" onClick={onCta}>
              {cta}
            </button>
            {secondary}
          </div>
        </div>
        {main && (
          <div className="bi-table" style={{ '--n': String(around.length) } as CSSProperties}>
            <span className="bi-cloth" aria-hidden="true" />
            <button type="button" className="bi-plate bi-plate--main" onClick={() => onOpen(main.id)} aria-label={`${main.name}, ${price(main)}`}>
              <span className={main.cutoutUrl ? 'bi-dish is-cutout' : 'bi-dish'}>
                <img src={main.cutoutUrl ?? main.imageUrl ?? ''} alt="" decoding="async" fetchPriority="high" />
              </span>
              <span className="bi-tag" aria-hidden="true">
                {main.name} <b>{price(main)}</b>
              </span>
            </button>
            {around.map((p, i) => (
              <button
                key={p.id}
                type="button"
                className="bi-plate bi-plate--side"
                style={{ '--i': String(i) } as CSSProperties}
                onClick={() => onOpen(p.id)}
                aria-label={`${p.name}, ${price(p)}`}
              >
                <span className={p.cutoutUrl ? 'bi-dish is-cutout' : 'bi-dish'}>
                  <img src={p.cutoutUrl ?? p.imageUrl ?? ''} alt="" loading="lazy" decoding="async" />
                </span>
                <span className="bi-tag" aria-hidden="true">
                  {p.name} <b>{price(p)}</b>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
