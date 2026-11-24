import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { where, type QueryDocumentSnapshot } from 'firebase/firestore';
import { DateRangeFilter } from '@/components/DateRangeFilter';
import { initialRange, type DateRange } from '@/domain/dates';
import { Button } from '@/components/ui/Button';
import { Alert, Card, PageHeader, StatCard, TableWrap, Tabs, Toolbar } from '@/components/ui/Layout';
import { PageLoader } from '@/components/ui/Spinner';
import { useTenant } from '@/contexts/session';
import { DAILY_STATS_LIMIT } from '@/domain/salesPlan';
import { lbpToUsdCents } from '@/domain/money';
import { useAsyncData } from '@/hooks/useAsyncData';
import { usePagedQuery } from '@/hooks/usePagedQuery';
import { useCashbox, useSettings } from '@/hooks/useTenantData';
import { useI18n } from '@/i18n/i18n';
import { listCashTransactions } from '@/services/cashboxService';
import { countWhere, loadLowStock, pageCustomers } from '@/services/catalogQuery';
import { loadDailyStats, netFigures, sumStats } from '@/services/reportService';
import { catalogHasUnknownCost } from '@/services/productService';
import { downloadCsv } from '@/utils/csv';
import { formatDate, formatLbp, formatUsd } from '@/utils/format';

const REPORT_TABS = ['sales', 'profit', 'inventory', 'customers', 'capital', 'expenses'] as const;
type Tab = (typeof REPORT_TABS)[number];

function isTab(value: string | null): value is Tab {
  return !!value && (REPORT_TABS as readonly string[]).includes(value);
}

export default function ReportsPage() {
  const { t } = useI18n();
  const { can } = useTenant();
  const [params, setParams] = useSearchParams();
  const [range, setRange] = useState<DateRange>(() => initialRange('month'));
  const canCosts = can('canViewCosts');
  const requested = params.get('tab');
  const tab: Tab =
    isTab(requested) && !((requested === 'capital' || requested === 'profit') && !canCosts) ? requested : 'sales';

  function selectTab(next: Tab) {
    const copy = new URLSearchParams(params);
    if (next === 'sales') copy.delete('tab');
    else copy.set('tab', next);
    setParams(copy, { replace: true });
  }

  const tabs: { value: Tab; label: string }[] = [
    { value: 'sales', label: t('reports.sales') },
    ...(canCosts ? [{ value: 'profit' as Tab, label: t('reports.profit') }] : []),
    { value: 'inventory', label: t('reports.inventory') },
    { value: 'customers', label: t('reports.customers') },
    ...(canCosts ? [{ value: 'capital' as Tab, label: t('reports.capital') }] : []),
    { value: 'expenses', label: t('reports.expenses') },
  ];

  const needsRange = tab === 'sales' || tab === 'profit' || tab === 'expenses';

  return (
    <div className="page">
      <PageHeader title={t('nav.reports')} />
      <Tabs tabs={tabs} value={tab} onChange={selectTab} />
      {needsRange && (
        <Toolbar>
          <DateRangeFilter value={range} onChange={setRange} />
        </Toolbar>
      )}
      {tab === 'sales' && <SalesReport range={range} />}
      {tab === 'profit' && canCosts && <ProfitReport range={range} />}
      {tab === 'inventory' && <InventoryReport />}
      {tab === 'customers' && <CustomersReport />}
      {tab === 'capital' && canCosts && <CapitalReport />}
      {tab === 'expenses' && <ExpensesReport range={range} />}
    </div>
  );
}

