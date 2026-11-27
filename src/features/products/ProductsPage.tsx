import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { where, type QueryDocumentSnapshot } from 'firebase/firestore';
import { Button } from '@/components/ui/Button';
import { Alert, Badge, EmptyState, PageHeader, SearchBox, TableWrap, Toolbar } from '@/components/ui/Layout';
import { PageLoader } from '@/components/ui/Spinner';
import { useFeedback } from '@/contexts/feedback';
import { useTenant } from '@/contexts/session';
import { expiryState } from '@/domain/dates';
import { emptyProductQuery, type ProductListMode } from '@/domain/catalogPlan';
import { isLowStock } from '@/domain/inventory';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { usePagedQuery } from '@/hooks/usePagedQuery';
import { useCategories, useSettings } from '@/hooks/useTenantData';
import { useI18n } from '@/i18n/i18n';
import { DEFAULTS } from '@/constants/app';
import { countWhere, pageProducts } from '@/services/catalogQuery';
import { deleteProductPermanently, setProductStatus } from '@/services/productService';
import type { Product } from '@/types/models';
import { downloadCsv } from '@/utils/csv';
import { formatDate, formatUsd } from '@/utils/format';
import type { ProductDraftFields } from '@/features/ai/actions/productDraft';
import { registerPageUiHost, unregisterPageUiHost } from '@/features/ai/actions/pageUiBridge';
import { ProductFormModal } from './ProductFormModal';
import { CategoriesModal, ImportProductsModal, LabelsModal, MovementsModal } from './ProductTools';
import { StockAdjustModal } from './StockAdjustModal';
import { StockLinksModal } from './StockLinksModal';
import { OpenPackModal, PackModal } from './PackModals';
import { useFeatureUpdates } from '@/features/features/useFeatureUpdates';
import { useSession } from '@/contexts/session';
import { isLinked } from '@/domain/stockUnits';
import { VariantGroupModal } from './VariantGroupModal';

type Filter = 'all' | 'low' | 'out' | 'archived';
type Dialog =
  | { type: 'form'; product: Product | null; seed?: ProductDraftFields | null }
  | { type: 'adjust'; product: Product }
  | { type: 'links'; product: Product }
  | { type: 'pack'; product: Product }
  | { type: 'openPack'; product: Product }
  | { type: 'options'; product: Product }
  | { type: 'movements'; product: Product }
  | { type: 'labels'; products: Product[] }
  | { type: 'categories' }
  | { type: 'import' }
  | null;

const MODE: Record<Filter, ProductListMode> = { all: 'browse', low: 'low', out: 'out', archived: 'archived' };

