import { useCallback, useDeferredValue, useState } from 'react';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { DateRangeFilter } from '@/components/DateRangeFilter';
import { initialRange } from '@/domain/dates';
import { Button } from '@/components/ui/Button';
import { Alert, Badge, EmptyState, PageHeader, TableWrap, Toolbar } from '@/components/ui/Layout';
import { clickableRow } from '@/components/ui/clickableRow';
import { PageLoader } from '@/components/ui/Spinner';
import { useTenant } from '@/contexts/session';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useAsyncData } from '@/hooks/useAsyncData';
import { usePagedQuery } from '@/hooks/usePagedQuery';
import { useI18n } from '@/i18n/i18n';
import { pageCustomers } from '@/services/catalogQuery';
import { AppError } from '@/services/errors';
import { loadDailyStats, netFigures, sumStats } from '@/services/reportService';
import { findSaleByInvoice, listSales } from '@/services/salesService';
import type { Sale, SaleKind } from '@/types/models';
import { downloadCsv } from '@/utils/csv';
import { formatDateTime, formatLbp, formatUsd } from '@/utils/format';
import { SaleDetailsModal } from './SaleDetailsModal';
import { useSalesWindow } from './useSalesWindow';

export default function SalesPage() {
  const { t, lang } = useI18n();
  const { tenantId } = useTenant();
  const [range, setRange] = useState(() => initialRange('today'));
  const [kind, setKind] = useState<SaleKind | 'all'>('all');
  const [customerId, setCustomerId] = useState('');
  const [invoice, setInvoice] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const deferredCustomer = useDeferredValue(customerSearch);
  const fetchCustomers = useCallback(
    (cursor: QueryDocumentSnapshot | null) => pageCustomers(tenantId, { search: deferredCustomer }, cursor),
    [tenantId, deferredCustomer],
  );
  const customers = usePagedQuery(`${tenantId}|sales-customers|${deferredCustomer}`, fetchCustomers);
  const [selected, setSelected] = useState<Sale | null>(null);
  const search = useAsyncAction('sales-search');

  const fetchPage = useCallback(
    (cursor: { localDate: string; createdAtMs: number; id: string } | null) =>
      listSales(tenantId, { from: range.from, to: range.to, kind, customerId: customerId || null }, cursor),
    [tenantId, range.from, range.to, kind, customerId],
  );
  const sales = useSalesWindow(`${tenantId}|${range.from}|${range.to}|${kind}|${customerId}`, fetchPage);
  const period = useAsyncData(!customerId && kind === 'all' ? `${tenantId}|sales-period|${range.from}|${range.to}` : null, () =>
    loadDailyStats(tenantId, range.from, range.to),
  );
  const periodTotal = period.data ? sumStats(period.data) : null;

  const exportCsv = () =>
    downloadCsv(
      `sales-${range.from}-${range.to}.csv`,
      [t('sales.invoice'), t('common.date'), t('sales.type'), t('pos.customer'), t('pos.total'), t('sales.returned'), t('receipt.paidUsd'), t('receipt.paidLbp'), t('receipt.cashier')],
      sales.items.map((s) => [
        s.invoiceNumber,
        formatDateTime(s.createdAt, lang),
        s.kind,
        s.customerName,
        (s.totalUsdCents / 100).toFixed(2),
        (s.returnedUsdCents / 100).toFixed(2),
        (s.payment.receivedUsdCents / 100).toFixed(2),
        s.payment.receivedLbp,
        s.createdByName,
      ]),
    );

  return (
    <div className="page">
      <PageHeader
        title={t('nav.sales')}
        subtitle={
          periodTotal
            ? t('sales.summary', { count: periodTotal.salesCount, total: formatUsd(netFigures(periodTotal).netRevenue) })
            : t('sales.pageSummary', { count: sales.items.length })
        }
        actions={
          <Button variant="secondary" icon="download" onClick={exportCsv} disabled={sales.items.length === 0}>
            {t('sales.exportPage')}
          </Button>
        }
      />
      <Toolbar>
        <DateRangeFilter value={range} onChange={setRange} />
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value as SaleKind | 'all')} aria-label={t('sales.type')}>
          <option value="all">{t('sales.allTypes')}</option>
          <option value="cash">{t('pos.cash')}</option>
          <option value="credit">{t('pos.credit')}</option>
        </select>
        <input className="input" value={customerSearch} placeholder={t('sales.allCustomers')} aria-label={t('pos.customer')} onChange={(e) => setCustomerSearch(e.target.value)} />
        <select className="input" value={customerId} onChange={(e) => setCustomerId(e.target.value)} aria-label={t('pos.customer')}>
          <option value="">{t('sales.allCustomers')}</option>
          {customers.items.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <form
          className="inline-form sales-find"
          onSubmit={(e) => {
            e.preventDefault();
            if (!invoice.trim()) return;
            void search.run(async () => {
              const sale = await findSaleByInvoice(tenantId, invoice);
              if (sale) setSelected(sale);
              else throw new AppError('error.notFound');
            });
          }}
        >
          <input className="input" dir="ltr" placeholder={t('sales.findInvoice')} value={invoice} onChange={(e) => setInvoice(e.target.value)} />
          <Button type="submit" variant="secondary" icon="search" loading={search.busy} aria-label={t('common.search')} />
        </form>
      </Toolbar>

      {sales.error && sales.items.length === 0 ? (
        <Alert tone="error" onRetry={sales.reload} retryLabel={t('common.retry')}>
          {t('error.loadFailed')}
        </Alert>
      ) : sales.loading ? (
        <PageLoader />
      ) : sales.items.length === 0 && !sales.refreshing ? (
        <EmptyState icon="receipt" title={t('sales.empty')} />
      ) : (
        <>
          {sales.error && (
            <Alert tone="error" onRetry={sales.reload} retryLabel={t('common.retry')}>
              {t('error.loadFailed')}
            </Alert>
          )}
          <div className={sales.refreshing ? 'sales-page sales-page--refresh' : 'sales-page'}>
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>{t('sales.invoice')}</th>
                  <th>{t('common.date')}</th>
                  <th>{t('pos.customer')}</th>
                  <th>{t('sales.type')}</th>
                  <th className="num">{t('pos.total')}</th>
                  <th className="num">{t('sales.paid')}</th>
                  <th>{t('receipt.cashier')}</th>
                </tr>
              </thead>
              <tbody>
                {sales.items.map((s) => (
                  <tr key={s.id} {...clickableRow(() => setSelected(s))}>
                    <td>
                      <strong>{s.invoiceNumber}</strong>
                      {s.returnStatus !== 'none' && (
                        <>
                          {' '}
                          <Badge tone="warning">{t(s.returnStatus === 'full' ? 'sales.fullyReturned' : 'sales.partiallyReturned')}</Badge>
                        </>
                      )}
                    </td>
                    <td>{formatDateTime(s.createdAt, lang)}</td>
                    <td>{s.customerName || '—'}</td>
                    <td>
                      <Badge tone={s.kind === 'credit' ? 'info' : 'default'}>{t(s.kind === 'credit' ? 'pos.credit' : 'pos.cash')}</Badge>
                    </td>
                    <td className="num">{s.currency === 'LBP' ? formatLbp(s.totalLbp, lang) : formatUsd(s.totalUsdCents)}</td>
                    <td className="num small">
                      {s.payment.receivedUsdCents > 0 && <div>{formatUsd(s.payment.receivedUsdCents)}</div>}
                      {s.payment.receivedLbp > 0 && <div>{formatLbp(s.payment.receivedLbp, lang)}</div>}
                    </td>
                    <td>{s.createdByName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <div className="load-more">
            <Button variant="secondary" disabled={sales.refreshing || !sales.hasPrevious} onClick={sales.previous}>
              {t('sales.previous')}
            </Button>
            <Button variant="secondary" disabled={sales.refreshing || !sales.hasMore} onClick={sales.next}>
              {t('sales.next')}
            </Button>
          </div>
          </div>
        </>
      )}

      {selected && (
        <SaleDetailsModal
          sale={selected}
          onClose={() => setSelected(null)}
          onUpdated={(updated) => {
            setSelected(updated);
            sales.patch((items) => items.map((s) => (s.id === updated.id ? updated : s)));
          }}
        />
      )}
    </div>
  );
}
