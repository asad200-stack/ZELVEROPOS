import { useDeferredValue, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Alert, Badge, EmptyState, PageHeader, SearchBox, StatCard, TableWrap, Toolbar } from '@/components/ui/Layout';
import { PageLoader } from '@/components/ui/Spinner';
import { useFeedback } from '@/contexts/feedback';
import { useTenant } from '@/contexts/session';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useCustomers } from '@/hooks/useTenantData';
import { useI18n } from '@/i18n/i18n';
import { deleteCustomer } from '@/services/customerService';
import { retryResource } from '@/stores/tenantStore';
import type { Customer } from '@/types/models';
import { downloadCsv } from '@/utils/csv';
import { formatUsd, normalizeSearch } from '@/utils/format';
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
  const state = useCustomers();
  const [search, setSearch] = useState('');
  const [debtOnly, setDebtOnly] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const deferred = useDeferredValue(search);
  const del = useAsyncAction('customer-delete');

  const filtered = useMemo(() => {
    const q = normalizeSearch(deferred);
    return state.data.filter(
      (c) => (!debtOnly || c.debtUsdCents > 0) && (!q || normalizeSearch(c.name).includes(q) || c.phone.includes(deferred.trim())),
    );
  }, [state.data, deferred, debtOnly]);

  const totalDebt = state.data.reduce((s, c) => s + c.debtUsdCents, 0);
  const debtors = state.data.filter((c) => c.debtUsdCents > 0).length;
  // Customer objects in dialogs must stay live (debt changes after a payment).
  const live = (c: Customer) => state.data.find((x) => x.id === c.id) ?? c;

  return (
    <div className="page">
      <PageHeader
        title={t('nav.customers')}
        actions={
          <>
            <Button
              variant="secondary"
              icon="download"
              disabled={!filtered.length}
              onClick={() =>
                downloadCsv(
                  'customers.csv',
                  [t('customers.name'), t('auth.phone'), t('auth.email'), t('customers.address'), t('customers.debt'), t('customers.creditLimit'), t('customers.totalPurchases')],
                  filtered.map((c) => [c.name, c.phone, c.email, c.address, (c.debtUsdCents / 100).toFixed(2), (c.creditLimitUsdCents / 100).toFixed(2), (c.totalPurchasesUsdCents / 100).toFixed(2)]),
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
        <StatCard icon="users" label={t('customers.count')} value={state.data.length} />
        <StatCard icon="dollar" tone="danger" label={t('customers.totalDebt')} value={formatUsd(totalDebt)} sub={t('customers.debtorsCount', { count: debtors })} />
      </div>
      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder={t('customers.searchPlaceholder')} />
        <label className="checkbox">
          <input type="checkbox" checked={debtOnly} onChange={(e) => setDebtOnly(e.target.checked)} />
          <span>{t('customers.withDebtOnly')}</span>
        </label>
      </Toolbar>

      {state.status === 'error' ? (
        <Alert tone="error" onRetry={() => retryResource(tenantId, 'customers')} retryLabel={t('common.retry')}>
          {t('error.loadFailed')}
        </Alert>
      ) : state.status === 'loading' ? (
        <PageLoader />
      ) : filtered.length === 0 ? (
        <EmptyState icon="users" title={state.data.length ? t('common.noResults') : t('customers.empty')} />
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
              {filtered.map((c) => (
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

      {dialog?.type === 'form' && <CustomerFormModal customer={dialog.customer} onClose={() => setDialog(null)} />}
      {dialog?.type === 'pay' && <PayDebtModal customer={live(dialog.customer)} onClose={() => setDialog(null)} />}
      {dialog?.type === 'history' && <CustomerHistoryModal customer={live(dialog.customer)} onClose={() => setDialog(null)} />}
      {dialog?.type === 'adjust' && <AdjustDebtModal customer={live(dialog.customer)} onClose={() => setDialog(null)} />}
    </div>
  );
}
