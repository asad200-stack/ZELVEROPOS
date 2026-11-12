import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import { Alert, Badge, Card } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import { SUPPORT_PHONE, STORAGE_KEYS } from '@/constants/app';
import { useSession } from '@/contexts/session';
import { posWorkInProgress, whatsappPurchaseUrl } from '@/domain/featureRelease';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useI18n } from '@/i18n/i18n';
import { api, type CustomerFeatureUpdate } from '@/services/functionsClient';
import { formatMoney } from '@/utils/format';

export function useFeatureUpdates(reloadToken = 0): CustomerFeatureUpdate[] {
  const session = useSession();
  const [updates, setUpdates] = useState<CustomerFeatureUpdate[]>([]);
  useEffect(() => {
    if (!session.tenantId || session.isInternalDemo || session.status !== 'ready') {
      setUpdates([]);
      return;
    }
    let live = true;
    void api
      .listMyFeatureUpdates({})
      .then((result) => {
        if (live) setUpdates(result.updates);
      })
      .catch(() => {
        if (live) setUpdates([]);
      });
    return () => {
      live = false;
    };
  }, [session.tenantId, session.isInternalDemo, session.status, reloadToken]);
  return updates;
}

const RELOAD_HOLD_KEY = 'zelvero.featureReloadHold';

interface ReloadHold {
  title: string;
  version: string;
}

function readHold(): ReloadHold | null {
  try {
    const raw = sessionStorage.getItem(RELOAD_HOLD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ReloadHold;
    if (!parsed || typeof parsed.title !== 'string' || typeof parsed.version !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeHold(hold: ReloadHold | null) {
  if (!hold) sessionStorage.removeItem(RELOAD_HOLD_KEY);
  else sessionStorage.setItem(RELOAD_HOLD_KEY, JSON.stringify(hold));
}

export function UpdateCenter({ updates, onChanged }: { updates: CustomerFeatureUpdate[]; onChanged: () => void }) {
  const { t } = useI18n();
  const session = useSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState<CustomerFeatureUpdate | null>(null);
  const [stages, setStages] = useState<string[]>([]);
  const [hold, setHold] = useState<ReloadHold | null>(() => readHold());
  const [saleOpen, setSaleOpen] = useState(false);
  const action = useAsyncAction('feature-activate');
  const pending = updates.filter((update) => update.status === 'notified' || update.canRequestPurchase);
  const tenantId = session.tenantId;
  const uid = session.user?.uid ?? '';

  useEffect(() => {
    if (!hold || !tenantId || !uid) return;
    const key = STORAGE_KEYS.cart(tenantId, uid);
    const look = () => {
      const busy = posWorkInProgress(localStorage.getItem(key));
      setSaleOpen(busy);
      if (!busy) {
        writeHold(null);
        window.location.reload();
      }
    };
    look();
    const timer = window.setInterval(look, 1000);
    return () => window.clearInterval(timer);
  }, [hold, tenantId, uid]);

  if (!tenantId || (pending.length === 0 && !hold)) return null;

  const price = (update: CustomerFeatureUpdate) =>
    update.pricing === 'paid' && update.priceUsdCents != null ? formatMoney(update.priceUsdCents, 'USD') : t('feature.free');

  const reloadSafely = () => {
    const raw = localStorage.getItem(STORAGE_KEYS.cart(tenantId, uid));
    if (posWorkInProgress(raw)) return;
    writeHold(null);
    window.location.reload();
  };

  const activate = async (update: CustomerFeatureUpdate) => {
    const result = await action.run(() => api.activateMyFeature({ featureId: update.featureId }));
    if (!result) return;
    setStages(result.stages);
    if (result.reloadRequired) {
      const raw = localStorage.getItem(STORAGE_KEYS.cart(tenantId, uid));
      if (posWorkInProgress(raw)) {
        const next = { title: update.title, version: update.version };
        writeHold(next);
        setHold(next);
        setSaleOpen(true);
        setOpen(null);
        return;
      }
      window.location.reload();
      return;
    }
    onChanged();
    if (update.navPath) navigate(update.navPath);
  };

  return (
    <>
      {hold ? (
        <Alert tone="warning">
          {t('updates.reloadBlocked')} {hold.title} · {hold.version}. {saleOpen ? null : t('updates.reloadSafe')}{' '}
          <Button size="sm" variant="secondary" disabled={saleOpen || action.busy} onClick={reloadSafely}>
            {t('updates.reloadNow')}
          </Button>
        </Alert>
      ) : (
        <Alert tone="info">
          {t('updates.available', { count: pending.length })}{' '}
          <Button size="sm" variant="secondary" onClick={() => setOpen(pending[0] ?? null)}>
            {t('updates.review')}
          </Button>
        </Alert>
      )}
      <Modal open={open != null} title={open ? open.title : t('updates.review')} onClose={() => setOpen(null)}>
        {open ? (
          <div className="stack">
            <div className="row-gap">
              <Badge tone="info">{open.version}</Badge>
              <Badge>{price(open)}</Badge>
            </div>
            <p>{open.description}</p>
            <Card>
              <strong>{t('feature.capabilities')}</strong>
              <ul>
                {open.capabilities.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <strong>{t('feature.requirements')}</strong>
              <ul>
                {open.requirements.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <p className="small muted">{open.compatibility}</p>
              {open.screenshots.length === 0 ? <p className="small muted">{t('updates.noScreenshots')}</p> : null}
            </Card>
            <p className="small">{t('feature.activationNote')}</p>
            {stages.length > 0 ? (
              <ol>
                {stages.map((stage) => (
                  <li key={stage}>{t(`updates.stage.${stage as 'checked' | 'entitled' | 'active'}`)}</li>
                ))}
              </ol>
            ) : null}
            {open.canActivate && session.isOwner ? (
              <Button loading={action.busy} onClick={() => void activate(open)}>
                {t('updates.install')}
              </Button>
            ) : null}
            {open.canRequestPurchase ? <PurchaseLink update={open} storeName={session.profile?.storeName || ''} /> : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}

function PurchaseLink({ update, storeName }: { update: CustomerFeatureUpdate; storeName: string }) {
  const { t } = useI18n();
  const url = whatsappPurchaseUrl({
    phone: SUPPORT_PHONE,
    storeName: storeName || 'Store',
    featureTitle: update.title,
    version: update.version,
    priceUsdCents: update.priceUsdCents,
  });
  if (!url) return <p>{t('updates.noPhone')}</p>;
  return (
    <a className="btn btn--success btn--md" href={url} target="_blank" rel="noopener noreferrer">
      {t('updates.buy')}
    </a>
  );
}
