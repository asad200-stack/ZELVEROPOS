import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import type { PublicProduct } from '@/domain/onlineStore';
import type { TranslationKey, TParams } from '@/i18n/i18n';
import { lookCategories, swatchOf, wrap, type Look } from './roomLooks';
import { APPAREL_SIZES, SHOE_SIZES, fitKind } from './sizeAdvisor';

type T = (key: TranslationKey, params?: TParams) => string;

interface Props {
  storeName: string;
  looks: Look[];
  t: T;
  priceOf: (p: PublicProduct) => string;
  sizeOf: (id: string) => string;
  onSize: (id: string, size: string) => void;
  /** Adds the piece to the bag; `from` is where the fly-to-bag animation starts. */
  onAdd: (p: PublicProduct, from: Element | null) => void;
  /** Opens the piece's full page (for pieces with several options to choose). */
  onOpen: (id: string) => void;
  bagIcon: ReactNode;
}

/** How long the model takes to change (the light line sweeping down). */
const CHANGE_MS = 950;
/** With more pieces than this, a button opens all of them at once to jump straight to one. */
const BROWSE_FROM = 4;

/**
 * The store's fitting room: one model in a lit room, the store's name behind them, and the
 * pieces on both sides. Each tap or swipe changes the outfit with a line of light sweeping down
 * the model. Pieces are added to the bag from here, with their size and colour.
 */
