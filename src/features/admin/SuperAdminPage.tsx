import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ClientAssignmentPanel } from '@/features/admin/ClientAssignmentPanel';
import { LeadsPanel } from '@/features/admin/LeadsPanel';
import { StorageCleanupPanel } from '@/features/admin/StorageCleanupPanel';
import { cleanupOutcomeKey } from '@/features/admin/storageCleanupLabels';
import { TrialsPanel } from '@/features/admin/TrialsPanel';
import { FeatureCenterPanel } from '@/features/features/FeatureCenterPanel';
import { PreviewTestingPanel } from '@/features/admin/PreviewTestingPanel';
import { ReleaseManagementPanel } from '@/features/releases/ReleaseManagementPanel';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Form';
import { Alert, Badge, EmptyState, PageHeader, SearchBox, StatCard, TableWrap, Toolbar } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { useFeedback } from '@/contexts/feedback';
import { useSession } from '@/contexts/session';
import { reloadUser } from '@/services/authService';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useAsyncData } from '@/hooks/useAsyncData';
import { useI18n } from '@/i18n/i18n';
import { api, type AdminAccount, type SubscriptionAction } from '@/services/functionsClient';
import { subscriptionPhase, type SubscriptionPhase } from '@/domain/trial';
import { formatDate, normalizeSearch } from '@/utils/format';

type SubState = SubscriptionPhase;

function subState(a: AdminAccount, now: number): SubState {
  return subscriptionPhase(a.subscription, now);
}

const STATE_TONE: Record<SubState, 'success' | 'info' | 'warning' | 'danger'> = {
  active: 'success',
  lifetime: 'info',
  expired: 'warning',
  trial_expired: 'warning',
  inactive: 'danger',
};

