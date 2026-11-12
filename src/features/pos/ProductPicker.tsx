import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Alert, EmptyState } from '@/components/ui/Layout';
import { Spinner } from '@/components/ui/Spinner';
import { catalogLoadProblem, catalogViewMode } from '@/domain/catalogSession';
import { emptyProductQuery } from '@/domain/catalogPlan';
import { tierLbp, tierUsdCents } from '@/domain/pricing';
import { usePagedQuery } from '@/hooks/usePagedQuery';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useI18n } from '@/i18n/i18n';
import { findProductByBarcode, pageProducts } from '@/services/catalogQuery';
import type { PriceTier, Product } from '@/types/models';
import { formatLbp, formatUsd } from '@/utils/format';
import { categoryEdges, detectRtlScrollType, scrollFromStart } from './categoryScroll';
import { ProductTile } from './ProductTile';

interface Props {
  tenantId: string;
  categories: string[];
  tier: PriceTier;
  rate: number;
  lowStockThreshold: number;
  searchRef: RefObject<HTMLInputElement | null>;
  onPick: (product: Product) => void;
  /**
   * Bumped after an online checkout so the one-shot page re-reads stock from Firestore.
   * Kept out of search/category so a refresh does not clear the cashier's filters or cart.
   */
  catalogRevision?: number;
}

export const ProductPicker = memo(function ProductPicker({
  tenantId,
  categories,
  tier,
  rate,
  lowStockThreshold,
  searchRef,
  onPick,
  catalogRevision = 0,
}: Props) {
  const { t, lang } = useI18n();
  const online = useOnlineStatus();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const deferred = useDeferredValue(search);
  const spec = useMemo(() => emptyProductQuery({ category, search: deferred }), [category, deferred]);
  const fetchPage = useCallback(
    (cursor: QueryDocumentSnapshot | null) => pageProducts(tenantId, spec, cursor),
    [tenantId, spec],
  );
  const page = usePagedQuery(`${tenantId}|${spec.category}|${spec.search}|${catalogRevision}`, fetchPage, { keepPrevious: true });
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ overflow: false, atStart: true, atEnd: true });

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

  /** Barcode scanners type the code followed by Enter. The match is an indexed equality query. */
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const code = search.trim();
      if (!code) return;
      void findProductByBarcode(tenantId, code, true).then((exact) => {
        const pick = exact ?? (page.items.length === 1 ? page.items[0] : null);
        if (!pick) return;
        onPick(pick);
        setSearch('');
      });
    } else if (e.key === 'Escape') {
      setSearch('');
    }
  };

  const problem = catalogLoadProblem(online, page.error);
  const pendingInput = search !== deferred;
  const view = catalogViewMode({
    hasProblem: problem !== null,
    loading: page.loading,
    refreshing: page.refreshing,
    pendingInput,
    itemCount: page.items.length,
  });

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
        {view === 'problem' ? (
          <Alert tone="error" onRetry={page.reload} retryLabel={t('common.retry')}>
            {t(problem === 'offline' ? 'pos.offlineCatalog' : 'error.loadFailed')}
          </Alert>
        ) : view === 'loading' ? (
          <div className="page-loader">
            <Spinner size={28} />
          </div>
        ) : view === 'empty' ? (
          <EmptyState icon="search" title={t('pos.noProducts')} />
        ) : (
          <div className={page.refreshing || pendingInput ? 'picker__grid picker__grid--refresh' : 'picker__grid'}>
            {page.items.map((p) => {
              const out = p.stock <= 0;
              const low = !out && p.stock <= (p.minStock ?? lowStockThreshold);
              return (
                <ProductTile
                  key={p.id}
                  name={p.name}
                  imageUrl={p.imageUrl}
                  usd={formatUsd(tierUsdCents(p, tier, rate))}
                  lbp={formatLbp(tierLbp(p, tier, rate), lang)}
                  stockLabel={out ? t('products.outOfStock') : t('products.stockCount', { count: p.stock })}
                  tone={out ? 'out' : low ? 'low' : 'ok'}
                  disabled={out}
                  onPick={() => onPick(p)}
                />
              );
            })}
          </div>
        )}
        {page.hasMore && view !== 'problem' && (
          <div className="load-more">
            <Button variant="secondary" loading={page.loadingMore} onClick={() => void page.loadMore()}>
              {t('common.loadMore')}
            </Button>
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
