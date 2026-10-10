import { useCallback, useEffect, useMemo, useState } from 'react';
import { where, type QueryDocumentSnapshot } from 'firebase/firestore';
import { Badge, EmptyState, PageHeader, StatCard, TableWrap, Tabs } from '@/components/ui/Layout';
import { PageLoader } from '@/components/ui/Spinner';
import { DEFAULTS } from '@/constants/app';
import { addDays, daysUntil, localDate } from '@/domain/dates';
import { emptyProductQuery } from '@/domain/catalogPlan';
import { usePagedQuery } from '@/hooks/usePagedQuery';
import { useTenant } from '@/contexts/session';
import { useI18n } from '@/i18n/i18n';
import { countWhere, pageProducts } from '@/services/catalogQuery';
import { formatDate } from '@/utils/format';

type Tab = 'expired' | 'soon' | 'ok';

export default function ExpiryPage() {
  const { t, lang } = useI18n();
  const { tenantId } = useTenant();
  const [tab, setTab] = useState<Tab>('expired');
  const today = localDate();
  const soon = addDays(today, DEFAULTS.expirySoonDays);
  const expiryFrom = tab === 'expired' ? '0000-01-01' : tab === 'soon' ? today : addDays(soon, 1);
  const expiryTo = tab === 'expired' ? addDays(today, -1) : tab === 'soon' ? soon : undefined;
  const spec = useMemo(() => emptyProductQuery({ mode: 'expiry', expiryFrom, expiryTo }), [expiryFrom, expiryTo]);
  const fetchPage = useCallback((cursor: QueryDocumentSnapshot | null) => pageProducts(tenantId, spec, cursor), [tenantId, spec]);
  const page = usePagedQuery(`${tenantId}|expiry|${tab}|${today}`, fetchPage);
  const [counts, setCounts] = useState<Record<Tab, number>>({ expired: 0, soon: 0, ok: 0 });

  useEffect(() => {
    let cancelled = false;
    const count = (from: string, to?: string) =>
      countWhere(tenantId, 'products', [
        where('expiryDate', '>=', from),
        ...(to ? [where('expiryDate', '<=', to)] : []),
      ]);
    Promise.all([count('0000-01-01', addDays(today, -1)), count(today, soon), count(addDays(soon, 1))])
      .then(([expired, soonCount, ok]) => {
        if (!cancelled) setCounts({ expired, soon: soonCount, ok });
      })
      .catch((error: unknown) => console.error('[expiry] counts', error));
    return () => {
      cancelled = true;
    };
  }, [tenantId, today, soon]);

  if (page.loading) return <PageLoader />;

  return (
    <div className="page">
      <PageHeader title={t('nav.expiry')} subtitle={t('expiry.subtitle', { days: DEFAULTS.expirySoonDays })} />
      <div className="stats">
        <StatCard icon="alert" tone="danger" label={t('expiry.expired')} value={counts.expired} />
        <StatCard icon="clock" tone="warning" label={t('expiry.soon')} value={counts.soon} />
        <StatCard icon="check" tone="success" label={t('expiry.ok')} value={counts.ok} />
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'expired', label: `${t('expiry.expired')} (${counts.expired})` },
          { value: 'soon', label: `${t('expiry.soon')} (${counts.soon})` },
          { value: 'ok', label: `${t('expiry.ok')} (${counts.ok})` },
        ]}
      />
      {page.items.length === 0 ? (
        <EmptyState icon="calendar" title={t('common.noData')} />
      ) : (
        <>
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>{t('products.name')}</th>
                  <th>{t('products.category')}</th>
                  <th className="num">{t('products.stock')}</th>
                  <th>{t('products.expiryDate')}</th>
                  <th className="num">{t('expiry.daysLeft')}</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((p) => {
                  const days = daysUntil(p.expiryDate ?? '') ?? 0;
                  return (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td>{p.category || '—'}</td>
                      <td className="num">{p.stock}</td>
                      <td>{formatDate(p.expiryDate, lang)}</td>
                      <td className="num">
                        <Badge tone={days < 0 ? 'danger' : days <= DEFAULTS.expirySoonDays ? 'warning' : 'success'}>{days}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
          {page.hasMore && (
            <div className="load-more">
              <button type="button" className="btn btn--secondary" onClick={() => void page.loadMore()}>
                {t('common.loadMore')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
