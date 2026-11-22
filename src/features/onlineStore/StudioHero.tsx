import { useEffect, useState, type ReactNode } from 'react';
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
  pauseLabel: string;
  playLabel: string;
  eyebrow?: ReactNode;
  secondary?: ReactNode;
}

const ADVANCE_MS = 5200;

/**
 * Studio theme hero (shoes, sneakers, bags): one piece at a time stands on a turning pedestal,
 * floating above its shadow. The visitor switches pieces from the strip below; the stage also
 * moves on by itself every few seconds unless the pointer is over it or motion is reduced.
 */
export default function StudioHero({ title, subtitle, cta, items, price, onOpen, onCta, pickLabel, pauseLabel, playLabel, eyebrow, secondary }: Props) {
  const [active, setActive] = useState(0);
  const [hold, setHold] = useState(false);
  // Visitors can stop the automatic change for good (touch screens have no hover to pause it).
  const [paused, setPaused] = useState(false);
  const count = items.length;

  useEffect(() => {
    if (count < 2 || hold || paused || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const id = window.setInterval(() => setActive((i) => (i + 1) % count), ADVANCE_MS);
    return () => window.clearInterval(id);
  }, [count, hold, paused]);

  const current = items[Math.min(active, count - 1)];

  return (
    <section className="st-hero">
      <div className="sf-wrap st-grid">
        <div className="st-copy">
          {eyebrow ? <div className="st-eyebrow">{eyebrow}</div> : null}
          <h1 className="st-title">{title}</h1>
          <p className="st-sub">{subtitle}</p>
          <div className="st-actions">
            <button type="button" className="st-cta" onClick={onCta}>
              {cta}
            </button>
            {secondary}
          </div>
        </div>

        {current && (
          <div className="st-stage" onPointerEnter={() => setHold(true)} onPointerLeave={() => setHold(false)}>
            <p className="st-name-bg" aria-hidden="true" key={`bg-${current.id}`}>
              {current.name}
            </p>
            <button type="button" className="st-show" key={current.id} onClick={() => onOpen(current.id)} aria-label={`${current.name}, ${price(current)}`}>
              <span className={current.cutoutUrl ? 'st-piece is-cutout' : 'st-piece'}>
                <img src={current.cutoutUrl ?? current.imageUrl ?? ''} alt="" decoding="async" fetchPriority="high" />
              </span>
              <span className="st-shadow" aria-hidden="true" />
            </button>
            <span className="st-pedestal" aria-hidden="true">
              <span className="st-pedestal-top" />
            </span>
            <p className="st-label" aria-live="polite">
              <b>{current.name}</b>
              <span>{price(current)}</span>
            </p>
          </div>
        )}
      </div>

      {count > 1 && (
        <div className="sf-wrap st-strip" role="group">
          <button
            type="button"
            className="st-play"
            aria-pressed={paused}
            aria-label={paused ? playLabel : pauseLabel}
            title={paused ? playLabel : pauseLabel}
            onClick={() => setPaused((v) => !v)}
          >
            {paused ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 5v14l11-7Z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
              </svg>
            )}
          </button>
          {items.map((p, i) => (
            <button
              key={p.id}
              type="button"
              className="st-thumb"
              aria-pressed={i === active}
              aria-label={pickLabel(p.name)}
              onClick={() => {
                setActive(i);
                setPaused(true);
              }}
            >
              <img src={p.cutoutUrl ?? p.imageUrl ?? ''} alt="" loading="lazy" decoding="async" />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
