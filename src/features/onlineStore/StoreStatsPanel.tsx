import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Alert, Card, EmptyState, PageHeader } from '@/components/ui/Layout';
import { PageLoader } from '@/components/ui/Spinner';
import { STATS_RANGES, type StatsRange, type StoreStatsTotals } from '@/domain/onlineStore';
import { useAsyncData } from '@/hooks/useAsyncData';
import type { TranslationKey } from '@/i18n/en';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/services/functionsClient';
import { formatUsd } from '@/utils/format';

const FUNNEL: { key: keyof StoreStatsTotals; label: TranslationKey }[] = [
  { key: 'visits', label: 'onlineOrders.stats.visits' },
  { key: 'views', label: 'onlineOrders.stats.views' },
  { key: 'adds', label: 'onlineOrders.stats.adds' },
  { key: 'checkouts', label: 'onlineOrders.stats.checkouts' },
  { key: 'orders', label: 'onlineOrders.stats.orders' },
];

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : 0;
}

/** Owner analytics: anonymous storefront counters for the last 7 or 30 shop days. */
export default function StoreStatsPanel() {
  const { t } = useI18n();
  const [days, setDays] = useState<StatsRange>(7);
  const data = useAsyncData(`online-store-stats:${days}`, () => api.onlineStoreStats({ days }), { keep: true });
  const s = data.data;
  const peak = s ? Math.max(1, ...s.days.map((d) => d.visits)) : 1;

  return (
    <div className="stack">
      <PageHeader
        title={t('onlineOrders.stats.title')}
        subtitle={t('onlineOrders.stats.subtitle')}
        actions={
          <div style={{ display: 'flex', gap: 8 }} role="group" aria-label={t('onlineOrders.stats.range')}>
            {STATS_RANGES.map((r) => (
              <Button key={r} size="sm" variant={days === r ? 'primary' : 'secondary'} aria-pressed={days === r} onClick={() => setDays(r)}>
                {t('onlineOrders.stats.lastDays', { days: r })}
              </Button>
            ))}
            <Button variant="secondary" size="sm" icon="refresh" onClick={data.reload} loading={data.loading}>
              {t('onlineOrders.refresh')}
            </Button>
          </div>
        }
      />
      {data.loading && !s ? (
        <PageLoader />
      ) : data.error || !s ? (
        <Alert tone="error" onRetry={data.reload} retryLabel={t('common.retry')}>
          {t('onlineOrders.stats.loadError')}
        </Alert>
      ) : s.totals.visits === 0 && s.totals.orders === 0 ? (
        <EmptyState icon="receipt" title={t('onlineOrders.stats.empty')} message={t('onlineOrders.stats.emptyMessage')} />
      ) : (
        <>
          <div className="os-stats-kpis">
            <Card className="os-stat">
              <span className="muted">{t('onlineOrders.stats.visits')}</span>
              <strong>{s.totals.visits.toLocaleString('en')}</strong>
            </Card>
            <Card className="os-stat">
              <span className="muted">{t('onlineOrders.stats.orders')}</span>
              <strong>{s.totals.orders.toLocaleString('en')}</strong>
            </Card>
            <Card className="os-stat">
              <span className="muted">{t('onlineOrders.stats.revenue')}</span>
              <strong>{formatUsd(s.totals.revenueUsdCents)}</strong>
            </Card>
            <Card className="os-stat">
              <span className="muted">{t('onlineOrders.stats.conversion')}</span>
              <strong>{s.conversionPct === null ? '—' : `${s.conversionPct}%`}</strong>
            </Card>
          </div>

          {s.sales && (
            <Card title={t('onlineOrders.split.title')}>
              <div className="os-split">
                <div className="os-split-bar" role="img" aria-label={t('onlineOrders.split.share', { pct: s.sales.onlinePct ?? 0 })}>
                  <span className="os-split-online" style={{ inlineSize: `${s.sales.onlinePct ?? 0}%` }} />
                </div>
                <div className="os-split-legend">
                  <div>
                    <span className="os-split-dot os-split-dot--online" aria-hidden="true" />
                    <span>{t('onlineOrders.split.online')}</span>
                    <strong>{formatUsd(s.sales.onlineUsdCents)}</strong>
                    <span className="muted">
                      {t('onlineOrders.split.orders', { count: s.sales.onlineOrders })}
                      {s.sales.onlinePct !== null ? ` · ${s.sales.onlinePct}%` : ''}
                    </span>
                  </div>
                  <div>
                    <span className="os-split-dot" aria-hidden="true" />
                    <span>{t('onlineOrders.split.store')}</span>
                    <strong>{formatUsd(s.sales.storeUsdCents)}</strong>
                    <span className="muted">
                      {t('onlineOrders.split.sales', { count: s.sales.storeSales })}
                      {s.sales.onlinePct !== null ? ` · ${100 - s.sales.onlinePct}%` : ''}
                    </span>
                  </div>
                </div>
              </div>
              <p className="muted" style={{ margin: 0 }}>
                {t('onlineOrders.split.hint')}
              </p>
            </Card>
          )}

          {s.sales && (
            <Card title={t('onlineOrders.split.topOrdered')}>
              {s.sales.topOrdered.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>
                  {t('onlineOrders.split.noOrders')}
                </p>
              ) : (
                <ol className="os-top">
                  {s.sales.topOrdered.map((p) => (
                    <li key={p.productId}>
                      <bdi>{p.name}</bdi>
                      <b>
                        {t('onlineOrders.split.qty', { count: p.qty })} · {formatUsd(p.usdCents)}
                      </b>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          )}

          <Card title={t('onlineOrders.stats.funnel')}>
            <ol className="os-funnel">
              {FUNNEL.map((f) => (
                <li key={f.key}>
                  <span>{t(f.label)}</span>
                  <span className="os-funnel-bar" aria-hidden="true">
                    <span style={{ inlineSize: `${pct(s.totals[f.key], s.totals.visits || 1)}%` }} />
                  </span>
                  <b>{s.totals[f.key].toLocaleString('en')}</b>
                </li>
              ))}
            </ol>
          </Card>

          <Card title={t('onlineOrders.stats.daily')}>
            <div className="os-days" role="list">
              {s.days.map((d) => (
                <div
                  key={d.date}
                  role="listitem"
                  className="os-day"
                  title={t('onlineOrders.stats.dayTip', { date: d.date, visits: d.visits, orders: d.orders })}
                >
                  <span className="os-day-bar" style={{ blockSize: `${pct(d.visits, peak)}%` }}>
                    {d.orders > 0 ? <span className="os-day-dot" /> : null}
                  </span>
                  <span className="os-day-label">{d.date.slice(8)}</span>
                </div>
              ))}
            </div>
            <p className="muted" style={{ margin: 0 }}>
              {t('onlineOrders.stats.dailyHint')}
            </p>
          </Card>

          <Card title={t('onlineOrders.stats.topViewed')}>
            {s.topViewed.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                {t('onlineOrders.stats.noViews')}
              </p>
            ) : (
              <ol className="os-top">
                {s.topViewed.map((p) => (
                  <li key={p.productId}>
                    <span>{s.names[p.productId] || t('onlineOrders.stats.removedProduct')}</span>
                    <b>{t('onlineOrders.stats.viewsCount', { count: p.views })}</b>
                  </li>
                ))}
              </ol>
            )}
          </Card>
          <p className="muted" style={{ margin: 0 }}>
            {t('onlineOrders.stats.privacy')}
          </p>
        </>
      )}
    </div>
  );
}
