import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { discountPercent, type PublicProduct, type StoreLocale } from '@/domain/onlineStore';
import { formatUsd } from '@/utils/format';
import type { TranslationKey, TParams } from '@/i18n/i18n';
import { APPAREL_SIZES, SHOE_SIZES, apparelSize, fitKind, shoeSize, type FitPref } from './sizeAdvisor';
import StorefrontReviews from './StorefrontReviews';
import { axesOf, pickVariant, valueInStock } from '@/domain/variants';

type T = (key: TranslationKey, params?: TParams) => string;

interface Props {
  product: PublicProduct;
  related: PublicProduct[];
  t: T;
  priceOf: (p: PublicProduct) => string;
  qty: number;
  maxQty: number;
  onAdd: () => void;
  onLess: () => void;
  size: string;
  onSize: (size: string) => void;
  wished: boolean;
  onWish: () => void;
  onClose: () => void;
  onPick: (p: PublicProduct) => void;
  slug: string;
  lang: StoreLocale;
  /** Direct link to this product on the store page. */
  shareUrl: string;
  /** Every option of the item when the product comes in sizes/colours, else []. */
  variants?: PublicProduct[];
  /** Switches to another option of the same item. */
  onVariant?: (id: string) => void;
}

const FITS: { id: FitPref; key: TranslationKey }[] = [
  { id: 'snug', key: 'storefront.fitSnug' },
  { id: 'regular', key: 'storefront.fitRegular' },
  { id: 'loose', key: 'storefront.fitLoose' },
];

function Face({ product, src, back }: { product: PublicProduct; src: string | null; back?: boolean }) {
  const cls = back ? 'sf-qv-face sf-qv-back' : 'sf-qv-face';
  return (
    <div className={cls}>
      {src ? (
        <img src={src} alt="" draggable={false} decoding="async" />
      ) : (
        <div className="sf-ph">{product.name.trim().charAt(0).toUpperCase() || '•'}</div>
      )}
    </div>
  );
}

export function HeartIcon({ filled }: { filled: boolean }): ReactNode {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" />
    </svg>
  );
}

/** Native share sheet where the phone has one, otherwise copy the link; plus a WhatsApp shortcut. */
function ShareRow({ t, name, url }: { t: T; name: string; url: string }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const nav = navigator as Navigator & { share?: (d: { title: string; url: string }) => Promise<void> };
    if (typeof nav.share === 'function') {
      await nav.share({ title: name, url }).catch(() => undefined);
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt(t('storefront.share.copy'), url);
    }
  };
  return (
    <div className="sf-share">
      <button type="button" className="sf-share-btn" onClick={() => void share()}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 3v12M7 8l5-5 5 5" />
        </svg>
        {copied ? t('storefront.share.copied') : t('storefront.share.label')}
      </button>
      <a className="sf-share-btn" href={`https://wa.me/?text=${encodeURIComponent(`${name} ${url}`)}`} target="_blank" rel="noopener noreferrer">
        WhatsApp
      </a>
    </div>
  );
}

