import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import { Alert, Badge, Card, EmptyState, TableWrap } from '@/components/ui/Layout';
import { PageLoader } from '@/components/ui/Spinner';
import { useFeedback } from '@/contexts/feedback';
import { useSession } from '@/contexts/session';
import { reloadUser } from '@/services/authService';
import { isEligibleCustomer, type CustomerAccount } from '@/domain/featureRelease';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useAsyncData } from '@/hooks/useAsyncData';
import { isTranslationKey, useI18n } from '@/i18n/i18n';
import { api, type AdminAccount, type FeatureCatalogItem } from '@/services/functionsClient';
import { formatMoney } from '@/utils/format';

const TONE = {
  internal_testing: 'info',
  ready: 'success',
  published: 'success',
  paused: 'warning',
  rolled_back: 'danger',
} as const;

function asCustomer(account: AdminAccount): CustomerAccount {
  return {
    tenantId: account.tenantId || account.uid,
    storeName: account.storeName,
    internalDemo: account.internalDemo === true,
    activated: account.subscription.activated,
    lifetime: account.subscription.lifetime,
    endsAt: account.subscription.endsAt,
  };
}

export function FeatureCenterPanel() {
  const { t } = useI18n();
  const session = useSession();
  const navigate = useNavigate();
  const { notify, confirm } = useFeedback();
  const [token, setToken] = useState(0);
  const catalog = useAsyncData(`features|${token}`, async () => api.listFeatureCatalog({}));
  const accounts = useAsyncData(`feature-accounts|${token}`, async () => (await api.adminListAccounts({})).accounts);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [allEligible, setAllEligible] = useState(false);
  const action = useAsyncAction('feature-center');
  const features = catalog.data?.features ?? [];
  const selected = features.find((feature) => feature.id === selectedId) ?? features[0] ?? null;
  const delivery = catalog.data?.delivery.find((row) => row.featureId === selected?.id);

  const [now, setNow] = useState(() => Date.now());
  const eligible = useMemo(() => {
    return (accounts.data ?? []).map(asCustomer).filter((account) => isEligibleCustomer(account, now));
  }, [accounts.data, now]);

  const say = (key: string) => (isTranslationKey(key) ? t(key) : key);
  const reload = () => {
    setToken((value) => value + 1);
    setNow(Date.now());
  };
  const run = async (fn: () => Promise<{ duplicate?: boolean; ok?: true } | null>) => {
    const result = await action.run(fn);
    if (!result) return;
    notify('success', result.duplicate ? t('feature.duplicate') : t('feature.saved'));
    reload();
  };

  if (catalog.loading && !catalog.data) return <PageLoader />;
  if (catalog.error) {
    return (
      <Alert tone="error" onRetry={catalog.reload} retryLabel={t('common.retry')}>
        {t('error.loadFailed')}
      </Alert>
    );
  }
  if (!selected) return <EmptyState icon="box" title={t('feature.empty')} />;

  const customerBlocked = selected.customerExecution !== 'ready';
  const price =
    selected.pricing === 'paid' && selected.priceUsdCents != null ? formatMoney(selected.priceUsdCents, 'USD') : t('feature.free');

  return (
    <div className="stack">
      {catalog.data?.killed ? <Alert tone="error">{t('feature.killOn')}</Alert> : null}
      <div className="row-gap">
        {features.map((feature) => (
          <Button key={feature.id} variant={feature.id === selected.id ? 'primary' : 'secondary'} onClick={() => setSelectedId(feature.id)}>
            {feature.title}
          </Button>
        ))}
      </div>
      <Card>
        <div className="row-gap">
          <h2>{selected.title}</h2>
          <Badge tone={TONE[selected.publication]}>{t(`feature.status.${selected.publication}`)}</Badge>
          <Badge tone={selected.pricing === 'paid' ? 'warning' : 'info'}>{price}</Badge>
        </div>
        <p>{selected.description}</p>
        <p className="muted small">
          {t('feature.version')} {selected.version} · {t(`feature.class.${selected.classification}`)} · {selected.category}
        </p>
        <p>{selected.capabilities.join(' · ')}</p>
        <p className="muted small">
          {t('feature.requirements')}: {selected.requirements.join(' · ')} · {selected.compatibility}
        </p>
        {customerBlocked ? <Alert tone="warning">{t('feature.customerBlocked')}</Alert> : null}
        {selected.blockers.length > 0 ? (
          <ul>
            {selected.blockers.map((blocker) => (
              <li key={blocker}>{say(blocker)}</li>
            ))}
          </ul>
        ) : (
          <p>{t('feature.readyToPublish')}</p>
        )}
        {delivery ? (
          <p className="small">
            {t('feature.delivery', {
              notified: delivery.notified,
              active: delivery.active,
              paused: delivery.paused,
            })}
          </p>
        ) : null}
      </Card>

      <Card>
        <h3>{t('feature.noticePreview')}</h3>
        <Notice feature={selected} price={price} />
      </Card>

      <Card>
        <h3>{t('feature.customers')}</h3>
        <label className="row-gap">
          <input
            type="checkbox"
            checked={allEligible}
            onChange={(event) => setAllEligible(event.target.checked)}
            disabled={customerBlocked}
          />
          {t('feature.allEligible')}
        </label>
        {!allEligible && eligible.length === 0 ? <p className="muted">{t('feature.noCustomers')}</p> : null}
        {!allEligible
          ? eligible.map((account) => (
              <label key={account.tenantId} className="row-gap">
                <input
                  type="checkbox"
                  checked={chosen.includes(account.tenantId)}
                  onChange={(event) =>
                    setChosen((current) =>
                      event.target.checked ? [...current, account.tenantId] : current.filter((id) => id !== account.tenantId),
                    )
                  }
                />
                {account.storeName}
              </label>
            ))
          : null}
      </Card>

      <div className="row-gap">
        {!session.tenantId ? (
          <Button
            variant="secondary"
            disabled={action.busy}
            onClick={() =>
              void run(async () => {
                const ok = await confirm({ title: t('demo.createTitle'), message: t('demo.createMessage') });
                if (!ok) return null;
                await api.adminProvisionInternalDemo({});
                await reloadUser();
                navigate('/dashboard');
                return { ok: true as const };
              })
            }
          >
            {t('demo.create')}
          </Button>
        ) : (
          <Button
            variant="secondary"
            disabled={!session.isInternalDemo || action.busy}
            onClick={() =>
              void run(async () => {
                const result = await api.recordFeaturePreview({ featureId: selected.id });
                navigate(result.path);
                return result;
              })
            }
          >
            {t('feature.test')}
          </Button>
        )}
        {session.tenantId && !session.isInternalDemo ? <span className="small muted">{t('feature.needDemo')}</span> : null}
        <Button variant="secondary" disabled={customerBlocked || action.busy} onClick={() => void run(() => api.markFeatureReady({ featureId: selected.id }))}>
          {t('feature.markReady')}
        </Button>
        <Button
          disabled={customerBlocked || action.busy || catalog.data?.killed}
          onClick={() =>
            void run(async () => {
              if (allEligible) {
                const first = await confirm({
                  title: t('feature.publish'),
                  message: t('feature.confirmAll', { name: selected.title, version: selected.version }),
                });
                if (!first) return null;
                const second = await confirm({
                  title: t('feature.confirmAllTitle'),
                  message: t('feature.confirmAllFinal', { name: selected.title, version: selected.version }),
                  danger: true,
                });
                if (!second) return null;
              } else {
                const ok = await confirm({
                  title: t('feature.publish'),
                  message: t('feature.confirmPublish', { name: selected.title }),
                });
                if (!ok) return null;
              }
              return api.publishFeature({
                featureId: selected.id,
                confirmPublication: true,
                confirmAllEligible: allEligible,
                allEligible,
                tenantIds: allEligible ? [] : chosen,
              });
            })
          }
        >
          {t('feature.publish')}
        </Button>
        <Button
          variant="secondary"
          disabled={action.busy}
          onClick={() =>
            void run(async () => {
              const ok = await confirm({ title: t('feature.pause'), message: selected.title });
              if (!ok) return null;
              return api.pauseFeature({ featureId: selected.id, confirm: true });
            })
          }
        >
          {t('feature.pause')}
        </Button>
        <Button
          variant="danger"
          disabled={action.busy}
          onClick={() =>
            void run(async () => {
              const ok = await confirm({ title: t('feature.rollback'), message: selected.title, danger: true });
              if (!ok) return null;
              return api.rollbackFeature({ featureId: selected.id, confirm: true });
            })
          }
        >
          {t('feature.rollback')}
        </Button>
      </div>

      {selected.pricing === 'paid' ? (
        <Card>
          <h3>{t('feature.grant')}</h3>
          <p className="muted small">{t('feature.grantNote')}</p>
          {eligible.map((account) => (
            <Button
              key={account.tenantId}
              size="sm"
              variant="secondary"
              disabled={customerBlocked || action.busy}
              onClick={() =>
                void run(async () => {
                  const ok = await confirm({ title: t('feature.grant'), message: account.storeName });
                  if (!ok) return null;
                  return api.grantFeaturePurchase({ featureId: selected.id, tenantId: account.tenantId, confirm: true });
                })
              }
            >
              {account.storeName}
            </Button>
          ))}
        </Card>
      ) : null}

      <Card>
        <h3>{t('feature.history')}</h3>
        {selected.history.length === 0 ? (
          <p className="muted">{t('feature.noHistory')}</p>
        ) : (
          <TableWrap>
            <table className="table">
              <tbody>
                {[...selected.history].reverse().map((entry) => (
                  <tr key={`${entry.at}-${entry.action}`}>
                    <td>{entry.action}</td>
                    <td>{entry.version}</td>
                    <td className="num">{entry.tenantCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <div className="row-gap">
        <Button
          variant="danger"
          disabled={action.busy}
          onClick={() =>
            void run(async () => {
              const next = !catalog.data?.killed;
              const ok = await confirm({
                title: next ? t('feature.kill') : t('feature.restore'),
                message: t('feature.killMessage'),
                danger: next,
              });
              if (!ok) return null;
              return api.setFeatureKillSwitch({ killed: next, confirm: true });
            })
          }
        >
          {catalog.data?.killed ? t('feature.restore') : t('feature.kill')}
        </Button>
      </div>
    </div>
  );
}

function Notice({ feature, price }: { feature: FeatureCatalogItem; price: string }) {
  const { t } = useI18n();
  return (
    <div className="stack">
      <strong>
        {feature.title} · {feature.version}
      </strong>
      <p>{feature.description}</p>
      <p>{price}</p>
      <p className="small">{t('feature.activationNote')}</p>
    </div>
  );
}

