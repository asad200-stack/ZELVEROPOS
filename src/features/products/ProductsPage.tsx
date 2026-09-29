import { useDeferredValue, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Alert, Badge, EmptyState, PageHeader, SearchBox, TableWrap, Toolbar } from '@/components/ui/Layout';
import { PageLoader } from '@/components/ui/Spinner';
import { useFeedback } from '@/contexts/feedback';
import { useTenant } from '@/contexts/session';
import { expiryState } from '@/domain/dates';
import { isLowStock, stockValue } from '@/domain/inventory';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useCategories, useProducts, useSettings } from '@/hooks/useTenantData';
import { useI18n } from '@/i18n/i18n';
import { DEFAULTS } from '@/constants/app';
import { deleteProduct } from '@/services/productService';
import { retryResource } from '@/stores/tenantStore';
import type { Product } from '@/types/models';
import { downloadCsv } from '@/utils/csv';
import { formatDate, formatUsd, normalizeSearch } from '@/utils/format';
import { ProductFormModal } from './ProductFormModal';
import { CategoriesModal, ImportProductsModal, LabelsModal, MovementsModal } from './ProductTools';
import { StockAdjustModal } from './StockAdjustModal';

type Filter = 'all' | 'low' | 'out';
type Dialog =
  | { type: 'form'; product: Product | null }
  | { type: 'adjust'; product: Product }
  | { type: 'movements'; product: Product }
  | { type: 'labels'; products: Product[] }
  | { type: 'categories' }
  | { type: 'import' }
  | null;

const PAGE = 100;

