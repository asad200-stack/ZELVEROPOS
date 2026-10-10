import { useCallback, useDeferredValue, useEffect, useState } from 'react';
import { where, type QueryDocumentSnapshot } from 'firebase/firestore';
import { Button } from '@/components/ui/Button';
import { Alert, Badge, EmptyState, PageHeader, SearchBox, StatCard, TableWrap, Toolbar } from '@/components/ui/Layout';
import { PageLoader } from '@/components/ui/Spinner';
import { useFeedback } from '@/contexts/feedback';
import { useTenant } from '@/contexts/session';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { usePagedQuery } from '@/hooks/usePagedQuery';
import { useI18n } from '@/i18n/i18n';
import { countWhere, pageCustomers } from '@/services/catalogQuery';
import { deleteCustomer } from '@/services/customerService';
import type { Customer } from '@/types/models';
import { downloadCsv } from '@/utils/csv';
import { formatUsd } from '@/utils/format';
import { AdjustDebtModal, CustomerFormModal, CustomerHistoryModal, PayDebtModal } from './CustomerModals';

type Dialog =
  | { type: 'form'; customer: Customer | null }
  | { type: 'pay'; customer: Customer }
  | { type: 'history'; customer: Customer }
  | { type: 'adjust'; customer: Customer }
  | null;

export default function CustomersPage() {
  const { t } = useI18n();
  const { tenantId, actor, isOwner } = useTenant();
  const { confirm, notify } = useFeedback();
  const [search, setSearch] = useState('');
  const [debtOnly, setDebtOnly] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [counts, setCounts] = useState<{ customers: number; debtors: number } | null>(null);
  const deferred = useDeferredValue(search);
  const del = useAsyncAction('customer-delete');
  const fetchPage = useCallback(
    (cursor: QueryDocumentSnapshot | null) => pageCustomers(tenantId, { search: deferred, debtOnly }, cursor),
    [tenantId, deferred, debtOnly],
  );
  const page = usePagedQuery(`${tenantId}|${deferred}|${debtOnly}`, fetchPage);
  const live = (c: Customer) => page.items.find((x) => x.id === c.id) ?? c;

  useEffect(() => {
    let cancelled = false;
    Promise.all([countWhere(tenantId, 'customers', []), countWhere(tenantId, 'customers', [where('debtUsdCents', '>', 0)])])
      .then(([customers, debtors]) => {
        if (!cancelled) setCounts({ customers, debtors });
      })
      .catch((error: unknown) => console.error('[customers] counts', error));
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  return (
    <div className="page">
      <PageHeader
        title={t('nav.customers')}
        actions={
          <>
            <Button
              variant="secondary"
              icon="download"
              disabled={!page.items.length}
              onClick={() =>
                downloadCsv(
                  'customers.csv',
                  [t('customers.name'), t('auth.phone'), t('auth.email'), t('customers.address'), t('customers.debt'), t('customers.creditLimit'), t('customers.totalPurchases')],
                  page.items.map((c) => [c.name, c.phone, c.email, c.address, (c.debtUsdCents / 100).toFixed(2), (c.creditLimitUsdCents / 100).toFixed(2), (c.totalPurchasesUsdCents / 100).toFixed(2)]),
                )
              }
            >
              {t('common.exportCsv')}
            </Button>
            <Button icon="plus" onClick={() => setDialog({ type: 'form', customer: null })}>
              {t('customers.add')}
            </Button>
          </>
        }
      />
      <div className="stats">
        <StatCard icon="users" label={t('customers.count')} value={counts?.customers ?? page.items.length} />
        <StatCard icon="dollar" tone="danger" label={t('customers.debtorsCount', { count: counts?.debtors ?? 0 })} value={counts?.debtors ?? 0} />
      </div>
      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder={t('customers.searchPlaceholder')} />
        <label className="checkbox">
          <input type="checkbox" checked={debtOnly} onChange={(e) => setDebtOnly(e.target.checked)} />
          <span>{t('customers.withDebtOnly')}</span>
        </label>
      </Toolbar>

      {page.error ? (
        <Alert tone="error" onRetry={page.reload} retryLabel={t('common.retry')}>
          {t('error.loadFailed')}
        </Alert>
      ) : page.loading ? (
        <PageLoader />
      ) : page.items.length === 0 ? (
        <EmptyState icon="users" title={search || debtOnly ? t('common.noResults') : t('customers.empty')} />
      ) : (
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>{t('customers.name')}</th>
                <th>{t('auth.phone')}</th>
                <th className="num">{t('customers.debt')}</th>
                <th className="num hide-sm">{t('customers.creditLimit')}</th>
                <th className="num hide-sm">{t('customers.totalPurchases')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {page.items.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.name}</strong>
                    {c.address && <div className="small muted">{c.address}</div>}
                  </td>
                  <td>{c.phone || '—'}</td>
                  <td className="num">
                    {c.debtUsdCents > 0 ? (
                      <Badge tone={c.debtUsdCents > c.creditLimitUsdCents ? 'danger' : 'warning'}>{formatUsd(c.debtUsdCents)}</Badge>
                    ) : (
                      formatUsd(0)
                    )}
                  </td>
                  <td className="num hide-sm">{formatUsd(c.creditLimitUsdCents)}</td>
                  <td className="num hide-sm">{formatUsd(c.totalPurchasesUsdCents)}</td>
                  <td className="actions-cell">
                    {c.debtUsdCents > 0 && (
                      <Button variant="success" size="sm" icon="dollar" onClick={() => setDialog({ type: 'pay', customer: c })}>
                        {t('customers.pay')}
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" icon="history" onClick={() => setDialog({ type: 'history', customer: c })} aria-label={t('customers.history')} title={t('customers.history')} />
                    <Button variant="ghost" size="sm" icon="edit" onClick={() => setDialog({ type: 'form', customer: c })} aria-label={t('common.edit')} />
                    {isOwner && (
                      <>
                        <Button variant="ghost" size="sm" icon="tag" onClick={() => setDialog({ type: 'adjust', customer: c })} aria-label={t('customers.adjustDebt')} title={t('customers.adjustDebt')} />
                        <Button
                          variant="ghost"
                          size="sm"
                          icon="trash"
                          aria-label={t('common.delete')}
                          onClick={async () => {
                            if (await confirm({ title: t('customers.deleteConfirm', { name: c.name }), danger: true, confirmLabel: t('common.delete') })) {
                              void del.run(async () => {
                                await deleteCustomer(actor, c);
                                notify('success', t('common.deleted'));
                              });
                            }
                          }}
                        />
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {page.hasMore && (
        <div className="load-more">
          <Button variant="secondary" loading={page.loadingMore} onClick={() => void page.loadMore()}>
            {t('common.loadMore')}
          </Button>
        </div>
      )}

      {dialog?.type === 'form' && <CustomerFormModal customer={dialog.customer} onClose={() => setDialog(null)} />}
      {dialog?.type === 'pay' && <PayDebtModal customer={live(dialog.customer)} onClose={() => setDialog(null)} />}
      {dialog?.type === 'history' && <CustomerHistoryModal customer={live(dialog.customer)} onClose={() => setDialog(null)} />}
      {dialog?.type === 'adjust' && <AdjustDebtModal customer={live(dialog.customer)} onClose={() => setDialog(null)} />}
    </div>
  );
}