export default function FittingRoom({ storeName, looks, t, priceOf, sizeOf, onSize, onAdd, onOpen, bagIcon }: Props) {
  const [cat, setCat] = useState('');
  const [at, setAt] = useState(0);
  const [pick, setPick] = useState<Record<string, number>>({});
  const [leaving, setLeaving] = useState<{ url: string; n: number } | null>(null);
  const [n, setN] = useState(0);
  const [nudge, setNudge] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const stage = useRef<HTMLDivElement | null>(null);

  const cats = lookCategories(looks, 8);
  const list = cat ? looks.filter((l) => l.variants[0]?.category.trim() === cat) : looks;
  const i = wrap(at, list.length);
  const look = list[i];
  const v = look ? Math.min(pick[look.key] ?? 0, look.variants.length - 1) : 0;
  const p = look?.variants[v];
  const prev = list[wrap(i - 1, list.length)];
  const next = list[wrap(i + 1, list.length)];

  // The photos next in line are fetched ahead so the change is instant.
  useEffect(() => {
    for (const l of [prev, next]) {
      const u = l?.variants[0]?.lookUrl;
      if (u) new Image().src = u;
    }
  }, [prev, next]);

  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => setLeaving(null), CHANGE_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  if (!look || !p || !p.lookUrl) return null;

  /** Starts the outfit change; the current photo stays under the new one until the light passes. */
  const change = (apply: () => void) => {
    setLeaving({ url: p.lookUrl ?? '', n: n + 1 });
    setN((k) => k + 1);
    setNudge(false);
    apply();
  };
  const go = (step: number) => change(() => setAt(i + step));
  const jump = (k: number) => {
    setBrowsing(false);
    if (k !== i) change(() => setAt(k));
  };
  const choose = (c: string) => {
    if (c === cat) return;
    change(() => {
      setCat(c);
      setAt(0);
    });
  };
  const pickVariant = (k: number) => {
    if (k === v) return;
    change(() => setPick((m) => ({ ...m, [look.key]: k })));
  };

  const down = (e: PointerEvent<HTMLDivElement>) => {
    swipe.current = { x: e.clientX, y: e.clientY };
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(e.clientY - s.y) * 1.4) {
      // Swiping left shows the next piece, in either reading direction (like a photo gallery).
      const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
      go((dx < 0) !== rtl ? 1 : -1);
    }
  };

  const kind = p.groupId ? null : fitKind(p);
  const sizes: readonly string[] = kind === 'shoes' ? SHOE_SIZES : kind === 'apparel' ? APPAREL_SIZES.filter((s) => s !== 'XS' && s !== '3XL') : [];
  const size = sizeOf(p.id);
  const buy = () => {
    if (p.groupId) {
      // Sizes of a set are separate products: its own page lets the shopper choose.
      onOpen(p.id);
      return;
    }
    if (sizes.length > 0 && !size) {
      setNudge(true);
      return;
    }
    onAdd(p, stage.current?.querySelector('.fr-model.is-new') ?? stage.current);
  };

  const side = (l: Look | undefined, step: number, cls: string) => {
    const q = l?.variants[0];
    if (!l || !q || list.length < 2 || (step === -1 && list.length === 2)) return null;
    return (
      <button type="button" className={`fr-card ${cls}`} onClick={() => go(step)} aria-label={t('storefront.room.show', { name: q.name })}>
        <span className="fr-card-img">{q.imageUrl ? <img src={q.imageUrl} alt="" loading="lazy" decoding="async" /> : null}</span>
        <span className="fr-card-name" dir="auto">{q.name}</span>
      </button>
    );
  };

  return (
    <section className="fr" aria-label={t('storefront.room.title')}>
      {cats.length > 1 && (
        <div className="fr-chips" role="tablist" aria-label={t('storefront.room.filter')}>
          {['', ...cats].map((c) => (
            <button key={c || 'all'} type="button" role="tab" aria-selected={c === cat} onClick={() => choose(c)}>
              {c || t('storefront.room.all')}
            </button>
          ))}
        </div>
      )}

      <div className="fr-stage" ref={stage} onPointerDown={down} onPointerUp={up} onPointerCancel={() => (swipe.current = null)}>
        <span className="fr-room" aria-hidden="true">
          <span className="fr-arch fr-arch-l" />
          <span className="fr-arch fr-arch-c" />
          <span className="fr-arch fr-arch-r" />
          <span className="fr-floor" />
        </span>
        <span className="fr-word" aria-hidden="true" style={{ '--len': String(Math.max(4, [...storeName].length)) } as CSSProperties}>
          {storeName}
        </span>
        <span className="fr-shadow" aria-hidden="true" />
        {leaving && <img key={`old-${leaving.n}`} className="fr-model is-old" src={leaving.url} alt="" draggable={false} />}
        <img
          key={`new-${n}`}
          className={leaving ? 'fr-model is-new is-changing' : 'fr-model is-new'}
          src={p.lookUrl}
          alt={t('storefront.room.wearing', { name: p.name })}
          draggable={false}
          decoding="async"
        />
        {leaving && <span key={`scan-${n}`} className="fr-scan" aria-hidden="true" />}
        {side(prev, -1, 'fr-card-prev')}
        {side(next, 1, 'fr-card-next')}
        {list.length > 1 && (
          <>
            <button type="button" className="fr-arrow fr-arrow-prev" onClick={() => go(-1)} aria-label={t('storefront.room.prev')}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15 5l-7 7 7 7" />
              </svg>
            </button>
            <button type="button" className="fr-arrow fr-arrow-next" onClick={() => go(1)} aria-label={t('storefront.room.next')}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </>
        )}
        {list.length > BROWSE_FROM ? (
          <button type="button" className="fr-browse" onClick={() => setBrowsing(true)} aria-haspopup="dialog">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="4" y="4" width="6" height="6" rx="1.5" />
              <rect x="14" y="4" width="6" height="6" rx="1.5" />
              <rect x="4" y="14" width="6" height="6" rx="1.5" />
              <rect x="14" y="14" width="6" height="6" rx="1.5" />
            </svg>
            <span aria-live="polite">
              {i + 1} / {list.length}
            </span>
          </button>
        ) : (
          <span className="sf-sr" aria-live="polite">
            {i + 1} / {list.length}
          </span>
        )}
        {browsing && (
          <div className="fr-grid" role="dialog" aria-label={t('storefront.room.browse')}>
            <div className="fr-grid-head">
              <b>{t('storefront.room.browse')}</b>
              <button type="button" className="fr-grid-close" onClick={() => setBrowsing(false)} aria-label={t('storefront.room.close')}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <ul className="fr-grid-list">
              {list.map((l, k) => {
                const q = l.variants[0];
                if (!q) return null;
                return (
                  <li key={l.key}>
                    <button type="button" aria-current={k === i ? 'true' : undefined} onClick={() => jump(k)}>
                      <span className="fr-grid-img">
                        <img src={q.lookUrl ?? q.imageUrl ?? ''} alt="" loading="lazy" decoding="async" />
                      </span>
                      <span className="fr-grid-name" dir="auto">
                        {q.groupId ? q.groupName || q.name : q.name}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      <div className="fr-bar">
        <div className="fr-item">
          <span className="fr-thumb">{p.imageUrl ? <img src={p.imageUrl} alt="" /> : null}</span>
          <button type="button" className="fr-item-text" onClick={() => onOpen(p.id)}>
            <b dir="auto">{p.groupId ? p.groupName || p.name : p.name}</b>
            <span>{priceOf(p)}</span>
          </button>
          <button type="button" className="fr-add" onClick={buy}>
            {bagIcon}
            {p.groupId ? t('storefront.room.choose') : t('storefront.room.add')}
          </button>
        </div>
        {(sizes.length > 0 || look.variants.length > 1) && (
          <div className="fr-opts">
            {sizes.length > 0 && (
              <div className={nudge ? 'fr-sizes is-nudge' : 'fr-sizes'} role="radiogroup" aria-label={t('storefront.size')}>
                {sizes.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={size === s}
                    onClick={() => {
                      onSize(p.id, s);
                      setNudge(false);
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {nudge && <span className="fr-need">{t('storefront.chooseSize')}</span>}
            {look.variants.length > 1 && (
              <div className="fr-swatches" role="radiogroup" aria-label={t('storefront.room.colour')}>
                {look.variants.map((x, k) => {
                  const label = x.options.map((o) => o.value).join(' / ') || x.name;
                  const colour = x.options.map((o) => swatchOf(o.value)).find((c) => c !== null) ?? null;
                  return (
                    <button
                      key={x.id}
                      type="button"
                      role="radio"
                      aria-checked={k === v}
                      aria-label={label}
                      title={label}
                      onClick={() => pickVariant(k)}
                      style={colour ? { background: colour } : undefined}
                    >
                      {!colour && x.imageUrl ? <img src={x.imageUrl} alt="" /> : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
