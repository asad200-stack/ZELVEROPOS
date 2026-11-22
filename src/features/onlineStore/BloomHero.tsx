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
 * Bloom theme hero (florists, gifts): bouquets stand in tall arched windows of different
 * heights and sway gently, each on its own rhythm, as if in a light breeze. Hovering a window
 * stills its bouquet and lifts it forward. On phones the windows scroll sideways.
 */
export default function BloomHero({ title, subtitle, cta, items, price, onOpen, onCta, eyebrow, secondary }: Props) {
  const arches = items.slice(0, 5);
  return (
    <section className="bl-hero">
      <div className="sf-wrap bl-grid">
        <div className="bl-copy">
          {eyebrow ? <div className="bl-eyebrow">{eyebrow}</div> : null}
          <h1 className="bl-title">{title}</h1>
          <p className="bl-sub">{subtitle}</p>
          <div className="bl-actions">
            <button type="button" className="bl-cta" onClick={onCta}>
              {cta}
            </button>
            {secondary}
          </div>
        </div>
        {arches.length > 0 && (
          <div className="bl-row">
            {arches.map((p, i) => (
              <button
                key={p.id}
                type="button"
                className="bl-arch"
                style={{ '--i': String(i) } as CSSProperties}
                onClick={() => onOpen(p.id)}
                aria-label={`${p.name}, ${price(p)}`}
              >
                <span className="bl-window">
                  <span className={p.cutoutUrl ? 'bl-bouquet is-cutout' : 'bl-bouquet'}>
                    <img src={p.cutoutUrl ?? p.imageUrl ?? ''} alt="" decoding="async" loading={i < 3 ? 'eager' : 'lazy'} />
                  </span>
                </span>
                <span className="bl-tag" aria-hidden="true">
                  <span>{p.name}</span>
                  <b>{price(p)}</b>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
