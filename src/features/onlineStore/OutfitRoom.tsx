import { useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import type { PublicProduct } from '@/domain/onlineStore';
import type { TranslationKey, TParams } from '@/i18n/i18n';
import OutfitModel from './OutfitModel';
import { wrap, type Look } from './roomLooks';
import { APPAREL_SIZES, SHOE_SIZES, fitKind } from './sizeAdvisor';

type T = (key: TranslationKey, params?: TParams) => string;

interface Props {
  storeName: string;
  tops: Look[];
  bottoms: Look[];
  t: T;
  priceOf: (p: PublicProduct) => string;
  sizeOf: (id: string) => string;
  onSize: (id: string, size: string) => void;
  onAdd: (p: PublicProduct, from: Element | null) => void;
  onOpen: (id: string) => void;
  bagIcon: ReactNode;
  /** Back to one piece at a time. */
  onExit: () => void;
}

const sizesFor = (p: PublicProduct): readonly string[] => {
  if (p.groupId) return [];
  const kind = fitKind(p);
  return kind === 'shoes' ? SHOE_SIZES : kind === 'apparel' ? APPAREL_SIZES.filter((s) => s !== 'XS' && s !== '3XL') : [];
};

/**
 * Fitting room, outfit mode: the shopper picks a top and a bottom and sees the model wearing both
 * (OutfitModel joins the two photos at the top's hem). Each piece goes to the bag with its size.
 */
export default function OutfitRoom({ storeName, tops, bottoms, t, priceOf, sizeOf, onSize, onAdd, onOpen, bagIcon, onExit }: Props) {
  const [ti, setTi] = useState(0);
  const [bi, setBi] = useState(0);
  const [nudge, setNudge] = useState<string | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const stage = useRef<HTMLDivElement | null>(null);
  const top = tops[wrap(ti, tops.length)]?.variants[0];
  const bottom = bottoms[wrap(bi, bottoms.length)]?.variants[0];
  if (!top?.lookUrl || !bottom?.lookUrl) return null;

  const down = (e: PointerEvent<HTMLDivElement>) => {
    swipe.current = { x: e.clientX, y: e.clientY };
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
    const step = (dx < 0) !== rtl ? 1 : -1;
    // Swipe on the upper half changes the top, on the lower half the bottom.
    const box = e.currentTarget.getBoundingClientRect();
    const upper = s.y - box.top < box.height * ((top.lookHem || 54) / 100);
    if (upper) setTi((i) => wrap(i + step, tops.length));
    else setBi((i) => wrap(i + step, bottoms.length));
  };

  const buy = (p: PublicProduct) => {
    if (p.groupId) {
      onOpen(p.id);
      return;
    }
    if (sizesFor(p).length > 0 && !sizeOf(p.id)) {
      setNudge(p.id);
      return;
    }
    setNudge(null);
    onAdd(p, stage.current?.querySelector('.fr-model') ?? stage.current);
  };

  const strip = (label: string, list: Look[], at: number, pickAt: (i: number) => void) => (
    <div className="fr-pick">
      <span className="fr-pick-label">{label}</span>
      <div className="fr-strip" role="radiogroup" aria-label={label}>
        {list.map((l, k) => {
          const q = l.variants[0];
          if (!q) return null;
          return (
            <button key={l.key} type="button" role="radio" aria-checked={k === wrap(at, list.length)} aria-label={q.name} title={q.name} onClick={() => pickAt(k)}>
              <img src={q.lookUrl ?? q.imageUrl ?? ''} alt="" loading="lazy" decoding="async" />
            </button>
          );
        })}
      </div>
    </div>
  );

  const piece = (p: PublicProduct) => {
    const sizes = sizesFor(p);
    const size = sizeOf(p.id);
    return (
      <div key={p.id} className="fr-piece">
        <div className="fr-item">
          <span className="fr-thumb">{p.imageUrl ? <img src={p.imageUrl} alt="" /> : null}</span>
          <button type="button" className="fr-item-text" onClick={() => onOpen(p.id)}>
            <b dir="auto">{p.groupId ? p.groupName || p.name : p.name}</b>
            <span>{priceOf(p)}</span>
          </button>
          <button type="button" className="fr-add" onClick={() => buy(p)}>
            {bagIcon}
            {p.groupId ? t('storefront.room.choose') : t('storefront.room.add')}
          </button>
        </div>
        {sizes.length > 0 && (
          <div className="fr-opts">
            <div className={nudge === p.id ? 'fr-sizes is-nudge' : 'fr-sizes'} role="radiogroup" aria-label={t('storefront.size')}>
              {sizes.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={size === s}
                  onClick={() => {
                    onSize(p.id, s);
                    if (nudge === p.id) setNudge(null);
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
            {nudge === p.id && <span className="fr-need">{t('storefront.chooseSize')}</span>}
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="fr fr-is-outfit" aria-label={t('storefront.room.outfit')}>
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
        <OutfitModel
          key={`${top.id}+${bottom.id}`}
          className="fr-model fr-outfit-in"
          topUrl={top.lookUrl}
          bottomUrl={bottom.lookUrl}
          hem={top.lookHem || 54}
          alt={t('storefront.room.wearingBoth', { top: top.name, bottom: bottom.name })}
        />
        <button type="button" className="fr-mode is-on" onClick={onExit}>
          {t('storefront.room.onePiece')}
        </button>
      </div>
      <div className="fr-bar">
        {strip(t('storefront.room.top'), tops, ti, setTi)}
        {strip(t('storefront.room.bottom'), bottoms, bi, setBi)}
        {piece(top)}
        {piece(bottom)}
      </div>
    </section>
  );
}