export default function ProductsPage() {
  const { t, lang } = useI18n();
  const { tenantId, actor, can } = useTenant();
  const { confirm, notify } = useFeedback();
  const state = useProducts();
  const categories = useCategories();
  const settings = useSettings();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [limit, setLimit] = useState(PAGE);
  const [dialog, setDialog] = useState<Dialog>(null);
  const deferred = useDeferredValue(search);
  const del = useAsyncAction('product-delete');
  const canSeeCost = can('canViewCosts');

  const filtered = useMemo(() => {
    const q = normalizeSearch(deferred);
    return state.data.filter((p) => {
      if (category && p.category !== category) return false;
      if (filter === 'low' && !(p.stock > 0 && isLowStock(p, settings.lowStockThreshold))) return false;
      if (filter === 'out' && p.stock > 0) return false;
      return !q || normalizeSearch(p.name).includes(q) || p.barcode.includes(deferred.trim());
    });
  }, [state.data, deferred, category, filter, settings.lowStockThreshold]);

  const visible = filtered.slice(0, limit);

  const exportCsv = () =>
    downloadCsv(
      'products.csv',
      ['name', 'barcode', 'category', 'retail', 'wholesale', 'vip', 'retail_lbp', ...(canSeeCost ? ['cost'] : []), 'stock', 'min_stock', 'expiry_date'],
      filtered.map((p) => [
        p.name,
        p.barcode,
        p.category,
        (p.prices.retail.usdCents / 100).toFixed(2),
        (p.prices.wholesale.usdCents / 100).toFixed(2),
        (p.prices.vip.usdCents / 100).toFixed(2),
        p.prices.retail.lbp ?? '',
        ...(canSeeCost ? [(p.costUsdCents / 100).toFixed(2)] : []),
        p.stock,
        p.minStock ?? '',
        p.expiryDate ?? '',
      ]),
    );

  const remove = async (p: Product) => {
    if (!(await confirm({ title: t('products.deleteConfirm', { name: p.name }), message: t('products.deleteHint'), danger: true, confirmLabel: t('common.delete') }))) return;
    void del.run(async () => {
      await deleteProduct(actor, p);
      notify('success', t('common.deleted'));
    });
  };

  return (
    <div className="page">
      <PageHeader
        title={t('nav.products')}
        subtitle={
          canSeeCost
            ? t('products.summaryWithValue', { count: state.data.length, value: formatUsd(stockValue(state.data)) })
            : t('products.summary', { count: state.data.length })
        }
        actions={
          <>
            {can('canEditProducts') && (
              <Button variant="secondary" icon="tag" onClick={() => setDialog({ type: 'categories' })}>
                {t('products.categories')}
              </Button>
            )}
            {can('canImportProducts') && (
              <Button variant="secondary" icon="upload" onClick={() => setDialog({ type: 'import' })}>
                {t('products.import')}
              </Button>
            )}
            {can('canExportProducts') && (
              <Button variant="secondary" icon="download" onClick={exportCsv} disabled={!filtered.length}>
                {t('common.exportCsv')}
              </Button>
            )}
            <Button variant="secondary" icon="barcode" onClick={() => setDialog({ type: 'labels', products: filtered.slice(0, 200) })} disabled={!filtered.length}>
              {t('products.printLabels')}
            </Button>
            {can('canAddProducts') && (
              <Button icon="plus" onClick={() => setDialog({ type: 'form', product: null })}>
                {t('products.add')}
              </Button>
            )}
          </>
        }
      />
      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder={t('products.searchPlaceholder')} />
        <select className="input" value={category} onChange={(e) => setCategory(e.target.value)} aria-label={t('products.category')}>
          <option value="">{t('products.allCategories')}</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select className="input" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label={t('common.filter')}>
          <option value="all">{t('products.filterAll')}</option>
          <option value="low">{t('products.filterLow')}</option>
          <option value="out">{t('products.filterOut')}</option>
        </select>
      </Toolbar>

      {state.status === 'error' ? (
        <Alert tone="error" onRetry={() => retryResource(tenantId, 'products')} retryLabel={t('common.retry')}>
          {t('error.loadFailed')}
        </Alert>
      ) : state.status === 'loading' ? (
        <PageLoader />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="box"
          title={state.data.length ? t('common.noResults') : t('products.empty')}
          action={
            !state.data.length && can('canAddProducts') ? (
              <Button icon="plus" onClick={() => setDialog({ type: 'form', product: null })}>
                {t('products.add')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>{t('products.name')}</th>
                  <th>{t('products.category')}</th>
                  <th className="num">{t('products.retail')}</th>
                  <th className="num hide-sm">{t('products.wholesale')}</th>
                  {canSeeCost && <th className="num hide-sm">{t('products.cost')}</th>}
                  <th className="num">{t('products.stock')}</th>
                  <th className="hide-sm">{t('products.expiryDate')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => {
                  const exp = expiryState(p.expiryDate, DEFAULTS.expirySoonDays);
                  return (
                    <tr key={p.id}>
                      <td>
                        <div className="product-cell">
                          {p.imageUrl && <img src={p.imageUrl} alt="" loading="lazy" className="product-cell__img" />}
                          <div>
                            <strong>{p.name}</strong>
                            {p.barcode && <div className="small muted">{p.barcode}</div>}
                            {p.imeiTracking && <Badge tone="info">IMEI</Badge>}
                          </div>
                        </div>
                      </td>
                      <td>{p.category || '—'}</td>
                      <td className="num">{formatUsd(p.prices.retail.usdCents)}</td>
                      <td className="num hide-sm">{formatUsd(p.prices.wholesale.usdCents)}</td>
                      {canSeeCost && <td className="num hide-sm">{formatUsd(p.costUsdCents)}</td>}
                      <td className="num">
                        <Badge tone={p.stock <= 0 ? 'danger' : isLowStock(p, settings.lowStockThreshold) ? 'warning' : 'success'}>{p.stock}</Badge>
                      </td>
                      <td className="hide-sm">
                        {p.expiryDate ? (
                          <span className={exp === 'expired' ? 'text-danger' : exp === 'soon' ? 'text-warning' : undefined}>{formatDate(p.expiryDate, lang)}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="actions-cell">
                        {can('canEditProducts') && (
                          <>
                            <Button variant="ghost" size="sm" icon="edit" onClick={() => setDialog({ type: 'form', product: p })} aria-label={t('common.edit')} />
                            <Button variant="ghost" size="sm" icon="package" onClick={() => setDialog({ type: 'adjust', product: p })} aria-label={t('products.adjustStock')} title={t('products.adjustStock')} />
                          </>
                        )}
                        <Button variant="ghost" size="sm" icon="history" onClick={() => setDialog({ type: 'movements', product: p })} aria-label={t('products.movements')} title={t('products.movements')} />
                        {can('canDeleteProducts') && (
                          <Button variant="ghost" size="sm" icon="trash" onClick={() => void remove(p)} aria-label={t('common.delete')} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
          {filtered.length > limit && (
            <div className="load-more">
              <Button variant="secondary" onClick={() => setLimit((l) => l + PAGE)}>
                {t('common.showMore', { count: filtered.length - limit })}
              </Button>
            </div>
          )}
        </>
      )}

      {dialog?.type === 'form' && <ProductFormModal product={dialog.product} onClose={() => setDialog(null)} />}
      {dialog?.type === 'adjust' && <StockAdjustModal product={dialog.product} onClose={() => setDialog(null)} />}
      {dialog?.type === 'movements' && <MovementsModal product={dialog.product} onClose={() => setDialog(null)} />}
      {dialog?.type === 'labels' && <LabelsModal products={dialog.products} onClose={() => setDialog(null)} />}
      {dialog?.type === 'categories' && <CategoriesModal onClose={() => setDialog(null)} />}
      {dialog?.type === 'import' && <ImportProductsModal onClose={() => setDialog(null)} />}
    </div>
  );
}