function SalesReport({ range }: { range: DateRange }) {
  const { t, lang } = useI18n();
  const { tenantId } = useTenant();
  const data = useAsyncData(`${tenantId}|sales|${range.from}|${range.to}`, () => loadDailyStats(tenantId, range.from, range.to), { keep: true });

  if (data.error) return <Alert tone="error" onRetry={data.reload} retryLabel={t('common.retry')}>{t('error.loadFailed')}</Alert>;
  if (data.loading || !data.data) return <PageLoader />;
  const days = data.data;
  const total = sumStats(days);
  const net = netFigures(total);

  return (
    <div className="stack">
      {days.length >= DAILY_STATS_LIMIT && <Alert tone="warning">{t('reports.truncated')}</Alert>}
      <div className="stats">
        <StatCard icon="dollar" tone="success" label={t('reports.netSales')} value={formatUsd(net.netRevenue)} sub={t('dashboard.invoices', { count: total.salesCount })} />
        <StatCard icon="cart" label={t('reports.cashSales')} value={formatUsd(total.cashSalesUsdCents)} />
        <StatCard icon="users" tone="info" label={t('reports.creditSales')} value={formatUsd(total.creditSalesUsdCents)} />
        <StatCard icon="undo" tone="warning" label={t('reports.returns')} value={formatUsd(total.returnsUsdCents)} sub={t('dashboard.count', { count: total.returnsCount })} />
        <StatCard icon="tag" label={t('pos.discount')} value={formatUsd(total.discountUsdCents)} />
        <StatCard icon="tag" label={t('reports.checkoutDiscount')} value={formatUsd(total.checkoutDiscountUsdCents)} />
      </div>
      <Card
        title={t('reports.daily')}
        actions={
          <Button
            size="sm"
            variant="secondary"
            icon="download"
            onClick={() =>
              downloadCsv(
                `daily-${range.from}-${range.to}.csv`,
                [t('common.date'), t('reports.invoices'), t('reports.revenue'), t('reports.returns'), t('reports.cashSales'), t('reports.creditSales'), t('dashboard.debtCollected')],
                days.map((d) => [d.date, d.salesCount, (d.revenueUsdCents / 100).toFixed(2), (d.returnsUsdCents / 100).toFixed(2), (d.cashSalesUsdCents / 100).toFixed(2), (d.creditSalesUsdCents / 100).toFixed(2), (d.debtCollectedUsdCents / 100).toFixed(2)]),
              )
            }
          >
            CSV
          </Button>
        }
      >
        {days.length === 0 ? (
          <p className="muted">{t('common.noData')}</p>
        ) : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>{t('common.date')}</th>
                  <th className="num">{t('reports.invoices')}</th>
                  <th className="num">{t('reports.revenue')}</th>
                  <th className="num">{t('reports.returns')}</th>
                  <th className="num">{t('reports.cashSales')}</th>
                  <th className="num">{t('reports.creditSales')}</th>
                  <th className="num">{t('dashboard.debtCollected')}</th>
                </tr>
              </thead>
              <tbody>
                {[...days].reverse().map((d) => (
                  <tr key={d.date}>
                    <td>{formatDate(d.date, lang)}</td>
                    <td className="num">{d.salesCount}</td>
                    <td className="num">{formatUsd(d.revenueUsdCents)}</td>
                    <td className="num">{formatUsd(d.returnsUsdCents)}</td>
                    <td className="num">{formatUsd(d.cashSalesUsdCents)}</td>
                    <td className="num">{formatUsd(d.creditSalesUsdCents)}</td>
                    <td className="num">{formatUsd(d.debtCollectedUsdCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      <p className="muted small">{t('reports.rankingNeedsSummary')}</p>
    </div>
  );
}

function ProfitReport({ range }: { range: DateRange }) {
  const { t } = useI18n();
  const { tenantId } = useTenant();
  const data = useAsyncData(`${tenantId}|profit|${range.from}|${range.to}`, () => loadDailyStats(tenantId, range.from, range.to), { keep: true });
  const unknownCost = useAsyncData(`${tenantId}|unknown-cost`, () => catalogHasUnknownCost(tenantId), { keep: true });
  if (data.error) return <Alert tone="error" onRetry={data.reload} retryLabel={t('common.retry')}>{t('error.loadFailed')}</Alert>;
  if (data.loading || !data.data || unknownCost.loading) return <PageLoader />;
  const total = sumStats(data.data);
  const net = netFigures(total);
  const profitUnknown = unknownCost.data === true || !!unknownCost.error;
  const money = (cents: number) => (profitUnknown ? t('products.costUnknown') : formatUsd(cents));
  const margin = !profitUnknown && net.netRevenue > 0 ? ((net.grossProfit / net.netRevenue) * 100).toFixed(1) : '0.0';
  return (
    <div className="stack">
      <div className="stats">
        <StatCard icon="dollar" label={t('reports.netSales')} value={formatUsd(net.netRevenue)} />
        <StatCard icon="box" label={t('reports.costOfGoods')} value={money(net.netCost)} />
        <StatCard icon="chart" tone="success" label={t('reports.grossProfit')} value={money(net.grossProfit)} sub={profitUnknown ? t('products.costUnknown') : t('reports.margin', { value: margin })} />
        <StatCard icon="arrowUp" tone="warning" label={t('reports.expenses')} value={formatUsd(total.expensesUsdCents)} />
        <StatCard icon="check" tone={net.netProfit >= 0 ? 'success' : 'danger'} label={t('reports.netProfit')} value={money(net.netProfit)} />
      </div>
      <p className="muted small">{t('reports.profitHint')}</p>
    </div>
  );
}

function InventoryReport() {
  const { t } = useI18n();
  const { tenantId } = useTenant();
  const settings = useSettings();
  const [counts, setCounts] = useState<{ products: number; out: number; low: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      countWhere(tenantId, 'products', [where('status', '==', 'active')]),
      countWhere(tenantId, 'products', [where('status', '==', 'active'), where('stock', '==', 0)]),
      loadLowStock(tenantId, settings.lowStockThreshold),
    ])
      .then(([products, out, low]) => {
        if (!cancelled) setCounts({ products, out, low: low.complete ? String(low.items.length) : `${low.items.length}+` });
      })
      .catch((error: unknown) => console.error('[reports] inventory counts', error));
    return () => {
      cancelled = true;
    };
  }, [tenantId, settings.lowStockThreshold]);
  if (!counts) return <PageLoader />;
  return (
    <div className="stack">
      <div className="stats">
        <StatCard icon="box" label={t('reports.products')} value={counts.products} />
        <StatCard icon="alert" tone="warning" label={t('products.filterLow')} value={counts.low} />
        <StatCard icon="x" tone="danger" label={t('products.filterOut')} value={counts.out} />
      </div>
      <p className="muted small">{t('reports.valueUnavailable')}</p>
    </div>
  );
}

function CustomersReport() {
  const { t } = useI18n();
  const { tenantId } = useTenant();
  const [count, setCount] = useState<number | null>(null);
  const fetchPage = useCallback((cursor: QueryDocumentSnapshot | null) => pageCustomers(tenantId, { search: '', debtOnly: true }, cursor), [tenantId]);
  const debtors = usePagedQuery(`${tenantId}|report-debtors`, fetchPage);
  useEffect(() => {
    let cancelled = false;
    countWhere(tenantId, 'customers', [])
      .then((value) => {
        if (!cancelled) setCount(value);
      })
      .catch((error: unknown) => console.error('[reports] customers', error));
    return () => {
      cancelled = true;
    };
  }, [tenantId]);
  return (
    <div className="stack">
      <div className="stats">
        <StatCard icon="users" label={t('customers.count')} value={count ?? 0} />
        <StatCard icon="dollar" tone="danger" label={t('reports.debtors')} value={debtors.hasMore ? `${debtors.items.length}+` : debtors.items.length} />
      </div>
      <Card title={t('reports.debtors')}>
        <ul className="plain-list">
          {debtors.items.map((c) => (
            <li key={c.id} className="list-row">
              <span>{c.name}</span>
              <strong className={c.debtUsdCents > c.creditLimitUsdCents ? 'text-danger' : undefined}>{formatUsd(c.debtUsdCents)}</strong>
            </li>
          ))}
        </ul>
      </Card>
      <p className="muted small">{t('reports.valueUnavailable')}</p>
    </div>
  );
}

function CapitalReport() {
  const { t, lang } = useI18n();
  const cashbox = useCashbox().data;
  const settings = useSettings();
  const cash = cashbox.usdCents + lbpToUsdCents(cashbox.lbp, settings.exchangeRate);
  return (
    <div className="stack">
      <div className="stats">
        <StatCard icon="wallet" label={t('reports.cash')} value={formatUsd(cash)} sub={`${formatUsd(cashbox.usdCents)} + ${formatLbp(cashbox.lbp, lang)}`} />
        <StatCard icon="box" label={t('reports.stockAtCost')} value={t('reports.valueUnavailable')} />
        <StatCard icon="users" tone="info" label={t('reports.receivables')} value={t('reports.valueUnavailable')} />
        <StatCard icon="truck" tone="warning" label={t('reports.payables')} value={t('reports.valueUnavailable')} />
      </div>
      <p className="muted small">{t('reports.capitalHint')}</p>
    </div>
  );
}

function ExpensesReport({ range }: { range: DateRange }) {
  const { t, lang } = useI18n();
  const { tenantId } = useTenant();
  const stats = useAsyncData(`${tenantId}|expenses|${range.from}|${range.to}`, () => loadDailyStats(tenantId, range.from, range.to), { keep: true });
  const lines = useAsyncData(`${tenantId}|expense-lines|${range.from}|${range.to}`, () =>
    listCashTransactions(tenantId, { from: range.from, to: range.to, type: 'expense' }, null),
    { keep: true },
  );
  if (stats.error || lines.error) {
    return (
      <Alert tone="error" onRetry={() => { stats.reload(); lines.reload(); }} retryLabel={t('common.retry')}>
        {t('error.loadFailed')}
      </Alert>
    );
  }
  if (stats.loading || lines.loading || !stats.data || !lines.data) return <PageLoader />;
  const total = sumStats(stats.data).expensesUsdCents;
  const rows = lines.data.items;
  return (
    <div className="stack">
      <div className="stats">
        <StatCard icon="arrowUp" tone="warning" label={t('reports.totalExpenses')} value={formatUsd(total)} />
      </div>
      <Card
        title={t('reports.expenses')}
        actions={
          <Button
            size="sm"
            variant="secondary"
            icon="download"
            disabled={!rows.length}
            onClick={() =>
              downloadCsv(
                `expenses-${range.from}-${range.to}.csv`,
                [t('common.date'), t('cash.category'), 'USD', 'LBP', t('common.note'), t('common.user')],
                rows.map((x) => [x.localDate, x.category, (Math.abs(x.usdCents) / 100).toFixed(2), Math.abs(x.lbp), x.note, x.createdByName]),
              )
            }
          >
            {t('sales.exportPage')}
          </Button>
        }
      >
        {rows.length === 0 ? (
          <p className="muted">{t('common.noData')}</p>
        ) : (
          <ul className="plain-list">
            {rows.map((x) => (
              <li key={x.id} className="list-row">
                <span>
                  {formatDate(x.localDate, lang)} · {x.category || '—'} <span className="muted small">{x.note}</span>
                </span>
                <strong>{[x.usdCents ? formatUsd(Math.abs(x.usdCents)) : '', x.lbp ? formatLbp(Math.abs(x.lbp), lang) : ''].filter(Boolean).join(' + ')}</strong>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="muted small">{t('reports.rankingNeedsSummary')}</p>
    </div>
  );
}
