import { memo, useDeferredValue, useMemo, useState, type KeyboardEvent, type RefObject } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Badge, EmptyState } from '@/components/ui/Layout';
import { Spinner } from '@/components/ui/Spinner';
import { tierLbp, tierUsdCents } from '@/domain/pricing';
import { useI18n } from '@/i18n/i18n';
import type { Currency, PriceTier, Product } from '@/types/models';
import { formatLbp, formatUsd, normalizeSearch } from '@/utils/format';

interface Props {
  products: Product[];
  loading: boolean;
  categories: string[];
  tier: PriceTier;
  currency: Currency;
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
  currency,
  rate,
  lowStockThreshold,
  searchRef,
  onPick,
}: Props) {
  const { t, lang } = useI18n();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const deferred = useDeferredValue(search);

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
          <Icon name="barcode" size={16} />
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
        </div>
        {categories.length > 0 && (
          <div className="chips">
            <button type="button" className={category === '' ? 'chip chip--active' : 'chip'} onClick={() => setCategory('')}>
              {t('common.all')}
            </button>
            {categories.map((c) => (
              <button key={c} type="button" className={category === c ? 'chip chip--active' : 'chip'} onClick={() => setCategory(c)}>
                {c}
              </button>
            ))}
          </div>
        )}
      </div>
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
                <span className="product-tile__price">
                  {currency === 'USD' ? formatUsd(tierUsdCents(p, tier, rate)) : formatLbp(tierLbp(p, tier, rate), lang)}
                </span>
                <Badge tone={out ? 'danger' : low ? 'warning' : 'default'}>
                  {out ? t('products.outOfStock') : t('products.stockCount', { count: p.stock })}
                </Badge>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});
