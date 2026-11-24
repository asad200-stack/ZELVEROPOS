import { useCallback, useMemo, useState } from 'react';
import { where, type QueryDocumentSnapshot } from 'firebase/firestore';
import { Link } from 'react-router';
import { Icon } from '@/components/ui/Icon';
import { Alert, Badge, Card, PageHeader, StatCard } from '@/components/ui/Layout';
import { Spinner } from '@/components/ui/Spinner';
import { useSession, useTenant } from '@/contexts/session';
import { addDays, localDate } from '@/domain/dates';
import { useAsyncData } from '@/hooks/useAsyncData';
import { usePagedQuery } from '@/hooks/usePagedQuery';
import { countWhere, loadLowStock, pageCustomers } from '@/services/catalogQuery';
import { useResource } from '@/stores/tenantStore';
import { OnboardingCard } from '@/features/account/OnboardingCard';
import { TrialReadOnlyBanner } from '@/features/account/TrialBanner';
import { useI18n } from '@/i18n/i18n';
import { emptyStats, loadDailyStats, netFigures } from '@/services/reportService';
import { catalogHasUnknownCost } from '@/services/productService';
import { formatDate, formatLbp, formatUsd } from '@/utils/format';

export default function DashboardPage() {
  const { t, lang } = useI18n();
  const { tenantId, can, isOwner } = useTenant();
  const { profile, subscription, writesEnabled } = useSession();
  const canReports = can('canViewReports');
  const canProducts = can('canViewProducts');
  const canCustomers = can('canViewCustomers');
  const canCash = can('canManageCashDrawer');
  const canCosts = can('canViewCosts');
  const [now] = useState(() => Date.now());

  const today = localDate(new Date(now));
  const from = addDays(today, -6);
  const stats = useAsyncData(canReports ? `${tenantId}|${from}|${today}` : null, () => loadDailyStats(tenantId, from, today), {
    keep: true,
  });
  const unknownCost = useAsyncData(canReports && canCosts ? `${tenantId}|unknown-cost` : null, () => catalogHasUnknownCost(tenantId), {
    keep: true,
  });
  const profitUnknown = unknownCost.data === true || !!unknownCost.error;

  const week = useMemo(() => {
    const byDate = new Map((stats.data ?? []).map((s) => [s.date, s]));
    return Array.from({ length: 7 }, (_, i) => byDate.get(addDays(from, i)) ?? emptyStats(addDays(from, i)));
  }, [stats.data, from]);
  const todayStats = week[6];
  const todayNet = netFigures(todayStats);
  // Same net figure as the "Today's net sales" card: checkout discounts and returns are subtracted.
  const maxRevenue = Math.max(1, ...week.map((d) => netFigures(d).netRevenue));

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

      <TrialReadOnlyBanner />
      <OnboardingCard />
      {isOwner && writesEnabled && subscription && !subscription.lifetime && !subscription.trial && subscription.endsAt && subscription.endsAt - now < 7 * 86_400_000 && (
        <Alert tone="warning">{t('dashboard.subscriptionEnding', { date: formatDate(subscription.endsAt, lang) })}</Alert>
      )}

      {canReports && (
        <>
          {stats.error ? (
            <Alert tone="error" onRetry={stats.reload} retryLabel={t('common.retry')}>
              {t('error.loadFailed')}
            </Alert>
          ) : stats.loading || (canCosts && unknownCost.loading) ? (
            <Spinner />
          ) : (
            <>
              <div className="stats">
                <StatCard icon="dollar" tone="success" label={t('dashboard.todaySales')} value={formatUsd(todayNet.netRevenue)} sub={t('dashboard.invoices', { count: todayStats.salesCount })} />
                {canCosts && <StatCard icon="chart" tone="info" label={t('dashboard.todayProfit')} value={profitUnknown ? t('products.costUnknown') : formatUsd(todayNet.grossProfit)} />}
                <StatCard icon="undo" tone="warning" label={t('dashboard.todayReturns')} value={formatUsd(todayStats.returnsUsdCents)} sub={t('dashboard.count', { count: todayStats.returnsCount })} />
                <StatCard icon="users" label={t('dashboard.debtCollected')} value={formatUsd(todayStats.debtCollectedUsdCents)} />
              </div>
              <Card title={t('dashboard.last7Days')}>
                <div className="bars" role="img" aria-label={t('dashboard.last7Days')}>
                  {week.map((d) => {
                    const net = netFigures(d).netRevenue;
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
  const settings = useResource(tenantId, 'settings').data;
  const threshold = settings.lowStockThreshold;
  const stock = useAsyncData(`${tenantId}|dash-low|${threshold}`, async () => {
    const [low, out] = await Promise.all([
      loadLowStock(tenantId, threshold),
      countWhere(tenantId, 'products', [where('status', '==', 'active'), where('stock', '==', 0)]),
    ]);
    return { low, out };
  }, { keep: true });
  const lowItems = stock.data?.low.items ?? [];
  const lowCount = stock.data ? (stock.data.low.complete ? String(lowItems.length) : `${lowItems.length}+`) : '…';
  const shown = lowItems.slice(0, 8);
  const out = stock.data?.out ?? 0;
  return (
    <Card title={t('dashboard.lowStock', { count: lowCount })} actions={<Link to="/products">{t('common.viewAll')}</Link>}>
      {stock.loading ? (
        <Spinner />
      ) : stock.error ? (
        <Alert tone="error" onRetry={stock.reload} retryLabel={t('common.retry')}>{t('error.loadFailed')}</Alert>
      ) : shown.length === 0 && out === 0 ? (
        <p className="muted">{t('dashboard.stockOk')}</p>
      ) : (
        <>
          {shown.length > 0 && (
            <ul className="plain-list">
              {shown.map((p) => (
                <li key={p.id} className="list-row">
                  <span>{p.name}</span>
                  <Badge tone="warning">{p.stock}</Badge>
                </li>
              ))}
            </ul>
          )}
          {out > 0 && (
            <p className="list-row">
              <span>{t('dashboard.outOfStock')}</span>
              <Badge tone="danger">{out}</Badge>
            </p>
          )}
        </>
      )}
      <Link to="/expiry" className="btn btn--ghost btn--sm">
        <Icon name="calendar" size={15} />
        <span>{t('nav.expiry')}</span>
      </Link>
    </Card>
  );
}

function DebtorsCard({ tenantId }: { tenantId: string }) {
  const { t } = useI18n();
  const fetchPage = useCallback((cursor: QueryDocumentSnapshot | null) => pageCustomers(tenantId, { search: '', debtOnly: true }, cursor), [tenantId]);
  const page = usePagedQuery(`${tenantId}|dash-debt`, fetchPage);
  const debtors = page.items.slice(0, 8);
  return (
    <Card title={t('dashboard.topDebtors', { total: page.hasMore ? `${debtors.length}+` : String(debtors.length) })} actions={<Link to="/customers">{t('common.viewAll')}</Link>}>
      {debtors.length === 0 ? (
        <p className="muted">{t('dashboard.noDebts')}</p>
      ) : (
        <ul className="plain-list">
          {debtors.map((c) => (
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