export default function ProductsPage() {
  const { t, lang } = useI18n();
  const { tenantId, can } = useTenant();
  const { confirm, notify } = useFeedback();
  const categories = useCategories();
  const settings = useSettings();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [createEpoch, setCreateEpoch] = useState(0);
  const [counts, setCounts] = useState<{ active: number; archived: number } | null>(null);
  const deferred = useDeferredValue(search);
  const del = useAsyncAction('product-delete');
  // Cartons and sets: shown only to stores the Super Admin released the feature to (the server re-checks).
  const session = useSession();
  const featureUpdates = useFeatureUpdates();
  const stockLinksOn = session.isInternalDemo || featureUpdates.some((u) => u.featureId === 'stock_links' && u.status === 'active');
  const canSeeCost = can('canViewCosts');
  const canAdd = can('canAddProducts');

  useEffect(() => {
    const host = {
      openCreateForm: (seed?: ProductDraftFields) => {
        if (!canAdd) return false;
        setCreateEpoch((n) => n + 1);
        setDialog({ type: 'form', product: null, seed: seed ?? null });
        return true;
      },
    };
    registerPageUiHost('/products', host);
    return () => unregisterPageUiHost('/products', host);
  }, [canAdd]);
  const spec = useMemo(
    () => emptyProductQuery({ mode: MODE[filter], category, search: deferred, lowStockAt: settings.lowStockThreshold }),
    [filter, category, deferred, settings.lowStockThreshold],
  );
  const fetchPage = useCallback((cursor: QueryDocumentSnapshot | null) => pageProducts(tenantId, spec, cursor), [tenantId, spec]);
  const page = usePagedQuery(`${tenantId}|${spec.mode}|${spec.category}|${spec.search}|${spec.lowStockAt}`, fetchPage);
  const visible = page.items;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      countWhere(tenantId, 'products', [where('status', '==', 'active')]),
      countWhere(tenantId, 'products', [where('status', '==', 'archived')]),
    ])
      .then(([active, archived]) => {
        if (!cancelled) setCounts({ active, archived });
      })
      .catch((error: unknown) => console.error('[products] counts', error));
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const exportCsv = () =>
    downloadCsv(
      'products.csv',
      ['name', 'barcode', 'category', 'retail', 'wholesale', 'vip', 'retail_lbp', ...(canSeeCost ? ['cost'] : []), 'stock', 'min_stock', 'expiry_date'],
      visible.map((p) => [
        p.name,
        p.barcode,
        p.category,
        (p.prices.retail.usdCents / 100).toFixed(2),
        (p.prices.wholesale.usdCents / 100).toFixed(2),
        (p.prices.vip.usdCents / 100).toFixed(2),
        p.prices.retail.lbp ?? '',
        ...(canSeeCost ? [p.costKnown === false ? 'unknown' : (p.costUsdCents / 100).toFixed(2)] : []),
        p.stock,
        p.minStock ?? '',
        p.expiryDate ?? '',
      ]),
    );

  const archive = async (p: Product) => {
    if (!(await confirm({ title: t('products.archiveConfirm', { name: p.name }), message: t('products.archiveHint'), confirmLabel: t('products.archive') }))) return;
    void del.run(async () => {
      await setProductStatus(p.id, 'archived');
      notify('success', t('products.archived'));
    });
  };

  const restore = (p: Product) =>
    void del.run(async () => {
      await setProductStatus(p.id, 'active');
      notify('success', t('products.restored'));
    });

  const removeForever = async (p: Product) => {
    if (!(await confirm({ title: t('products.deleteConfirm', { name: p.name }), message: t('products.deleteHint'), danger: true, confirmLabel: t('products.deleteForever') }))) return;
    void del.run(async () => {
      await deleteProductPermanently(p.id);
      notify('success', t('common.deleted'));
    });
  };

  return (
    <div className="page">
      <PageHeader
        title={t('nav.products')}
        subtitle={
          canSeeCost
            ? t('products.summary', { count: counts?.active ?? visible.length })
            : t('products.summary', { count: counts?.active ?? visible.length })
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
              <Button variant="secondary" icon="download" onClick={exportCsv} disabled={!visible.length}>
                {t('common.exportCsv')}
              </Button>
            )}
            <Button variant="secondary" icon="barcode" onClick={() => setDialog({ type: 'labels', products: visible.slice(0, 200) })} disabled={!visible.length}>
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
          <option value="archived">{t('products.filterArchived', { count: counts?.archived ?? 0 })}</option>
        </select>
      </Toolbar>

      {page.error ? (
        <Alert tone="error" onRetry={page.reload} retryLabel={t('common.retry')}>
          {t('error.loadFailed')}
        </Alert>
      ) : page.loading ? (
        <PageLoader />
      ) : visible.length === 0 ? (
        <EmptyState
          icon="box"
          title={search || category || filter !== 'all' ? t('common.noResults') : t('products.empty')}
          action={
            !search && !category && filter === 'all' && can('canAddProducts') ? (
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
                            {p.barcode && (
                              <div className="small muted" dir="ltr">
                                {p.barcode}
                              </div>
                            )}
                            {p.imeiTracking && <Badge tone="info">IMEI</Badge>}
                          </div>
                        </div>
                      </td>
                      <td>{p.category || '—'}</td>
                      <td className="num">{formatUsd(p.prices.retail.usdCents)}</td>
                      <td className="num hide-sm">{formatUsd(p.prices.wholesale.usdCents)}</td>
                      {canSeeCost && (
                        <td className="num hide-sm">{p.costKnown === false ? t('products.costUnknown') : formatUsd(p.costUsdCents)}</td>
                      )}
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
                            {!isLinked(p) && (
                              <Button variant="ghost" size="sm" icon="package" onClick={() => setDialog({ type: 'adjust', product: p })} aria-label={t('products.adjustStock')} title={t('products.adjustStock')} />
                            )}
                            {(stockLinksOn || p.packOf) && !p.groupId && !p.imeiTracking && !isLinked(p) && (
                              <Button variant="ghost" size="sm" icon="tag" onClick={() => setDialog({ type: 'pack', product: p })} aria-label={t('pack.action')} title={t('pack.action')} />
                            )}
                            {p.packOf && (
                              <Button variant="ghost" size="sm" icon="download" onClick={() => setDialog({ type: 'openPack', product: p })} aria-label={t('pack.open')} title={t('pack.open')} />
                            )}
                            {(stockLinksOn || isLinked(p)) && !p.groupId && !p.imeiTracking && !p.packOf && (
                              <Button variant="ghost" size="sm" icon="box" onClick={() => setDialog({ type: 'links', product: p })} aria-label={t('stockLinks.action')} title={t('stockLinks.action')} />
                            )}
                            {p.groupId && (
                              <Button variant="ghost" size="sm" icon="grid" onClick={() => setDialog({ type: 'options', product: p })} aria-label={t('products.variants.manage')} title={t('products.variants.manage')} />
                            )}
                          </>
                        )}
                        <Button variant="ghost" size="sm" icon="history" onClick={() => setDialog({ type: 'movements', product: p })} aria-label={t('products.movements')} title={t('products.movements')} />
                        {can('canDeleteProducts') &&
                          (p.status === 'archived' ? (
                            <>
                              <Button variant="ghost" size="sm" icon="refresh" onClick={() => restore(p)} disabled={del.busy} aria-label={t('products.restore')} title={t('products.restore')} />
                              <Button variant="ghost" size="sm" icon="trash" onClick={() => void removeForever(p)} disabled={del.busy} aria-label={t('products.deleteForever')} title={t('products.deleteForever')} />
                            </>
                          ) : (
                            <Button variant="ghost" size="sm" icon="archive" onClick={() => void archive(p)} disabled={del.busy} aria-label={t('products.archive')} title={t('products.archive')} />
                          ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
          {page.hasMore && (
            <div className="load-more">
              <Button variant="secondary" loading={page.loadingMore} onClick={() => void page.loadMore()}>
                {t('common.loadMore')}
              </Button>
            </div>
          )}
        </>
      )}

      {dialog?.type === 'form' && (
        <ProductFormModal
          key={dialog.product?.id ?? (dialog.seed ? `ai-${createEpoch}` : 'manual')}
          product={dialog.product}
          seed={dialog.seed}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'adjust' && <StockAdjustModal product={dialog.product} onClose={() => setDialog(null)} />}
      {dialog?.type === 'pack' && <PackModal key={dialog.product.id} product={dialog.product} onClose={() => setDialog(null)} />}
      {dialog?.type === 'openPack' && <OpenPackModal key={dialog.product.id} product={dialog.product} onClose={() => setDialog(null)} />}
      {dialog?.type === 'links' && <StockLinksModal key={dialog.product.id} product={dialog.product} onClose={() => setDialog(null)} />}
      {dialog?.type === 'options' && <VariantGroupModal product={dialog.product} onClose={() => setDialog(null)} />}
      {dialog?.type === 'movements' && <MovementsModal product={dialog.product} onClose={() => setDialog(null)} />}
      {dialog?.type === 'labels' && <LabelsModal products={dialog.products} onClose={() => setDialog(null)} />}
      {dialog?.type === 'categories' && <CategoriesModal onClose={() => setDialog(null)} />}
      {dialog?.type === 'import' && <ImportProductsModal onClose={() => setDialog(null)} />}
    </div>
  );
}
