import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '@/components/ui/Icon';
import { Alert, Badge, Card, PageHeader, StatCard } from '@/components/ui/Layout';
import { Spinner } from '@/components/ui/Spinner';
import { useSession, useTenant } from '@/contexts/session';
import { DEFAULTS } from '@/constants/app';
import { addDays, expiryState, localDate } from '@/domain/dates';
import { isLowStock } from '@/domain/inventory';
import { useAsyncData } from '@/hooks/useAsyncData';
import { useResource } from '@/stores/tenantStore';
import { useI18n } from '@/i18n/i18n';
import { emptyStats, loadDailyStats, netFigures } from '@/services/reportService';
import { formatDate, formatLbp, formatUsd } from '@/utils/format';

export default function DashboardPage() {
  const { t, lang } = useI18n();
  const { tenantId, can, isOwner } = useTenant();
  const { profile, subscription } = useSession();
  const canReports = can('canViewReports');
  const canProducts = can('canViewProducts');
  const canCustomers = can('canViewCustomers');
  const canCash = can('canManageCashDrawer');
  const canCosts = can('canViewCosts');
  const [now] = useState(() => Date.now());

  const today = localDate(new Date(now));
  const from = addDays(today, -6);
  const stats = useAsyncData(canReports ? `${tenantId}|${from}|${today}` : null, () => loadDailyStats(tenantId, from, today));

  const week = useMemo(() => {
    const byDate = new Map((stats.data ?? []).map((s) => [s.date, s]));
    return Array.from({ length: 7 }, (_, i) => byDate.get(addDays(from, i)) ?? emptyStats(addDays(from, i)));
  }, [stats.data, from]);
  const todayStats = week[6];
  const todayNet = netFigures(todayStats);
  const maxRevenue = Math.max(1, ...week.map((d) => d.revenueUsdCents - d.returnsUsdCents));

  return (
    <div className="page">
      <PageHeader
        title={t('dashboard.welcome', { name: profile?.fullName ?? '' })}
        subtitle={formatDate(today, lang)}
        actions={
          can('canSell') && (
            <Link to="/pos" className="btn btn--primary btn--md">
              {t('dashboard.openPos')}
            </Link>
          )
        }
      />

      {isOwner && subscription && !subscription.lifetime && subscription.endsAt && subscription.endsAt - now < 7 * 86_400_000 && (
        <Alert tone="warning">{t('dashboard.subscriptionEnding', { date: formatDate(subscription.endsAt, lang) })}</Alert>
      )}

      {canReports && (
        <>
          {stats.error ? (
            <Alert tone="error" onRetry={stats.reload} retryLabel={t('common.retry')}>
              {t('error.loadFailed')}
            </Alert>
          ) : stats.loading ? (
            <Spinner />
          ) : (
            <>
              <div className="stats">
                <StatCard icon="dollar" tone="success" label={t('dashboard.todaySales')} value={formatUsd(todayNet.netRevenue)} sub={t('dashboard.invoices', { count: todayStats.salesCount })} />
                {canCosts && <StatCard icon="chart" tone="info" label={t('dashboard.todayProfit')} value={formatUsd(todayNet.grossProfit)} />}
                <StatCard icon="undo" tone="warning" label={t('dashboard.todayReturns')} value={formatUsd(todayStats.returnsUsdCents)} sub={t('dashboard.count', { count: todayStats.returnsCount })} />
                <StatCard icon="users" label={t('dashboard.debtCollected')} value={formatUsd(todayStats.debtCollectedUsdCents)} />
              </div>
              <Card title={t('dashboard.last7Days')}>
                <div className="bars" role="img" aria-label={t('dashboard.last7Days')}>
                  {week.map((d) => {
                    const net = d.revenueUsdCents - d.returnsUsdCents;
                    return (
                      <div key={d.date} className="bars__col" title={`${formatDate(d.date, lang)}: ${formatUsd(net)}`}>
                        <div className="bars__value">{net > 0 ? formatUsd(net).replace(/\.\d\d$/, '') : ''}</div>
                        <div className="bars__bar" style={{ height: `${Math.max(2, (Math.max(0, net) / maxRevenue) * 100)}%` }} />
                        <div className="bars__label">{d.date.slice(5)}</div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </>
          )}
        </>
      )}

      <div className="dashboard-grid">
        {canCash && <CashboxCard tenantId={tenantId} />}
        {canProducts && <StockCard tenantId={tenantId} />}
        {canCustomers && <DebtorsCard tenantId={tenantId} />}
      </div>
    </div>
  );
}

function CashboxCard({ tenantId }: { tenantId: string }) {
  const { t, lang } = useI18n();
  const cashbox = useResource(tenantId, 'cashbox').data;
  return (
    <Card title={t('nav.cashbox')} actions={<Link to="/cashbox">{t('common.viewAll')}</Link>}>
      <div className="big-number">{formatUsd(cashbox.usdCents)}</div>
      <div className="big-number big-number--sub">{formatLbp(cashbox.lbp, lang)}</div>
    </Card>
  );
}

function StockCard({ tenantId }: { tenantId: string }) {
  const { t } = useI18n();
  const products = useResource(tenantId, 'products');
  const settings = useResource(tenantId, 'settings').data;
  const low = products.data.filter((p) => isLowStock(p, settings.lowStockThreshold)).sort((a, b) => a.stock - b.stock);
  const expiring = products.data.filter((p) => ['expired', 'soon'].includes(expiryState(p.expiryDate, DEFAULTS.expirySoonDays))).length;
  return (
    <Card title={t('dashboard.lowStock', { count: low.length })} actions={<Link to="/products">{t('common.viewAll')}</Link>}>
      {products.status === 'loading' ? (
        <Spinner />
      ) : low.length === 0 ? (
        <p className="muted">{t('dashboard.stockOk')}</p>
      ) : (
        <ul className="plain-list">
          {low.slice(0, 8).map((p) => (
            <li key={p.id} className="list-row">
              <span>{p.name}</span>
              <Badge tone={p.stock <= 0 ? 'danger' : 'warning'}>{p.stock}</Badge>
            </li>
          ))}
        </ul>
      )}
      {expiring > 0 && (
        <Link to="/expiry" className="btn btn--ghost btn--sm">
          <Icon name="calendar" size={15} />
          <span>{t('dashboard.expiring', { count: expiring })}</span>
        </Link>
      )}
    </Card>
  );
}

function DebtorsCard({ tenantId }: { tenantId: string }) {
  const { t } = useI18n();
  const customers = useResource(tenantId, 'customers');
  const debtors = customers.data.filter((c) => c.debtUsdCents > 0).sort((a, b) => b.debtUsdCents - a.debtUsdCents);
  const total = debtors.reduce((s, c) => s + c.debtUsdCents, 0);
  return (
    <Card title={t('dashboard.topDebtors', { total: formatUsd(total) })} actions={<Link to="/customers">{t('common.viewAll')}</Link>}>
      {debtors.length === 0 ? (
        <p className="muted">{t('dashboard.noDebts')}</p>
      ) : (
        <ul className="plain-list">
          {debtors.slice(0, 8).map((c) => (
            <li key={c.id} className="list-row">
              <span>{c.name}</span>
              <strong>{formatUsd(c.debtUsdCents)}</strong>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
