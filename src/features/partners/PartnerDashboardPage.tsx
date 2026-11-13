import { useMemo, useState } from 'react';
import { Alert, Badge, EmptyState, PageHeader, SearchBox, StatCard, TableWrap, Toolbar } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { PageLoader } from '@/components/ui/Spinner';
import { useAsyncData } from '@/hooks/useAsyncData';
import { useI18n } from '@/i18n/i18n';
import { api, type PartnerClientRow } from '@/services/functionsClient';
import { formatDate, normalizeSearch } from '@/utils/format';

type SubState = PartnerClientRow['subscriptionStatus'];

const STATE_TONE: Record<SubState, 'success' | 'info' | 'warning' | 'danger'> = {
  active: 'success',
  trial: 'info',
  expired: 'warning',
  unknown: 'danger',
};

/**
 * Marketing Partner dashboard: only this partner's assigned customer stores, only the fields the
 * spec allows (store name, signup date, subscription status, activation status, contact only when
 * explicitly authorized). Everything else — POS data, other tenants, Super Admin tooling — is
 * simply not reachable: the server (partnerListMyClients) never returns it in the first place.
 */
export default function PartnerDashboardPage() {
  const { t, lang } = useI18n();
  const [token, setToken] = useState(0);
  const clients = useAsyncData(`partner-clients|${token}`, async () => (await api.partnerListMyClients({})).clients);
  const [search, setSearch] = useState('');

  const rows = useMemo(() => {
    const q = normalizeSearch(search);
    return (clients.data ?? []).filter((c) => !q || normalizeSearch(c.storeName).includes(q)).sort((a, b) => (b.signupAtMs ?? 0) - (a.signupAtMs ?? 0));
  }, [clients.data, search]);

  const activeCount = (clients.data ?? []).filter((c) => c.activationStatus === 'active').length;

  return (
    <div className="page">
      <PageHeader
        title={t('partner.myClients')}
        subtitle={t('partner.myClientsHint')}
        actions={
          <Button variant="secondary" icon="refresh" onClick={() => setToken((n) => n + 1)}>
            {t('common.refresh')}
          </Button>
        }
      />

      <div className="stats">
        <StatCard icon="users" label={t('partner.myClients')} value={clients.data?.length ?? '—'} />
        <StatCard icon="check" tone="success" label={t('partner.activeStores')} value={activeCount} />
      </div>

      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder={t('admin.search')} />
      </Toolbar>

      {clients.error ? (
        <Alert tone="error" onRetry={clients.reload} retryLabel={t('common.retry')}>
          {t('error.loadFailed')}
        </Alert>
      ) : clients.loading ? (
        <PageLoader />
      ) : rows.length === 0 ? (
        <EmptyState icon="users" title={t('common.noResults')} message={t('partner.noClientsYet')} />
      ) : (
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>{t('auth.storeName')}</th>
                <th>{t('common.created')}</th>
                <th>{t('admin.subscription')}</th>
                <th>{t('partner.activation')}</th>
                <th>{t('partner.contact')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.tenantId}>
                  <td>{c.storeName || '—'}</td>
                  <td>{formatDate(c.signupAtMs, lang)}</td>
                  <td>
                    <Badge tone={STATE_TONE[c.subscriptionStatus]}>{t(`admin.state.${c.subscriptionStatus}`)}</Badge>
                  </td>
                  <td>
                    <Badge tone={c.activationStatus === 'active' ? 'success' : 'danger'}>
                      {t(c.activationStatus === 'active' ? 'partner.active' : 'partner.inactive')}
                    </Badge>
                  </td>
                  <td>
                    {c.contact ? (
                      <span className="small" dir="ltr">
                        {c.contact.email || c.contact.phone || '—'}
                      </span>
                    ) : (
                      <span className="muted small">{t('partner.contactNotAuthorized')}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </div>
  );
}
