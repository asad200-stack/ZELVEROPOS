import { useMemo, useState } from 'react';
import { Alert, Badge, EmptyState, SearchBox, TableWrap, Toolbar } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Checkbox, FormGrid, SelectInput, TextInput } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { useFeedback } from '@/contexts/feedback';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useAsyncData } from '@/hooks/useAsyncData';
import { useI18n } from '@/i18n/i18n';
import {
  api,
  type ClientAssignmentAuditEntry,
  type ClientAssignmentRow,
  type MarketingPartnerRow,
} from '@/services/functionsClient';
import { formatDate, normalizeSearch } from '@/utils/format';

type Group = 'all' | 'mine' | 'partner' | 'unassigned';

const SUB_TONE: Record<ClientAssignmentRow['subscriptionStatus'], 'success' | 'info' | 'warning' | 'danger'> = {
  active: 'success',
  trial: 'info',
  expired: 'warning',
  unknown: 'danger',
};

function referralLink(code: string): string {
  if (typeof window === 'undefined') return `/signup?ref=${code}`;
  return `${window.location.origin}/signup?ref=${code}`;
}

export function ClientAssignmentPanel() {
  const { t } = useI18n();
  const [token, setToken] = useState(0);
  const [group, setGroup] = useState<Group>('all');
  const [search, setSearch] = useState('');
  const [assigning, setAssigning] = useState<ClientAssignmentRow | null>(null);
  const [history, setHistory] = useState<ClientAssignmentRow | null>(null);
  const [grantOpen, setGrantOpen] = useState(false);

  const assignments = useAsyncData(`client-assignments|${group}|${token}`, async () => (await api.adminListClientAssignments({ group })).rows);
  const partners = useAsyncData(`partners|${token}`, async () => (await api.adminListPartners({})).partners);
  const activePartners = useMemo(() => (partners.data ?? []).filter((p) => p.active), [partners.data]);
  const partnerName = (id: string | null) => (id ? (partners.data ?? []).find((p) => p.uid === id)?.name || id : '—');

  const rows = useMemo(() => {
    const q = normalizeSearch(search);
    return (assignments.data ?? []).filter(
      (r) => !q || normalizeSearch(`${r.storeName} ${r.ownerEmail} ${r.ownerName}`).includes(q),
    );
  }, [assignments.data, search]);

  const reload = () => setToken((n) => n + 1);

  return (
    <div className="stack">
      <PartnersSection partners={partners.data ?? []} loading={partners.loading} error={partners.error} onChanged={reload} onGrant={() => setGrantOpen(true)} />

      <Toolbar>
        <SelectInput
          label={t('admin.clients')}
          value={group}
          onChange={(e) => setGroup(e.target.value as Group)}
          options={[
            { value: 'all', label: t('admin.clients.all') },
            { value: 'mine', label: t('admin.clients.mine') },
            { value: 'partner', label: t('admin.clients.marketing') },
            { value: 'unassigned', label: t('admin.clients.unassigned') },
          ]}
        />
        <SearchBox value={search} onChange={setSearch} placeholder={t('admin.search')} />
        <Button variant="secondary" icon="refresh" onClick={reload}>
          {t('common.refresh')}
        </Button>
      </Toolbar>

      {assignments.error ? (
        <Alert tone="error" onRetry={assignments.reload} retryLabel={t('common.retry')}>
          {t('error.loadFailed')}
        </Alert>
      ) : assignments.loading ? (
        <PageLoader />
      ) : rows.length === 0 ? (
        <EmptyState icon="users" title={t('common.noResults')} />
      ) : (
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>{t('auth.storeName')}</th>
                <th className="hide-sm">{t('admin.owner')}</th>
                <th>{t('admin.subscription')}</th>
                <th>{t('admin.clients.acquisition')}</th>
                <th>{t('admin.clients.assignedTo')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.tenantId}>
                  <td>
                    {r.storeName || '—'}
                    <div className="small muted" dir="ltr">
                      {r.tenantId}
                    </div>
                  </td>
                  <td className="hide-sm">
                    {r.ownerName}
                    <div className="small muted" dir="ltr">
                      {r.ownerEmail}
                    </div>
                  </td>
                  <td>
                    <Badge tone={SUB_TONE[r.subscriptionStatus]}>{t(`admin.state.${r.subscriptionStatus}`)}</Badge>
                  </td>
                  <td>
                    <Badge tone="default">{t(`admin.clients.acquisition.${r.acquisition.source}`)}</Badge>
                    {r.acquisition.source === 'referral' && <div className="small muted">{partnerName(r.acquisition.partnerId)}</div>}
                  </td>
                  <td>
                    {r.assignedTo === 'superAdmin' ? (
                      <Badge tone="info">{t('admin.clients.assignedTo.superAdmin')}</Badge>
                    ) : r.assignedTo === 'partner' ? (
                      <Badge tone="success">{partnerName(r.assignedPartnerId)}</Badge>
                    ) : (
                      <Badge tone="danger">{t('admin.clients.assignedTo.none')}</Badge>
                    )}
                  </td>
                  <td className="actions-cell">
                    <Button size="sm" variant="secondary" icon="users" onClick={() => setAssigning(r)}>
                      {r.assignedTo ? t('admin.clients.transfer') : t('admin.clients.assign')}
                    </Button>
                    <Button size="sm" variant="ghost" icon="history" onClick={() => setHistory(r)}>
                      {t('admin.clients.history')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}

      {assigning && (
        <AssignModal row={assigning} partners={activePartners} onClose={() => setAssigning(null)} onChanged={() => { setAssigning(null); reload(); }} />
      )}
      {history && <HistoryModal row={history} partnerName={partnerName} onClose={() => setHistory(null)} />}
      {grantOpen && <GrantPartnerModal onClose={() => setGrantOpen(false)} onChanged={() => { setGrantOpen(false); reload(); }} />}
    </div>
  );
}

function PartnersSection({
  partners,
  loading,
  error,
  onChanged,
  onGrant,
}: {
  partners: MarketingPartnerRow[];
  loading: boolean;
  error: unknown;
  onChanged: () => void;
  onGrant: () => void;
}) {
  const { t } = useI18n();
  const { notify, confirm } = useFeedback();
  const { busy, run } = useAsyncAction('partner-revoke');
  const backfill = useAsyncAction('clients-backfill');

  const runBackfill = async () => {
    const ok = await confirm({
      title: t('admin.clients.backfill'),
      message: t('admin.clients.backfillConfirm'),
    });
    if (!ok) return;
    await backfill.run(async () => {
      const result = await api.adminBackfillClientAssignments({});
      notify('success', t('admin.clients.backfillResult', { scanned: result.scanned, created: result.created, skipped: result.skipped }));
      onChanged();
    });
  };

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(referralLink(code));
      notify('success', t('admin.partners.linkCopied'));
    } catch {
      /* clipboard unavailable (older browser, insecure context) — the link is still shown as text */
    }
  };

  const revoke = async (p: MarketingPartnerRow) => {
    const ok = await confirm({
      title: t('admin.partners.confirmRevokeTitle'),
      message: t('admin.partners.confirmRevokeMessage', { name: p.name }),
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      await api.revokeMarketingPartner({ partnerId: p.uid });
      notify('success', t('common.saved'));
      onChanged();
    });
  };

  return (
    <div className="card">
      <div className="card__header">
        <h2 className="card__title">{t('admin.partners')}</h2>
        <div className="card__actions">
          <Button size="sm" variant="secondary" icon="refresh" loading={backfill.busy} onClick={() => void runBackfill()}>
            {t('admin.clients.backfill')}
          </Button>
          <Button size="sm" icon="plus" onClick={onGrant}>
            {t('admin.partners.grant')}
          </Button>
        </div>
      </div>
      <div className="card__body">
        {error ? (
          <Alert tone="error">{t('error.loadFailed')}</Alert>
        ) : loading ? (
          <PageLoader />
        ) : partners.length === 0 ? (
          <EmptyState icon="users" title={t('admin.partners.empty')} />
        ) : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>{t('admin.partners.name')}</th>
                  <th className="hide-sm">{t('admin.partners.email')}</th>
                  <th>{t('admin.partners.referralLink')}</th>
                  <th>{t('common.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {partners.map((p) => (
                  <tr key={p.uid}>
                    <td>{p.name}</td>
                    <td className="hide-sm small muted" dir="ltr">
                      {p.email}
                    </td>
                    <td>
                      <Button size="sm" variant="ghost" icon="clipboard" onClick={() => void copy(p.referralCode)}>
                        {t('admin.partners.copyLink')}
                      </Button>
                    </td>
                    <td>
                      <Badge tone={p.active ? 'success' : 'danger'}>{t(p.active ? 'admin.partners.active' : 'admin.partners.revoked')}</Badge>
                    </td>
                    <td className="actions-cell">
                      {p.active && (
                        <Button size="sm" variant="danger" icon="lock" loading={busy} onClick={() => void revoke(p)}>
                          {t('admin.partners.revoke')}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </div>
    </div>
  );
}

function GrantPartnerModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const { t } = useI18n();
  const { notify } = useFeedback();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [contactAuthorized, setContactAuthorized] = useState(false);
  const { busy, run } = useAsyncAction('partner-grant');

  const valid = email.trim().includes('@') && name.trim().length > 0;

  return (
    <Modal open title={t('admin.partners.grantTitle')} onClose={onClose} busy={busy}>
      <div className="stack">
        <TextInput label={t('admin.partners.email')} hint={t('admin.partners.emailHint')} type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextInput label={t('admin.partners.name')} value={name} onChange={(e) => setName(e.target.value)} />
        <Checkbox label={t('admin.partners.contactAuthorized')} checked={contactAuthorized} onChange={(e) => setContactAuthorized(e.target.checked)} />
        <Button
          disabled={!valid || busy}
          loading={busy}
          onClick={() =>
            void run(async () => {
              await api.grantMarketingPartner({ email: email.trim(), name: name.trim(), contactAuthorized });
              notify('success', t('common.saved'));
              onChanged();
            })
          }
        >
          {t('admin.partners.grant')}
        </Button>
      </div>
    </Modal>
  );
}

function AssignModal({
  row,
  partners,
  onClose,
  onChanged,
}: {
  row: ClientAssignmentRow;
  partners: MarketingPartnerRow[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const { notify, confirm } = useFeedback();
  const [target, setTarget] = useState<'superAdmin' | 'partner'>(row.assignedTo === 'partner' ? 'superAdmin' : 'partner');
  const [partnerId, setPartnerId] = useState(partners[0]?.uid ?? '');
  const { busy, run } = useAsyncAction('client-assign');

  const apply = async () => {
    const chosenPartner = partners.find((p) => p.uid === partnerId);
    const confirmString = target === 'partner' ? `ASSIGN ${row.tenantId} TO PARTNER ${partnerId}` : `ASSIGN ${row.tenantId} TO MYSELF`;
    const ok = await confirm({
      title: row.assignedTo ? t('admin.clients.transfer') : t('admin.clients.assign'),
      message: target === 'partner' ? t('admin.clients.confirmAssignPartner', { store: row.storeName, partner: chosenPartner?.name ?? partnerId }) : t('admin.clients.confirmAssignMyself', { store: row.storeName }),
    });
    if (!ok) return;
    await run(async () => {
      await api.adminAssignClient({ tenantId: row.tenantId, assignTo: target, partnerId: target === 'partner' ? partnerId : undefined, confirm: confirmString });
      notify('success', t('common.saved'));
      onChanged();
    });
  };

  return (
    <Modal open title={row.storeName || row.tenantId} onClose={onClose} busy={busy}>
      <div className="stack">
        <FormGrid cols={1}>
          <label className="field">
            <input type="radio" name="assign-target" checked={target === 'superAdmin'} onChange={() => setTarget('superAdmin')} /> {t('admin.clients.assignToMyself')}
          </label>
          <label className="field">
            <input type="radio" name="assign-target" checked={target === 'partner'} disabled={partners.length === 0} onChange={() => setTarget('partner')} /> {t('admin.clients.assignToPartner')}
          </label>
        </FormGrid>
        {target === 'partner' &&
          (partners.length === 0 ? (
            <Alert tone="warning">{t('admin.clients.noPartners')}</Alert>
          ) : (
            <SelectInput
              label={t('admin.clients.selectPartner')}
              value={partnerId}
              onChange={(e) => setPartnerId(e.target.value)}
              options={partners.map((p) => ({ value: p.uid, label: p.name }))}
            />
          ))}
        <Button disabled={busy || (target === 'partner' && !partnerId)} loading={busy} onClick={() => void apply()}>
          {row.assignedTo ? t('admin.clients.transfer') : t('admin.clients.assign')}
        </Button>
      </div>
    </Modal>
  );
}

function HistoryModal({
  row,
  partnerName,
  onClose,
}: {
  row: ClientAssignmentRow;
  partnerName: (id: string | null) => string;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const entries = useAsyncData(`client-history|${row.tenantId}`, async () => (await api.adminListClientAssignmentAudit({ tenantId: row.tenantId })).entries);

  return (
    <Modal open size="lg" title={t('admin.clients.historyTitle', { store: row.storeName || row.tenantId })} onClose={onClose}>
      {entries.loading ? (
        <PageLoader />
      ) : (entries.data ?? []).length === 0 ? (
        <EmptyState icon="history" title={t('admin.clients.historyEmpty')} />
      ) : (
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>{t('common.created')}</th>
                <th>{t('common.status')}</th>
                <th>{t('admin.clients.assignedTo')}</th>
              </tr>
            </thead>
            <tbody>
              {(entries.data as ClientAssignmentAuditEntry[]).map((e) => (
                <tr key={e.id}>
                  <td>{formatDate(e.atMs, lang)}</td>
                  <td>{e.action}</td>
                  <td>{e.partnerId ? partnerName(e.partnerId) : t('admin.clients.assignedTo.superAdmin')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Modal>
  );
}