export default function StorefrontQuickView(props: Props) {
  const { product: p, related, t, priceOf, qty, maxQty, size, wished } = props;
  const variants = props.variants ?? [];
  const grouped = variants.length > 1;
  // Real sizes replace the guessed size list (which only went into the order note).
  const kind = grouped ? null : fitKind(p);
  const axes = grouped ? axesOf(variants) : [];
  const current = p.options.map((o) => o.value);
  // The visitor must tap every option kind once; landing on the first option is not a choice.
  const [touched, setTouched] = useState<number[]>([]);
  const chosen = !grouped || axes.every((_, i) => touched.includes(i));
  const nextAxis = axes.find((_, i) => !touched.includes(i));
  const title = grouped ? p.groupName || p.name : p.name;
  const [angle, setAngle] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [origin, setOrigin] = useState('50% 50%');
  const drag = useRef<{ x: number; a: number; moved: boolean } | null>(null);
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [foot, setFoot] = useState('');
  const [fit, setFit] = useState<FitPref>('regular');
  const [advice, setAdvice] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const [finder, setFinder] = useState(false);
  // Main photo first, then the extra ones; the choice resets when another option is shown.
  const photos = [p.imageUrl, ...(p.images ?? [])].filter((u): u is string => !!u);
  const [photo, setPhoto] = useState({ id: p.id, i: 0 });
  const shown = photo.id === p.id ? Math.min(photo.i, Math.max(0, photos.length - 1)) : 0;
  const src = photos[shown] ?? null;

  const sizes: readonly string[] = kind === 'shoes' ? SHOE_SIZES : APPAREL_SIZES;
  const needsSize = kind !== null;
  const canAdd = p.inStock && chosen && (!needsSize || size !== '');

  function down(e: PointerEvent<HTMLDivElement>) {
    if (zoom) return;
    drag.current = { x: e.clientX, a: angle, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    if (zoom) {
      const r = e.currentTarget.getBoundingClientRect();
      setOrigin(`${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`);
      return;
    }
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 3) d.moved = true;
    setAngle(d.a + dx * 0.6);
  }
  function up() {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) setZoom(true);
  }
  function key(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowLeft') setAngle((a) => a - 30);
    else if (e.key === 'ArrowRight') setAngle((a) => a + 30);
    else if (e.key === 'Enter' || e.key === ' ') setZoom((z) => !z);
    else return;
    e.preventDefault();
  }

  function findSize() {
    const result = kind === 'shoes' ? shoeSize(Number(foot)) : apparelSize(Number(height), Number(weight), fit);
    setBad(result === null);
    setAdvice(result);
  }

  return (
    <>
      <div className="sf-scrim sf-qv-scrim" onClick={props.onClose} />
      <div className="sf-qv" role="dialog" aria-modal="true" aria-labelledby="sf-qv-title">
        <button type="button" className="sf-x sf-qv-x" aria-label={t('storefront.close')} onClick={props.onClose} autoFocus>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>

        <div className="sf-qv-media">
          <div
            className={zoom ? 'sf-qv-stage is-zoom' : 'sf-qv-stage'}
            tabIndex={0}
            role="img"
            aria-label={`${p.name} — ${t('storefront.dragRotate')}`}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={() => (drag.current = null)}
            onClick={() => {
              if (zoom) setZoom(false);
            }}
            onKeyDown={key}
          >
            {zoom ? (
              <div className="sf-qv-zoom" style={{ transformOrigin: origin }}>
                <Face product={p} src={src} />
              </div>
            ) : (
              <div className="sf-qv-spin" style={{ transform: `rotateY(${angle}deg)` }}>
                <Face product={p} src={src} />
                <Face product={p} src={src} back />
              </div>
            )}
          </div>
          {photos.length > 1 && (
            <div className="sf-qv-thumbs" role="group" aria-label={t('storefront.photos')}>
              {photos.map((u, i) => (
                <button
                  key={u}
                  type="button"
                  className={i === shown ? 'is-on' : undefined}
                  aria-pressed={i === shown}
                  aria-label={t('storefront.photoN', { n: i + 1, total: photos.length })}
                  onClick={() => {
                    setPhoto({ id: p.id, i });
                    setAngle(0);
                  }}
                >
                  <img src={u} alt="" loading="lazy" decoding="async" />
                </button>
              ))}
            </div>
          )}
          <div className="sf-qv-tools">
            <span>{t('storefront.dragRotate')}</span>
            <button type="button" className="sf-link" onClick={() => setZoom((z) => !z)}>
              {zoom ? t('storefront.zoomOut') : t('storefront.zoomIn')}
            </button>
          </div>
        </div>

        <div className="sf-qv-info">
          {p.category.trim() && <p className="sf-eyebrow">{p.category}</p>}
          <h2 id="sf-qv-title">{title}</h2>
          <div className="sf-price sf-qv-price">
            {priceOf(p)}
            {p.compareAtUsdCents !== null && <s className="sf-was">{formatUsd(p.compareAtUsdCents)}</s>}
            {discountPercent(p) !== null && <span className="sf-off">−{discountPercent(p)}%</span>}
          </div>
          {p.description && <p className="sf-qv-desc">{p.description}</p>}
          <ShareRow t={t} name={`${title} — ${priceOf(p)}`} url={props.shareUrl} />
          {!p.inStock && (!grouped || chosen) && <p className="sf-msg sf-msg-warn">{t('storefront.outOfStock')}</p>}

          {axes.map((axis, i) => (
            <section key={axis.name} className="sf-qv-size" aria-label={axis.name}>
              <div className="sf-qv-size-head">
                <h3>
                  {axis.name}
                  {touched.includes(i) && current[i] ? <span className="sf-qv-picked">: {current[i]}</span> : null}
                </h3>
              </div>
              <div className="sf-sizes" role="radiogroup" aria-label={axis.name}>
                {axis.values.map((v) => {
                  const ok = valueInStock(variants, current, i, v);
                  return (
                    <button
                      key={v}
                      type="button"
                      role="radio"
                      className={ok ? undefined : 'is-out'}
                      aria-checked={touched.includes(i) && current[i] === v}
                      aria-label={ok ? v : `${v}, ${t('storefront.optionSoldOut')}`}
                      onClick={() => {
                        const next = pickVariant(variants, current, i, v);
                        if (!next) return;
                        setTouched((list) => (list.includes(i) ? list : [...list, i]));
                        if (next.id !== p.id) props.onVariant?.(next.id);
                      }}
                    >
                      {v}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}

          {needsSize && p.inStock && (
            <section className="sf-qv-size" aria-label={t('storefront.size')}>
              <div className="sf-qv-size-head">
                <h3>{t('storefront.chooseSize')}</h3>
                <button type="button" className="sf-link" aria-expanded={finder} onClick={() => setFinder((f) => !f)}>
                  {t('storefront.findSize')}
                </button>
              </div>
              <div className="sf-sizes" role="radiogroup" aria-label={t('storefront.size')}>
                {sizes.map((s) => (
                  <button key={s} type="button" role="radio" aria-checked={s === size} onClick={() => props.onSize(s)}>
                    {s}
                  </button>
                ))}
              </div>
              {finder && (
                <div className="sf-finder">
                  {kind === 'shoes' ? (
                    <label className="sf-field">
                      {t('storefront.footLength')}
                      <input inputMode="decimal" dir="ltr" value={foot} onChange={(e) => setFoot(e.target.value)} />
                      <small>{t('storefront.footHint')}</small>
                    </label>
                  ) : (
                    <>
                      <div className="sf-finder-row">
                        <label className="sf-field">
                          {t('storefront.height')}
                          <input inputMode="numeric" dir="ltr" value={height} onChange={(e) => setHeight(e.target.value)} />
                        </label>
                        <label className="sf-field">
                          {t('storefront.weight')}
                          <input inputMode="numeric" dir="ltr" value={weight} onChange={(e) => setWeight(e.target.value)} />
                        </label>
                      </div>
                      <div className="sf-seg sf-seg-sm" role="radiogroup" aria-label={t('storefront.fit')}>
                        {FITS.map((f) => (
                          <label key={f.id}>
                            <input type="radio" name="sf-fit" checked={fit === f.id} onChange={() => setFit(f.id)} />
                            <span>{t(f.key)}</span>
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                  <button type="button" className="sf-ghost" onClick={findSize}>
                    {t('storefront.findSize')}
                  </button>
                  {bad && (
                    <p className="sf-msg sf-msg-warn" role="alert">
                      {t('storefront.badMeasure')}
                    </p>
                  )}
                  {advice && (
                    <div className="sf-advice" aria-live="polite">
                      <b>{t('storefront.recommended', { size: advice })}</b>
                      <button type="button" className="sf-link" onClick={() => props.onSize(advice)}>
                        {t('storefront.useSize')}
                      </button>
                    </div>
                  )}
                  <small className="sf-muted">{t('storefront.sizeGuideNote')}</small>
                </div>
              )}
            </section>
          )}

          <div className="sf-qv-buy">
            {(p.inStock || !chosen) &&
              (qty === 0 || !chosen ? (
                <button type="button" className="sf-primary" onClick={props.onAdd} disabled={!canAdd}>
                  {nextAxis ? t('storefront.chooseOption', { name: nextAxis.name }) : needsSize && !size ? t('storefront.chooseSize') : t('storefront.add')}
                </button>
              ) : (
                <div className="sf-step">
                  <button type="button" aria-label={t('storefront.less', { name: p.name })} onClick={props.onLess}>
                    −
                  </button>
                  <output aria-live="polite">{qty}</output>
                  <button type="button" aria-label={t('storefront.more', { name: p.name })} onClick={props.onAdd} disabled={qty >= maxQty}>
                    +
                  </button>
                </div>
              ))}
            <button
              type="button"
              className={wished ? 'sf-heart is-on' : 'sf-heart'}
              aria-pressed={wished}
              aria-label={t(wished ? 'storefront.wishRemove' : 'storefront.wishAdd', { name: p.name })}
              onClick={props.onWish}
            >
              <HeartIcon filled={wished} />
            </button>
          </div>

          <StorefrontReviews slug={props.slug} productId={p.id} t={t} lang={props.lang} />

          {related.length > 0 && (
            <section className="sf-related">
              <h3>{t('storefront.related')}</h3>
              <ul>
                {related.map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => props.onPick(r)} aria-label={t('storefront.openProduct', { name: r.name })}>
                      <span className="sf-thumb">
                        {r.imageUrl ? <img src={r.imageUrl} alt="" loading="lazy" /> : <span className="sf-ph">{r.name.charAt(0)}</span>}
                      </span>
                      <span className="sf-related-name">{r.name}</span>
                      <span className="sf-related-price">{priceOf(r)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
