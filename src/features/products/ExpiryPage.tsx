import { useMemo, useState } from 'react';
import { Badge, EmptyState, PageHeader, StatCard, TableWrap, Tabs } from '@/components/ui/Layout';
import { PageLoader } from '@/components/ui/Spinner';
import { DEFAULTS } from '@/constants/app';
import { daysUntil, expiryState, type ExpiryState } from '@/domain/dates';
import { useProducts } from '@/hooks/useTenantData';
import { useI18n } from '@/i18n/i18n';
import { formatDate } from '@/utils/format';

type Tab = 'expired' | 'soon' | 'ok';

export default function ExpiryPage() {
  const { t, lang } = useI18n();
  const state = useProducts();
  const products = state.data;
  const [tab, setTab] = useState<Tab>('expired');

  const groups = useMemo(() => {
    const g: Record<Exclude<ExpiryState, 'none'>, typeof products> = { expired: [], soon: [], ok: [] };
    for (const p of products) {
      const s = expiryState(p.expiryDate, DEFAULTS.expirySoonDays);
      if (s !== 'none') g[s].push(p);
    }
    for (const list of Object.values(g)) list.sort((a, b) => (a.expiryDate ?? '').localeCompare(b.expiryDate ?? ''));
    return g;
  }, [products]);

  if (state.status === 'loading') return <PageLoader />;
  const list = groups[tab];

  return (
    <div className="page">
      <PageHeader title={t('nav.expiry')} subtitle={t('expiry.subtitle', { days: DEFAULTS.expirySoonDays })} />
      <div className="stats">
        <StatCard icon="alert" tone="danger" label={t('expiry.expired')} value={groups.expired.length} />
        <StatCard icon="clock" tone="warning" label={t('expiry.soon')} value={groups.soon.length} />
        <StatCard icon="check" tone="success" label={t('expiry.ok')} value={groups.ok.length} />
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'expired', label: `${t('expiry.expired')} (${groups.expired.length})` },
          { value: 'soon', label: `${t('expiry.soon')} (${groups.soon.length})` },
          { value: 'ok', label: `${t('expiry.ok')} (${groups.ok.length})` },
        ]}
      />
      {list.length === 0 ? (
        <EmptyState icon="calendar" title={t('common.noData')} />
      ) : (
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
              {list.map((p) => {
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
      )}
    </div>
  );
}
