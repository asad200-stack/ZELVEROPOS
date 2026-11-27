import { useMemo, useState, type DragEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Alert, Badge, Card, EmptyState, SearchBox } from '@/components/ui/Layout';
import { PageLoader } from '@/components/ui/Spinner';
import { useFeedback } from '@/contexts/feedback';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useAsyncData } from '@/hooks/useAsyncData';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/services/functionsClient';
import { normalizeSearch } from '@/utils/format';

type Change = 'grant' | 'revoke';

/**
 * Super Admin feature board. Customers on one side, features on the other. Pick a customer, drag a
 * feature onto them (or tap +), drag it back off to remove, then Deploy: the server switches the
 * features on (or off) for that customer at once, with no click on their side.
 */
export function FeatureBoardPanel() {
  const { t } = useI18n();
  const { notify, confirm } = useFeedback();
  const [token, setToken] = useState(0);
  const board = useAsyncData(`feature-board|${token}`, () => api.adminFeatureBoard({}));
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [changes, setChanges] = useState<Record<string, Change>>({});
  const [over, setOver] = useState(false);
  const deploy = useAsyncAction('feature-board-deploy');

  const tenants = useMemo(() => {
    const q = normalizeSearch(search);
    return (board.data?.tenants ?? []).filter((x) => !q || normalizeSearch(`${x.storeName} ${x.email}`).includes(q));
  }, [board.data, search]);
  const tenant = board.data?.tenants.find((x) => x.tenantId === selected) ?? null;
  const features = board.data?.features ?? [];
  const has = (id: string) => tenant?.features[id] === 'active';
  const willHave = (id: string) => (changes[id] ? changes[id] === 'grant' : has(id));

  const choose = (id: string) => {
    setSelected(id);
    setChanges({});
  };
  const toggle = (id: string, want: boolean) =>
    setChanges((c) => {
      const next = { ...c };
      if (want === has(id)) delete next[id];
      else next[id] = want ? 'grant' : 'revoke';
      return next;
    });

  const onDropAdd = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const id = e.dataTransfer.getData('text/feature');
    const f = features.find((x) => x.id === id);
    if (!tenant || !f) return;
    if (!f.available) return notify('warning', t('board.notAvailable', { name: f.title }));
    toggle(id, true);
  };
  const onDropRemove = (e: DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/owned');
    if (id) toggle(id, false);
  };

  const pending = Object.entries(changes);
  const runDeploy = () =>
    deploy.run(async () => {
      if (!tenant || pending.length === 0) return;
      const names = pending.map(([id, c]) => `${c === 'grant' ? '+' : '−'} ${features.find((f) => f.id === id)?.title ?? id}`).join('\n');
      const ok = await confirm({ title: t('board.confirmTitle', { name: tenant.storeName || tenant.email }), message: names, confirmLabel: t('board.deploy') });
      if (!ok) return;
      await api.adminSetTenantFeatures({
        tenantId: tenant.tenantId,
        grant: pending.filter(([, c]) => c === 'grant').map(([id]) => id),
        revoke: pending.filter(([, c]) => c === 'revoke').map(([id]) => id),
        confirm: true,
      });
      notify('success', t('board.deployed', { name: tenant.storeName || tenant.email }));
      setChanges({});
      setToken((n) => n + 1);
    });

  if (board.loading && !board.data) return <PageLoader />;
  if (board.error) return <Alert tone="error" onRetry={() => setToken((n) => n + 1)}>{t('board.loadError')}</Alert>;

  return (
    <div className="feature-board" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
      <Card title={t('board.features')}>
        <div className="stack">
          {board.data?.killed && <Alert tone="warning">{t('board.killed')}</Alert>}
          <div className="card" style={{ padding: 12, opacity: 0.9 }}>
            <strong>{t('board.pos')}</strong> <Badge tone="success">{t('board.always')}</Badge>
            <div className="muted">{t('board.posHint')}</div>
          </div>
          {features.map((f) => (
            <div
              key={f.id}
              className="card"
              draggable={f.available && !!tenant}
              onDragStart={(e) => e.dataTransfer.setData('text/feature', f.id)}
              style={{ padding: 12, cursor: f.available && tenant ? 'grab' : 'default', opacity: f.available ? 1 : 0.55 }}
            >
              <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                <div>
                  <strong>{f.title}</strong> {f.base && <Badge tone="info">{t('board.base')}</Badge>}{' '}
                  {!f.available && <Badge tone="warning">{t(`board.blocked.${f.blockedReason ?? 'customerPath'}` as 'board.blocked.customerPath')}</Badge>}
                  <div className="muted">{f.description}</div>
                </div>
                {tenant && f.available && !willHave(f.id) && (
                  <Button size="sm" icon="plus" onClick={() => toggle(f.id, true)} aria-label={t('board.add')} />
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title={t('board.customers')}>
        <div className="stack">
          <SearchBox value={search} onChange={setSearch} placeholder={t('board.search')} />
          {tenant ? (
            <div
              className="card"
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={onDropAdd}
              style={{ padding: 12, outline: over ? '2px dashed var(--accent, #2ee6f6)' : '1px solid transparent' }}
            >
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{tenant.storeName || tenant.email}</strong>
                <Button variant="ghost" size="sm" onClick={() => choose('')}>
                  {t('board.change')}
                </Button>
              </div>
              <div className="muted">{tenant.email}</div>
              <p className="muted">{t('board.dropHere')}</p>
              <div className="stack">
                <div>
                  ✓ {t('board.pos')}
                </div>
                {features
                  .filter((f) => willHave(f.id) || changes[f.id] === 'revoke')
                  .map((f) => (
                    <div
                      key={f.id}
                      className="row"
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('text/owned', f.id)}
                      style={{ justifyContent: 'space-between', gap: 8, cursor: 'grab' }}
                    >
                      <span style={{ textDecoration: changes[f.id] === 'revoke' ? 'line-through' : undefined }}>
                        {changes[f.id] === 'grant' ? '＋' : changes[f.id] === 'revoke' ? '−' : '✓'} {f.title}
                      </span>
                      {changes[f.id] ? (
                        <Badge tone={changes[f.id] === 'grant' ? 'info' : 'warning'}>{t(changes[f.id] === 'grant' ? 'board.pendingAdd' : 'board.pendingRemove')}</Badge>
                      ) : (
                        <Button variant="ghost" size="sm" icon="x" onClick={() => toggle(f.id, false)} aria-label={t('board.remove')} />
                      )}
                    </div>
                  ))}
              </div>
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={onDropRemove}
                className="muted"
                style={{ marginTop: 12, padding: 8, border: '1px dashed currentColor', borderRadius: 8, textAlign: 'center' }}
              >
                {t('board.dropToRemove')}
              </div>
              <div className="row" style={{ marginTop: 12, gap: 8, justifyContent: 'flex-end' }}>
                {pending.length > 0 && (
                  <Button variant="secondary" onClick={() => setChanges({})} disabled={deploy.busy}>
                    {t('common.cancel')}
                  </Button>
                )}
                <Button icon="send" loading={deploy.busy} disabled={pending.length === 0} onClick={() => void runDeploy()}>
                  {t('board.deployCount', { count: pending.length })}
                </Button>
              </div>
            </div>
          ) : (
            <p className="muted">{t('board.pickCustomer')}</p>
          )}
          {tenants.length === 0 ? (
            <EmptyState title={t('board.noCustomers')} />
          ) : (
            tenants.map((x) => (
              <button
                key={x.tenantId}
                type="button"
                className="card"
                onClick={() => choose(x.tenantId)}
                style={{ padding: 10, textAlign: 'start', outline: x.tenantId === selected ? '2px solid var(--accent, #2ee6f6)' : undefined }}
              >
                <strong>{x.storeName || x.email}</strong> {x.internalDemo && <Badge>{t('board.demo')}</Badge>}
                <div className="muted">
                  {features.filter((f) => x.features[f.id] === 'active').map((f) => f.title).join(' · ') || t('board.onlyPos')}
                </div>
              </button>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
