import { useMemo, useState } from 'react';
import { Alert, Badge, EmptyState, SearchBox, TableWrap, Toolbar } from '@/components/ui/Layout';
import { PageLoader } from '@/components/ui/Spinner';
import { useAsyncData } from '@/hooks/useAsyncData';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/services/functionsClient';
import { formatDate, normalizeSearch } from '@/utils/format';

export function TrialsPanel() {
  const { t, lang } = useI18n();
  const [search, setSearch] = useState('');
  const trials = useAsyncData('trials', async () => (await api.adminListTrials({})).trials);
  const rows = useMemo(() => {
    const q = normalizeSearch(search);
    return (trials.data ?? []).filter(
      (row) => !q || normalizeSearch(`${row.business} ${row.owner} ${row.ownerEmail} ${row.referralCode ?? ''}`).includes(q),
    );
  }, [trials.data, search]);

  return (
    <>
      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder={t('admin.search')} />
      </Toolbar>
      {trials.error ? (
        <Alert tone="error" onRetry={trials.reload} retryLabel={t('common.retry')}>
          {t('error.loadFailed')}
        </Alert>
      ) : trials.loading ? (
        <PageLoader />
      ) : rows.length === 0 ? (
        <EmptyState icon="clock" title={t('common.noResults')} />
      ) : (
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>{t('admin.business')}</th>
                <th>{t('admin.owner')}</th>
                <th>{t('date.from')}</th>
                <th>{t('date.to')}</th>
                <th>{t('admin.daysRemaining')}</th>
                <th>{t('common.status')}</th>
                <th>{t('admin.referral')}</th>
                <th>{t('admin.conversion')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.tenantId}>
                  <td>{row.business}</td>
                  <td>
                    {row.owner}
                    <div className="small muted" dir="ltr">
                      {row.ownerEmail}
                    </div>
                  </td>
                  <td>{formatDate(row.startDate, lang)}</td>
                  <td>{formatDate(row.endDate, lang)}</td>
                  <td className="num">{row.daysRemaining}</td>
                  <td>
                    <Badge tone={row.status === 'trial' ? 'info' : 'warning'}>{row.status}</Badge>
                  </td>
                  <td>{row.referralCode || '—'}</td>
                  <td>{row.converted ? 'converted' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </>
  );
}
