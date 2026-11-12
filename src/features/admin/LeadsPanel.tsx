import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Alert, Badge, EmptyState, SearchBox, TableWrap, Toolbar } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { useFeedback } from '@/contexts/feedback';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useAsyncData } from '@/hooks/useAsyncData';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/services/functionsClient';
import { formatDate, normalizeSearch } from '@/utils/format';

const STATUSES = ['NEW', 'CONTACTED', 'DEMO', 'TRIAL', 'QUOTE', 'WON', 'LOST'] as const;

export function LeadsPanel() {
  const { t, lang } = useI18n();
  const { notify } = useFeedback();
  const [token, setToken] = useState(0);
  const leads = useAsyncData(`leads|${token}`, async () => (await api.adminListLeads({})).leads);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<string>('all');
  type LeadRow = NonNullable<typeof leads.data>[number];
  const [open, setOpen] = useState<LeadRow | null>(null);
  const { busy, run } = useAsyncAction('lead-status');

  const rows = useMemo(() => {
    const q = normalizeSearch(search);
    return (leads.data ?? [])
      .filter((l) => filter === 'all' || l.status === filter)
      .filter((l) => !q || normalizeSearch(`${l.name} ${l.businessName} ${l.email} ${l.source}`).includes(q));
  }, [leads.data, search, filter]);

  return (
    <>
      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder={t('admin.search')} />
        <select className="input" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={t('common.status')}>
          <option value="all">{t('common.all')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <Button variant="secondary" icon="refresh" onClick={() => setToken((n) => n + 1)}>
          {t('common.refresh')}
        </Button>
      </Toolbar>
      {leads.error ? (
        <Alert tone="error" onRetry={leads.reload} retryLabel={t('common.retry')}>
          {t('error.loadFailed')}
        </Alert>
      ) : leads.loading ? (
        <PageLoader />
      ) : rows.length === 0 ? (
        <EmptyState icon="users" title={t('common.noResults')} />
      ) : (
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>{t('admin.lead')}</th>
                <th>{t('admin.business')}</th>
                <th>{t('admin.source')}</th>
                <th>{t('common.status')}</th>
                <th>{t('common.created')}</th>
                <th>{t('admin.assignedTo')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} onClick={() => setOpen(l)} style={{ cursor: 'pointer' }}>
                  <td>
                    {l.name}
                    <div className="small muted" dir="ltr">
                      {l.email}
                    </div>
                  </td>
                  <td>{l.businessName}</td>
                  <td>{l.source}</td>
                  <td>
                    <Badge tone="info">{l.status}</Badge>
                  </td>
                  <td>{formatDate(l.createdAt, lang)}</td>
                  <td>{l.assignedTo || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {open && (
        <Modal open title={open.businessName || open.name} onClose={() => setOpen(null)} busy={busy}>
          <div className="stack">
            <p>
              {open.name} · {open.email} · {open.phone}
            </p>
            <p className="muted small">{open.notes}</p>
            <p className="muted small">{open.interestedFeatures.join(', ')}</p>
            <label className="field">
              {t('common.status')}
              <select
                className="input"
                defaultValue={open.status}
                onChange={(e) => {
                  const status = e.target.value;
                  void run(async () => {
                    await api.adminSetLeadStatus({ leadId: open.id, status });
                    notify('success', t('common.saved'));
                    setOpen(null);
                    setToken((n) => n + 1);
                  });
                }}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Modal>
      )}
    </>
  );
}