export default function SuperAdminPage() {
  const { t, lang } = useI18n();
  const [params, setParams] = useSearchParams();
  const rawTab = params.get('tab');
  const tab =
    rawTab === 'releases' || rawTab === 'preview' || rawTab === 'features' || rawTab === 'leads' || rawTab === 'trials' || rawTab === 'cleanup' || rawTab === 'clients'
      ? rawTab
      : 'accounts';
  const [token, setToken] = useState(0);
  const accounts = useAsyncData(`admin|${token}`, async () => (await api.adminListAccounts({})).accounts);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<SubState | 'all'>('all');
  const [managing, setManaging] = useState<AdminAccount | null>(null);
  const [now] = useState(() => Date.now());

  const rows = useMemo(() => {
    const q = normalizeSearch(search);
    return (accounts.data ?? [])
      .filter((a) => filter === 'all' || subState(a, now) === filter)
      .filter((a) => !q || normalizeSearch(`${a.storeName} ${a.fullName} ${a.email} ${a.phone} ${a.subdomain}`).includes(q))
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }, [accounts.data, search, filter, now]);

  const counts = useMemo(() => {
    const c: Record<SubState, number> = { active: 0, lifetime: 0, expired: 0, trial_expired: 0, inactive: 0 };
    for (const a of accounts.data ?? []) c[subState(a, now)] += 1;
    return c;
  }, [accounts.data, now]);

  return (
    <div className="page">
      <PageHeader
        title={t('admin.title')}
        actions={
          <div className="row-gap">
            <Button variant={tab === 'accounts' ? 'primary' : 'secondary'} onClick={() => setParams({})}>
              {t('admin.accounts')}
            </Button>
            <Button variant={tab === 'leads' ? 'primary' : 'secondary'} onClick={() => setParams({ tab: 'leads' })}>
              {t('admin.leads')}
            </Button>
            <Button variant={tab === 'clients' ? 'primary' : 'secondary'} onClick={() => setParams({ tab: 'clients' })}>
              {t('admin.clients')}
            </Button>
            <Button variant={tab === 'trials' ? 'primary' : 'secondary'} onClick={() => setParams({ tab: 'trials' })}>
              {t('admin.trials')}
            </Button>
            <Button variant={tab === 'cleanup' ? 'primary' : 'secondary'} onClick={() => setParams({ tab: 'cleanup' })}>
              {t('admin.cleanup')}
            </Button>
            <Button variant={tab === 'preview' ? 'primary' : 'secondary'} onClick={() => setParams({ tab: 'preview' })}>
              {t('previewCenter.title')}
            </Button>
            <Button variant={tab === 'features' ? 'primary' : 'secondary'} onClick={() => setParams({ tab: 'features' })}>
              {t('feature.center')}
            </Button>
            <Button variant={tab === 'releases' ? 'primary' : 'secondary'} onClick={() => setParams({ tab: 'releases' })}>
              {t('release.title')}
            </Button>
            <Button variant="secondary" icon="refresh" onClick={() => setToken((n) => n + 1)}>
              {t('common.refresh')}
            </Button>
          </div>
        }
      />
      {tab === 'preview' ? (
        <PreviewTestingPanel />
      ) : tab === 'features' ? (
        <FeatureCenterPanel />
      ) : tab === 'releases' ? (
        <ReleaseManagementPanel />
      ) : tab === 'leads' ? (
        <LeadsPanel />
      ) : tab === 'clients' ? (
        <ClientAssignmentPanel />
      ) : tab === 'trials' ? (
        <TrialsPanel />
      ) : tab === 'cleanup' ? (
        <StorageCleanupPanel reloadKey={token} />
      ) : (
      <>
      <InternalDemoCard />

      <div className="stats">
        <StatCard icon="users" label={t('admin.accounts')} value={accounts.data?.length ?? '—'} />
        <StatCard icon="check" tone="success" label={t('admin.state.active')} value={counts.active} />
        <StatCard icon="shield" tone="info" label={t('admin.state.lifetime')} value={counts.lifetime} />
        <StatCard icon="clock" tone="warning" label={t('admin.state.expired')} value={counts.expired} />
        <StatCard icon="clock" tone="warning" label={t('admin.state.trial_expired')} value={counts.trial_expired} />
        <StatCard icon="x" tone="danger" label={t('admin.state.inactive')} value={counts.inactive} />
      </div>
      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder={t('admin.search')} />
        <select className="input" value={filter} onChange={(e) => setFilter(e.target.value as SubState | 'all')} aria-label={t('common.status')}>
          <option value="all">{t('common.all')}</option>
          {(Object.keys(STATE_TONE) as SubState[]).map((s) => (
            <option key={s} value={s}>
              {t(`admin.state.${s}`)}
            </option>
          ))}
        </select>
      </Toolbar>
      {accounts.error ? (
        <Alert tone="error" onRetry={accounts.reload} retryLabel={t('common.retry')}>
          {t('error.loadFailed')}
        </Alert>
      ) : accounts.loading ? (
        <PageLoader />
      ) : rows.length === 0 ? (
        <EmptyState icon="users" title={t('common.noResults')} />
      ) : (
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>{t('auth.storeName')}</th>
                <th>{t('admin.owner')}</th>
                <th className="hide-sm">{t('auth.phone')}</th>
                <th>{t('admin.subscription')}</th>
                <th className="hide-sm num">{t('admin.subUsers')}</th>
                <th className="hide-sm">{t('admin.lastSignIn')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const state = subState(a, now);
                return (
                  <tr key={a.uid}>
                    <td>
                      {a.storeName} {a.internalDemo && <Badge tone="info">{t('demo.badge')}</Badge>}
                      <div className="small muted" dir="ltr">
                        {a.subdomain}
                      </div>
                    </td>
                    <td>
                      {a.fullName}
                      <div className="small muted" dir="ltr">
                        {a.email}
                      </div>
                    </td>
                    <td className="hide-sm" dir="ltr">
                      {a.phone}
                    </td>
                    <td>
                      <Badge tone={STATE_TONE[state]}>{t(`admin.state.${state}`)}</Badge>
                      {state !== 'lifetime' && a.subscription.endsAt && (
                        <div className="small muted">{formatDate(a.subscription.endsAt, lang)}</div>
                      )}
                    </td>
                    <td className="hide-sm num">{a.subUserCount}</td>
                    <td className="hide-sm">{formatDate(a.lastSignInAt, lang)}</td>
                    <td className="actions-cell">
                      <Button size="sm" variant="secondary" icon="settings" onClick={() => setManaging(a)}>
                        {t('admin.manage')}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      )}
      {managing && (
        <ManageAccountModal
          account={managing}
          onClose={() => setManaging(null)}
          onChanged={() => {
            setManaging(null);
            setToken((n) => n + 1);
          }}
        />
      )}
      </>
      )}
    </div>
  );
}

/** The super admin's own internal demo store: open it, or create it once (server-checked). */
function InternalDemoCard() {
  const { t } = useI18n();
  const session = useSession();
  const navigate = useNavigate();
  const { confirm } = useFeedback();
  const { busy, run } = useAsyncAction('internal-demo');

  if (session.tenantId) {
    return (
      <Alert tone="info">
        {session.isInternalDemo ? t('demo.adminHasDemo') : t('demo.adminHasTenant')}{' '}
        <Button size="sm" variant="secondary" icon="cart" onClick={() => navigate('/dashboard')}>
          {t('demo.open')}
        </Button>
      </Alert>
    );
  }

  const create = async () => {
    const ok = await confirm({ title: t('demo.createTitle'), message: t('demo.createMessage') });
    if (!ok) return;
    await run(async () => {
      await api.adminProvisionInternalDemo({});
      await reloadUser();
      navigate('/dashboard');
    });
  };

  return (
    <Alert tone="info">
      {t('demo.adminNone')}{' '}
      <Button size="sm" variant="secondary" loading={busy} onClick={() => void create()}>
        {t('demo.create')}
      </Button>
    </Alert>
  );
}

function ManageAccountModal({ account, onClose, onChanged }: { account: AdminAccount; onClose: () => void; onChanged: () => void }) {
  const { t } = useI18n();
  const { notify, confirm } = useFeedback();
  const [days, setDays] = useState('30');
  const [deleteText, setDeleteText] = useState('');
  const { busy, run } = useAsyncAction('admin-subscription');

  const apply = async (action: SubscriptionAction) => {
    if (action.action === 'deactivate' || action.action === 'lifetime') {
      const ok = await confirm({ title: t(`admin.action.${action.action}`), message: account.storeName, danger: action.action === 'deactivate' });
      if (!ok) return;
    }
    await run(async () => {
      const result = await api.adminSetSubscription({ uid: account.uid, ...action });
      if (result.writesEnabled) notify('success', t('admin.accessEnabled'));
      else if (result.closed) notify('warning', t('admin.accessStillClosed'));
      else notify('warning', t('admin.accessDisabled'));
      onChanged();
    });
  };

  const dayCount = Number(days);
  const validDays = Number.isInteger(dayCount) && dayCount > 0 && dayCount <= 3660;

  return (
    <Modal open size="md" title={account.storeName} onClose={onClose} busy={busy}>
      <div className="stack">
        <div className="inline-form">
          <TextInput label={t('admin.days')} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
          <Button disabled={!validDays} loading={busy} onClick={() => void apply({ action: 'activate', days: dayCount })}>
            {t('admin.action.activate')}
          </Button>
          <Button variant="secondary" disabled={!validDays || busy} onClick={() => void apply({ action: 'extend', days: dayCount })}>
            {t('admin.action.extend')}
          </Button>
        </div>
        <div className="chips">
          {[30, 90, 180, 365].map((d) => (
            <button key={d} type="button" className={days === String(d) ? 'chip chip--active' : 'chip'} onClick={() => setDays(String(d))}>
              {t('admin.daysCount', { count: d })}
            </button>
          ))}
        </div>
        <div className="row-gap">
          <Button variant="success" icon="shield" disabled={busy} onClick={() => void apply({ action: 'lifetime' })}>
            {t('admin.action.lifetime')}
          </Button>
          <Button variant="danger" icon="lock" disabled={busy} onClick={() => void apply({ action: 'deactivate' })}>
            {t('admin.action.deactivate')}
          </Button>
        </div>
        <hr />
        <h3 className="section-title text-danger">{t('admin.deleteAccount')}</h3>
        <p className="muted small">{t('admin.deleteWarning')}</p>
        <div className="inline-form">
          <TextInput label={t('settings.typeToConfirm', { word: account.subdomain })} value={deleteText} onChange={(e) => setDeleteText(e.target.value)} dir="ltr" autoComplete="off" />
          <Button
            variant="danger"
            icon="trash"
            disabled={deleteText !== account.subdomain || busy}
            onClick={() =>
              void run(async () => {
                const result = await api.adminDeleteAccount({ uid: account.uid, confirm: account.subdomain });
                if (result.storageCleanup === 'complete') {
                  notify('success', t('admin.accountDeleted'));
                } else {
                  notify('warning', t('admin.storageCleanupPending'));
                  const retry = await confirm({ title: t('admin.retryStorageCleanup'), message: account.storeName });
                  if (retry) {
                    const again = await api.adminRetryStorageCleanup({ tenantId: result.tenantId });
                    notify(again.outcome === 'complete' ? 'success' : 'warning', t(cleanupOutcomeKey(again.outcome)));
                  }
                }
                onChanged();
              })
            }
          >
            {t('common.delete')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
