import { memo, useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { Icon } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui/Layout';
import { Spinner } from '@/components/ui/Spinner';
import { tierLbp, tierUsdCents } from '@/domain/pricing';
import { useI18n } from '@/i18n/i18n';
import type { PriceTier, Product } from '@/types/models';
import { formatLbp, formatUsd, normalizeSearch } from '@/utils/format';
import { categoryEdges, detectRtlScrollType, scrollFromStart } from './categoryScroll';
import { FitAmount } from './FitAmount';

interface Props {
  products: Product[];
  loading: boolean;
  categories: string[];
  tier: PriceTier;
  rate: number;
  lowStockThreshold: number;
  searchRef: RefObject<HTMLInputElement | null>;
  onPick: (product: Product) => void;
}

const MAX_RESULTS = 80;

export const ProductPicker = memo(function ProductPicker({
  products,
  loading,
  categories,
  tier,
  rate,
  lowStockThreshold,
  searchRef,
  onPick,
}: Props) {
  const { t, lang } = useI18n();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const deferred = useDeferredValue(search);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ overflow: false, atStart: true, atEnd: true });

  const results = useMemo(() => {
    const q = normalizeSearch(deferred);
    const out: Product[] = [];
    for (const p of products) {
      if (category && p.category !== category) continue;
      if (q && !normalizeSearch(p.name).includes(q) && !p.barcode.includes(deferred.trim())) continue;
      out.push(p);
      if (out.length >= MAX_RESULTS) break;
    }
    return out;
  }, [products, deferred, category]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () => {
      const max = el.scrollWidth - el.clientWidth;
      const rtl = getComputedStyle(el).direction === 'rtl';
      setEdges(categoryEdges(el.scrollLeft, max, rtl, detectRtlScrollType()));
    };
    const onWheel = (event: WheelEvent) => {
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 2 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault();
      const rtl = getComputedStyle(el).direction === 'rtl';
      const type = detectRtlScrollType();
      const pos = scrollFromStart(el.scrollLeft, max, rtl, type) + event.deltaY;
      const next = Math.max(0, Math.min(max, pos));
      el.scrollLeft = rtl && type === 'negative' ? -next : rtl && type === 'reverse' ? max - next : next;
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: false });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      el.removeEventListener('wheel', onWheel);
      observer.disconnect();
    };
  }, [categories.length]);

  const scrollCategories = (direction: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const rtl = getComputedStyle(el).direction === 'rtl';
    const type = detectRtlScrollType();
    const pos = scrollFromStart(el.scrollLeft, max, rtl, type) + direction * Math.max(160, el.clientWidth * 0.7);
    const next = Math.max(0, Math.min(max, pos));
    const left = rtl && type === 'negative' ? -next : rtl && type === 'reverse' ? max - next : next;
    el.scrollTo({ left, behavior: 'smooth' });
  };

  const onCategoryKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const el = scrollerRef.current;
    if (!el) return;
    const buttons = [...el.querySelectorAll<HTMLButtonElement>('.picker__cat')];
    const index = buttons.findIndex((button) => button === document.activeElement);
    if (index < 0) return;
    const rtl = getComputedStyle(el).direction === 'rtl';
    const step = (event.key === 'ArrowRight' ? 1 : -1) * (rtl ? -1 : 1);
    const next = buttons[index + step];
    if (!next) return;
    event.preventDefault();
    next.focus();
  };

  /** Barcode scanners type the code followed by Enter: add the exact match immediately. */
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const code = search.trim();
      if (!code) return;
      const exact = products.find((p) => p.barcode && p.barcode === code);
      const pick = exact ?? (results.length === 1 ? results[0] : null);
      if (pick) {
        onPick(pick);
        setSearch('');
      }
    } else if (e.key === 'Escape') {
      setSearch('');
    }
  };

  return (
    <div className="picker">
      <div className="picker__search">
        <div className="search-box">
          <Icon name="search" size={16} />
          <input
            ref={searchRef}
            className="input"
            type="search"
            value={search}
            placeholder={t('pos.searchPlaceholder')}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={onKeyDown}
            autoComplete="off"
            autoFocus
          />
          <Icon name="barcode" size={16} />
        </div>
      </div>
      <div className="picker__stage">
      {loading ? (
        <div className="page-loader">
          <Spinner size={28} />
        </div>
      ) : results.length === 0 ? (
        <EmptyState icon="search" title={t('pos.noProducts')} />
      ) : (
        <div className="picker__grid">
          {results.map((p) => {
            const out = p.stock <= 0;
            const low = !out && p.stock <= (p.minStock ?? lowStockThreshold);
            return (
              <button key={p.id} type="button" className="product-tile" onClick={() => onPick(p)} disabled={out}>
                {p.imageUrl ? (
                  <img className="product-tile__img" src={p.imageUrl} alt="" loading="lazy" decoding="async" />
                ) : (
                  <span className="product-tile__img product-tile__img--empty">
                    <Icon name="package" size={22} />
                  </span>
                )}
                <span className="product-tile__name">{p.name}</span>
                <span className="product-tile__prices">
                  <FitAmount value={formatUsd(tierUsdCents(p, tier, rate))} />
                  <FitAmount value={formatLbp(tierLbp(p, tier, rate), lang)} className="fit-amount--muted" />
                </span>
                <span className={out ? 'product-tile__stock product-tile__stock--out' : low ? 'product-tile__stock product-tile__stock--low' : 'product-tile__stock'}>
                  {out ? t('products.outOfStock') : t('products.stockCount', { count: p.stock })}
                </span>
              </button>
            );
          })}
        </div>
      )}
      </div>
      {categories.length > 0 && (
        <nav className="picker__cats" aria-label={t('products.category')} onKeyDown={onCategoryKey}>
          <button
            type="button"
            className="picker__arrow"
            hidden={!edges.overflow}
            disabled={lang === 'ar' ? edges.atEnd : edges.atStart}
            aria-label={t(lang === 'ar' ? 'pos.categoriesNext' : 'pos.categoriesPrev')}
            onClick={() => scrollCategories(lang === 'ar' ? 1 : -1)}
          >
            <Icon name="chevronLeft" size={16} />
          </button>
          <div className="picker__scroller" ref={scrollerRef}>
            <button type="button" className={category === '' ? 'picker__cat picker__cat--active' : 'picker__cat'} title={t('common.all')} onClick={() => setCategory('')}>
              <span>{t('common.all')}</span>
            </button>
            {categories.map((c) => (
              <button key={c} type="button" className={category === c ? 'picker__cat picker__cat--active' : 'picker__cat'} title={c} onClick={() => setCategory(c)}>
                <span>{c}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="picker__arrow"
            hidden={!edges.overflow}
            disabled={lang === 'ar' ? edges.atStart : edges.atEnd}
            aria-label={t(lang === 'ar' ? 'pos.categoriesPrev' : 'pos.categoriesNext')}
            onClick={() => scrollCategories(lang === 'ar' ? -1 : 1)}
          >
            <Icon name="chevronRight" size={16} />
          </button>
        </nav>
      )}
    </div>
  );
});
