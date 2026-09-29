import { useMemo, useState } from 'react';
import { DateRangeFilter } from '@/components/DateRangeFilter';
import { initialRange, type DateRange } from '@/domain/dates';
import { Button } from '@/components/ui/Button';
import { Alert, Card, EmptyState, PageHeader, StatCard, TableWrap, Tabs, Toolbar } from '@/components/ui/Layout';
import { PageLoader } from '@/components/ui/Spinner';
import { useTenant } from '@/contexts/session';
import { stockValue } from '@/domain/inventory';
import { lbpToUsdCents } from '@/domain/money';
import { useAsyncData } from '@/hooks/useAsyncData';
import { useCashbox, useCustomers, useProducts, useSettings, useSuppliers } from '@/hooks/useTenantData';
import { useI18n } from '@/i18n/i18n';
import { loadCashRange } from '@/services/cashboxService';
import { loadDailyStats, netFigures, sumStats } from '@/services/reportService';
import { loadSalesRange } from '@/services/salesService';
import { downloadCsv } from '@/utils/csv';
import { formatDate, formatLbp, formatUsd } from '@/utils/format';

type Tab = 'sales' | 'profit' | 'inventory' | 'customers' | 'capital' | 'expenses';

export default function ReportsPage() {
  const { t } = useI18n();
  const { can } = useTenant();
  const [tab, setTab] = useState<Tab>('sales');
  const [range, setRange] = useState<DateRange>(() => initialRange('month'));
  const canCosts = can('canViewCosts');

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
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
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
  const { tenantId, can } = useTenant();
  const data = useAsyncData(`${tenantId}|sales|${range.from}|${range.to}`, async () => {
    const [days, sales] = await Promise.all([loadDailyStats(tenantId, range.from, range.to), loadSalesRange(tenantId, range.from, range.to)]);
    return { days, ...sales };
  });

  const analysis = useMemo(() => {
    const products = new Map<string, { name: string; qty: number; revenue: number; cost: number }>();
    const cashiers = new Map<string, { name: string; count: number; revenue: number }>();
    for (const s of data.data?.sales ?? []) {
      for (const i of s.items) {
        const qty = i.quantity - i.returnedQty;
        if (qty <= 0) continue;
        const p = products.get(i.productId) ?? { name: i.name, qty: 0, revenue: 0, cost: 0 };
        p.qty += qty;
        p.revenue += qty * i.unitUsdCents;
        p.cost += qty * i.costUsdCents;
        products.set(i.productId, p);
      }
      const c = cashiers.get(s.createdBy) ?? { name: s.createdByName, count: 0, revenue: 0 };
      c.count += 1;
      c.revenue += s.totalUsdCents - s.returnedUsdCents;
      cashiers.set(s.createdBy, c);
    }
    return {
      top: [...products.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 20),
      cashiers: [...cashiers.values()].sort((a, b) => b.revenue - a.revenue),
    };
  }, [data.data]);

  if (data.error) return <Alert tone="error" onRetry={data.reload} retryLabel={t('common.retry')}>{t('error.loadFailed')}</Alert>;
  if (data.loading || !data.data) return <PageLoader />;
  const total = sumStats(data.data.days);
  const net = netFigures(total);

  return (
    <div className="stack">
      {data.data.truncated && <Alert tone="warning">{t('reports.truncated')}</Alert>}
      <div className="stats">
        <StatCard icon="dollar" tone="success" label={t('reports.netSales')} value={formatUsd(net.netRevenue)} sub={t('dashboard.invoices', { count: total.salesCount })} />
        <StatCard icon="cart" label={t('reports.cashSales')} value={formatUsd(total.cashSalesUsdCents)} />
        <StatCard icon="users" tone="info" label={t('reports.creditSales')} value={formatUsd(total.creditSalesUsdCents)} />
        <StatCard icon="undo" tone="warning" label={t('reports.returns')} value={formatUsd(total.returnsUsdCents)} sub={t('dashboard.count', { count: total.returnsCount })} />
        <StatCard icon="tag" label={t('pos.discount')} value={formatUsd(total.discountUsdCents)} />
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
                data.data!.days.map((d) => [d.date, d.salesCount, (d.revenueUsdCents / 100).toFixed(2), (d.returnsUsdCents / 100).toFixed(2), (d.cashSalesUsdCents / 100).toFixed(2), (d.creditSalesUsdCents / 100).toFixed(2), (d.debtCollectedUsdCents / 100).toFixed(2)]),
              )
            }
          >
            CSV
          </Button>
        }
      >
        {data.data.days.length === 0 ? (
          <EmptyState icon="chart" title={t('common.noData')} />
        ) : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>{t('common.date')}</th>
                  <th className="num">{t('reports.invoices')}</th>
                  <th className="num">{t('reports.revenue')}</th>
                  <th className="num">{t('reports.returns')}</th>
                  <th className="num">{t('dashboard.debtCollected')}</th>
                </tr>
              </thead>
              <tbody>
                {[...data.data.days].reverse().map((d) => (
                  <tr key={d.date}>
                    <td>{formatDate(d.date, lang)}</td>
                    <td className="num">{d.salesCount}</td>
                    <td className="num">{formatUsd(d.revenueUsdCents)}</td>
                    <td className="num">{formatUsd(d.returnsUsdCents)}</td>
                    <td className="num">{formatUsd(d.debtCollectedUsdCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      <div className="dashboard-grid">
        <Card title={t('reports.topProducts')}>
          {analysis.top.length === 0 ? (
            <p className="muted">{t('common.noData')}</p>
          ) : (
            <TableWrap>
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('pos.item')}</th>
                    <th className="num">{t('pos.qty')}</th>
                    <th className="num">{t('reports.revenue')}</th>
                    {can('canViewCosts') && <th className="num">{t('reports.grossProfit')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {analysis.top.map((p) => (
                    <tr key={p.name}>
                      <td>{p.name}</td>
                      <td className="num">{p.qty}</td>
                      <td className="num">{formatUsd(p.revenue)}</td>
                      {can('canViewCosts') && <td className="num">{formatUsd(p.revenue - p.cost)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
        <Card title={t('reports.byCashier')}>
          <ul className="plain-list">
            {analysis.cashiers.map((c) => (
              <li key={c.name} className="list-row">
                <span>
                  {c.name} <span className="muted small">({c.count})</span>
                </span>
                <strong>{formatUsd(c.revenue)}</strong>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function ProfitReport({ range }: { range: DateRange }) {
  const { t } = useI18n();
  const { tenantId } = useTenant();
  const data = useAsyncData(`${tenantId}|profit|${range.from}|${range.to}`, () => loadDailyStats(tenantId, range.from, range.to));
  if (data.error) return <Alert tone="error" onRetry={data.reload} retryLabel={t('common.retry')}>{t('error.loadFailed')}</Alert>;
  if (data.loading || !data.data) return <PageLoader />;
  const total = sumStats(data.data);
  const net = netFigures(total);
  const margin = net.netRevenue > 0 ? ((net.grossProfit / net.netRevenue) * 100).toFixed(1) : '0.0';
  return (
    <div className="stack">
      <div className="stats">
        <StatCard icon="dollar" label={t('reports.netSales')} value={formatUsd(net.netRevenue)} />
        <StatCard icon="box" label={t('reports.costOfGoods')} value={formatUsd(net.netCost)} />
        <StatCard icon="chart" tone="success" label={t('reports.grossProfit')} value={formatUsd(net.grossProfit)} sub={t('reports.margin', { value: margin })} />
        <StatCard icon="arrowUp" tone="warning" label={t('reports.expenses')} value={formatUsd(total.expensesUsdCents)} />
        <StatCard icon="check" tone={net.netProfit >= 0 ? 'success' : 'danger'} label={t('reports.netProfit')} value={formatUsd(net.netProfit)} />
      </div>
      <p className="muted small">{t('reports.profitHint')}</p>
    </div>
  );
}

function InventoryReport() {
  const { t } = useI18n();
  const { can } = useTenant();
  const products = useProducts();
  const settings = useSettings();
  const byCategory = useMemo(() => {
    const map = new Map<string, { count: number; units: number; cost: number; retail: number }>();
    for (const p of products.data) {
      const key = p.category || t('reports.uncategorized');
      const c = map.get(key) ?? { count: 0, units: 0, cost: 0, retail: 0 };
      c.count += 1;
      c.units += Math.max(0, p.stock);
      c.cost += Math.max(0, p.stock) * p.costUsdCents;
      c.retail += Math.max(0, p.stock) * p.prices.retail.usdCents;
      map.set(key, c);
    }
    return [...map.entries()].sort((a, b) => b[1].cost - a[1].cost);
  }, [products.data, t]);
  if (products.status === 'loading') return <PageLoader />;
  const canCosts = can('canViewCosts');
  const retailValue = products.data.reduce((s, p) => s + Math.max(0, p.stock) * p.prices.retail.usdCents, 0);
  return (
    <div className="stack">
      <div className="stats">
        <StatCard icon="box" label={t('reports.products')} value={products.data.length} />
        <StatCard icon="package" label={t('reports.units')} value={products.data.reduce((s, p) => s + Math.max(0, p.stock), 0)} />
        {canCosts && <StatCard icon="dollar" tone="info" label={t('reports.stockAtCost')} value={formatUsd(stockValue(products.data))} />}
        <StatCard icon="tag" tone="success" label={t('reports.stockAtRetail')} value={formatUsd(retailValue)} />
        <StatCard icon="alert" tone="warning" label={t('products.filterLow')} value={products.data.filter((p) => p.stock > 0 && p.stock <= (p.minStock ?? settings.lowStockThreshold)).length} />
        <StatCard icon="x" tone="danger" label={t('products.filterOut')} value={products.data.filter((p) => p.stock <= 0).length} />
      </div>
      <Card title={t('reports.byCategory')}>
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>{t('products.category')}</th>
                <th className="num">{t('reports.products')}</th>
                <th className="num">{t('reports.units')}</th>
                {canCosts && <th className="num">{t('reports.stockAtCost')}</th>}
                <th className="num">{t('reports.stockAtRetail')}</th>
              </tr>
            </thead>
            <tbody>
              {byCategory.map(([name, c]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td className="num">{c.count}</td>
                  <td className="num">{c.units}</td>
                  {canCosts && <td className="num">{formatUsd(c.cost)}</td>}
                  <td className="num">{formatUsd(c.retail)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </div>
  );
}

function CustomersReport() {
  const { t } = useI18n();
  const customers = useCustomers();
  if (customers.status === 'loading') return <PageLoader />;
  const top = [...customers.data].sort((a, b) => b.totalPurchasesUsdCents - a.totalPurchasesUsdCents).slice(0, 20);
  const debtors = customers.data.filter((c) => c.debtUsdCents > 0).sort((a, b) => b.debtUsdCents - a.debtUsdCents);
  const overLimit = debtors.filter((c) => c.debtUsdCents > c.creditLimitUsdCents);
  return (
    <div className="stack">
      <div className="stats">
        <StatCard icon="users" label={t('customers.count')} value={customers.data.length} />
        <StatCard icon="dollar" tone="danger" label={t('customers.totalDebt')} value={formatUsd(debtors.reduce((s, c) => s + c.debtUsdCents, 0))} sub={t('customers.debtorsCount', { count: debtors.length })} />
        <StatCard icon="alert" tone="warning" label={t('reports.overLimit')} value={overLimit.length} />
      </div>
      <div className="dashboard-grid">
        <Card title={t('reports.topCustomers')}>
          <ul className="plain-list">
            {top.map((c) => (
              <li key={c.id} className="list-row">
                <span>{c.name}</span>
                <strong>{formatUsd(c.totalPurchasesUsdCents)}</strong>
              </li>
            ))}
          </ul>
        </Card>
        <Card title={t('reports.debtors')}>
          <ul className="plain-list">
            {debtors.slice(0, 30).map((c) => (
              <li key={c.id} className="list-row">
                <span>{c.name}</span>
                <strong className={c.debtUsdCents > c.creditLimitUsdCents ? 'text-danger' : undefined}>{formatUsd(c.debtUsdCents)}</strong>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function CapitalReport() {
  const { t, lang } = useI18n();
  const products = useProducts().data;
  const customers = useCustomers().data;
  const suppliers = useSuppliers().data;
  const cashbox = useCashbox().data;
  const settings = useSettings();
  const stock = stockValue(products);
  const cash = cashbox.usdCents + lbpToUsdCents(cashbox.lbp, settings.exchangeRate);
  const receivables = customers.reduce((s, c) => s + c.debtUsdCents, 0);
  const payables = suppliers.reduce((s, x) => s + x.balanceUsdCents, 0);
  const capital = stock + cash + receivables - payables;
  return (
    <div className="stack">
      <div className="stats">
        <StatCard icon="box" label={t('reports.stockAtCost')} value={formatUsd(stock)} />
        <StatCard icon="wallet" label={t('reports.cash')} value={formatUsd(cash)} sub={`${formatUsd(cashbox.usdCents)} + ${formatLbp(cashbox.lbp, lang)}`} />
        <StatCard icon="users" tone="info" label={t('reports.receivables')} value={formatUsd(receivables)} />
        <StatCard icon="truck" tone="warning" label={t('reports.payables')} value={formatUsd(payables)} />
        <StatCard icon="chart" tone="success" label={t('reports.netCapital')} value={formatUsd(capital)} />
      </div>
      <p className="muted small">{t('reports.capitalHint')}</p>
    </div>
  );
}

function ExpensesReport({ range }: { range: DateRange }) {
  const { t, lang } = useI18n();
  const { tenantId } = useTenant();
  const settings = useSettings();
  const data = useAsyncData(`${tenantId}|expenses|${range.from}|${range.to}`, () => loadCashRange(tenantId, range.from, range.to, 'expense'));
  if (data.error) return <Alert tone="error" onRetry={data.reload} retryLabel={t('common.retry')}>{t('error.loadFailed')}</Alert>;
  if (data.loading || !data.data) return <PageLoader />;
  const rows = [...data.data].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  const byCategory = new Map<string, number>();
  for (const x of rows) {
    const key = x.category || t('reports.uncategorized');
    byCategory.set(key, (byCategory.get(key) ?? 0) + Math.abs(x.usdCents) + lbpToUsdCents(Math.abs(x.lbp), settings.exchangeRate));
  }
  const total = [...byCategory.values()].reduce((s, v) => s + v, 0);
  return (
    <div className="stack">
      <div className="stats">
        <StatCard icon="arrowUp" tone="warning" label={t('reports.totalExpenses')} value={formatUsd(total)} sub={t('dashboard.count', { count: rows.length })} />
      </div>
      <div className="dashboard-grid">
        <Card title={t('reports.byCategory')}>
          <ul className="plain-list">
            {[...byCategory.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => (
                <li key={k} className="list-row">
                  <span>{k}</span>
                  <strong>{formatUsd(v)}</strong>
                </li>
              ))}
          </ul>
        </Card>
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
              CSV
            </Button>
          }
        >
          {rows.length === 0 ? (
            <p className="muted">{t('common.noData')}</p>
          ) : (
            <ul className="plain-list">
              {rows.slice(0, 50).map((x) => (
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
      </div>
    </div>
  );
}
