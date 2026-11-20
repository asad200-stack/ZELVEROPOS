import { useState, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, FormGrid, MoneyInput, SelectInput, TextArea, TextInput } from '@/components/ui/Form';
import { Alert, Badge, Card, PageHeader } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { useNavigate } from 'react-router';
import { APP_BUILD_ID, APP_NAME, APP_RELEASE_VERSION, SUPPORT_PHONE } from '@/constants/app';
import { activateAssignedVersion, canActivateUpdate } from '@/features/releases/activateRelease';
import { useReleaseAssignment } from '@/features/releases/useReleaseAssignment';
import { useOfflineQueue } from '@/offline/queue';
import { useFeedback } from '@/contexts/feedback';
import { useSession, useTenant } from '@/contexts/session';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useAsyncData } from '@/hooks/useAsyncData';
import { useEmailCooldown } from '@/hooks/useEmailCooldown';
import { useSettingsState } from '@/hooks/useTenantData';
import { useI18n } from '@/i18n/i18n';
import { sendPasswordReset } from '@/services/authService';
import { api } from '@/services/functionsClient';
import { loadTelegramSecrets, saveSettings, saveTelegramSecrets } from '@/services/settingsService';
import { deleteStorageFile, uploadTenantImage } from '@/services/storageService';
import { updateOwnName } from '@/services/userService';
import type { StoreSettings, TelegramEvents } from '@/types/models';
import { formatDate } from '@/utils/format';

export default function SettingsPage() {
  const { t } = useI18n();
  const settings = useSettingsState();
  const { can, isOwner } = useTenant();
  const canEdit = can('canEditSettings');
  const sensitive = isOwner || can('canViewSensitiveData');

  return (
    <div className="page">
      <PageHeader title={t('nav.settings')} />
      {!canEdit && <Alert tone="info">{t('settings.readOnly')}</Alert>}
      {settings.status === 'loading' ? (
        <PageLoader />
      ) : (
        <div className="settings-grid">
          <StoreForm key={`store-${settings.data.updatedAt ?? 0}`} settings={settings.data} disabled={!canEdit} />
          <SalesForm key={`sales-${settings.data.updatedAt ?? 0}`} settings={settings.data} disabled={!canEdit} />
          <TelegramCard key={`tg-${settings.data.updatedAt ?? 0}`} settings={settings.data} disabled={!canEdit} showSecrets={sensitive && canEdit} />
          <AccountCard />
          <ApplicationCard />
          {sensitive && <DataCard />}
        </div>
      )}
    </div>
  );
}

function StoreForm({ settings, disabled }: { settings: StoreSettings; disabled: boolean }) {
  const { t } = useI18n();
  const { tenantId } = useTenant();
  const { notify } = useFeedback();
  const [values, setValues] = useState({
    storeName: settings.storeName,
    storeAddress: settings.storeAddress,
    storePhone: settings.storePhone,
    receiptFooter: settings.receiptFooter,
  });
  const { busy, run } = useAsyncAction('settings-store');
  const logo = useAsyncAction('settings-logo');
  const set = (k: keyof typeof values) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues((v) => ({ ...v, [k]: e.target.value }));

  const onLogo = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    void logo.run(async () => {
      const uploaded = await uploadTenantImage(tenantId, 'logo', 'logo', file);
      await saveSettings(tenantId, { logoUrl: uploaded.url, logoPath: uploaded.path });
      if (settings.logoPath) await deleteStorageFile(settings.logoPath);
      notify('success', t('common.saved'));
    });
  };

  return (
    <Card title={t('settings.store')}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!values.storeName.trim()) return notify('error', t('validation.required'));
          void run(async () => {
            await saveSettings(tenantId, {
              storeName: values.storeName.trim().slice(0, 80),
              storeAddress: values.storeAddress.trim().slice(0, 200),
              storePhone: values.storePhone.trim().slice(0, 40),
              receiptFooter: values.receiptFooter.trim().slice(0, 300),
            });
            notify('success', t('common.saved'));
          });
        }}
      >
        <fieldset disabled={disabled || busy} className="stack">
          <FormGrid>
            <TextInput label={t('settings.storeName')} required value={values.storeName} onChange={set('storeName')} maxLength={80} />
            <TextInput label={t('settings.storePhone')} type="tel" value={values.storePhone} onChange={set('storePhone')} maxLength={40} />
          </FormGrid>
          <TextInput label={t('settings.storeAddress')} value={values.storeAddress} onChange={set('storeAddress')} maxLength={200} />
          <TextArea label={t('settings.receiptFooter')} value={values.receiptFooter} onChange={set('receiptFooter')} maxLength={300} rows={2} />
          <div className="field">
            <span className="field__label">{t('settings.logo')}</span>
            <div className="row-gap">
              {settings.logoUrl && <img src={settings.logoUrl} alt="" className="image-preview" />}
              <label className={`btn btn--secondary btn--sm${disabled || logo.busy ? ' btn--disabled' : ''}`}>
                <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={disabled || logo.busy} onChange={onLogo} />
                {logo.busy ? t('common.uploading') : t('settings.uploadLogo')}
              </label>
              {settings.logoUrl && !disabled && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon="trash"
                  disabled={logo.busy}
                  onClick={() =>
                    void logo.run(async () => {
                      await saveSettings(tenantId, { logoUrl: null, logoPath: null });
                      if (settings.logoPath) await deleteStorageFile(settings.logoPath);
                    })
                  }
                >
                  {t('common.remove')}
                </Button>
              )}
            </div>
          </div>
        </fieldset>
        {!disabled && (
          <div className="modal-actions">
            <Button type="submit" loading={busy}>
              {t('common.save')}
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}

function SalesForm({ settings, disabled }: { settings: StoreSettings; disabled: boolean }) {
  const { t } = useI18n();
  const { tenantId } = useTenant();
  const { notify } = useFeedback();
  const [rate, setRate] = useState(String(settings.exchangeRate));
  const [currency, setCurrency] = useState(settings.defaultCurrency);
  const [printFormat, setPrintFormat] = useState(settings.printFormat);
  const [lowStockAlert, setLowStockAlert] = useState(settings.lowStockAlert);
  const [autoPrintInvoice, setAutoPrintInvoice] = useState(settings.autoPrintInvoice);
  const [threshold, setThreshold] = useState(String(settings.lowStockThreshold));
  const { busy, run } = useAsyncAction('settings-sales');

  return (
    <Card title={t('settings.sales')}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const exchangeRate = Number(rate.replace(/[,\s]/g, ''));
          const lowStockThreshold = Number(threshold);
          if (!Number.isInteger(exchangeRate) || exchangeRate <= 0) return notify('error', t('error.invalidRate'));
          if (!Number.isInteger(lowStockThreshold) || lowStockThreshold < 0) return notify('error', t('validation.nonNegativeInt'));
          void run(async () => {
            await saveSettings(tenantId, { exchangeRate, defaultCurrency: currency, printFormat, autoPrintInvoice, lowStockAlert, lowStockThreshold });
            notify('success', t('common.saved'));
          });
        }}
      >
        <fieldset disabled={disabled || busy} className="stack">
          <FormGrid>
            <MoneyInput currency="lbp" label={t('settings.exchangeRate')} value={rate} onChange={(e) => setRate(e.target.value)} hint={t('settings.exchangeRateHint')} />
            <SelectInput
              label={t('settings.defaultCurrency')}
              value={currency}
              onChange={(e) => setCurrency(e.target.value as StoreSettings['defaultCurrency'])}
              options={[
                { value: 'USD', label: 'USD ($)' },
                { value: 'LBP', label: t('common.lbp') },
              ]}
            />
            <SelectInput
              label={t('settings.printFormat')}
              value={printFormat}
              onChange={(e) => setPrintFormat(e.target.value as StoreSettings['printFormat'])}
              options={[
                { value: 'thermal80', label: t('settings.thermal80') },
                { value: 'a4', label: 'A4' },
              ]}
            />
            <TextInput label={t('settings.lowStockThreshold')} inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
          </FormGrid>
          <Checkbox label={t('settings.lowStockAlert')} checked={lowStockAlert} onChange={(e) => setLowStockAlert(e.target.checked)} />
          <Field hint={t('settings.autoPrintInvoiceHint')}>
            {() => <Checkbox label={t('settings.autoPrintInvoice')} checked={autoPrintInvoice} onChange={(e) => setAutoPrintInvoice(e.target.checked)} />}
          </Field>
        </fieldset>
        {!disabled && (
          <div className="modal-actions">
            <Button type="submit" loading={busy}>
              {t('common.save')}
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}

const EVENT_KEYS: (keyof TelegramEvents)[] = ['sales', 'onlineOrders', 'returns', 'cash', 'lowStock'];

function TelegramCard({ settings, disabled, showSecrets }: { settings: StoreSettings; disabled: boolean; showSecrets: boolean }) {
  const { t } = useI18n();
  const { tenantId } = useTenant();
  const { notify } = useFeedback();
  const [enabled, setEnabled] = useState(settings.telegram.enabled);
  const [events, setEvents] = useState<TelegramEvents>(settings.telegram.events);
  const [secretsOpen, setSecretsOpen] = useState(false);
  const { busy, run } = useAsyncAction('settings-telegram');
  const test = useAsyncAction('settings-telegram-test');

  return (
    <Card
      title={t('settings.telegram')}
      actions={<Badge tone={settings.telegram.enabled ? 'success' : 'default'}>{settings.telegram.enabled ? t('common.enabled') : t('common.disabled')}</Badge>}
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await saveSettings(tenantId, { telegram: { enabled, events } });
            notify('success', t('common.saved'));
          });
        }}
      >
        <p className="muted small">{t('settings.telegramHint')}</p>
        <fieldset disabled={disabled || busy} className="stack">
          <Checkbox label={t('settings.telegramEnabled')} checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <div className="checkbox-grid">
            {EVENT_KEYS.map((k) => (
              <Checkbox
                key={k}
                label={t(`settings.telegramEvent.${k}`)}
                checked={events[k]}
                disabled={!enabled}
                onChange={(e) => setEvents((ev) => ({ ...ev, [k]: e.target.checked }))}
              />
            ))}
          </div>
        </fieldset>
        {!disabled && (
          <div className="modal-actions">
            {showSecrets && (
              <Button variant="secondary" icon="lock" onClick={() => setSecretsOpen(true)}>
                {t('settings.telegramCredentials')}
              </Button>
            )}
            <Button
              variant="secondary"
              icon="send"
              loading={test.busy}
              disabled={!settings.telegram.enabled}
              onClick={() =>
                void test.run(async () => {
                  await api.testTelegram({});
                  notify('success', t('settings.telegramTestSent'));
                })
              }
            >
              {t('settings.telegramTest')}
            </Button>
            <Button type="submit" loading={busy}>
              {t('common.save')}
            </Button>
          </div>
        )}
      </form>
      {secretsOpen && <TelegramSecretsModal tenantId={tenantId} onClose={() => setSecretsOpen(false)} />}
    </Card>
  );
}

function TelegramSecretsModal({ tenantId, onClose }: { tenantId: string; onClose: () => void }) {
  const { t } = useI18n();
  const secrets = useAsyncData(`tg|${tenantId}`, () => loadTelegramSecrets(tenantId));
  return (
    <Modal open size="sm" title={t('settings.telegramCredentials')} onClose={onClose}>
      {secrets.error ? (
        <Alert tone="error" onRetry={secrets.reload} retryLabel={t('common.retry')}>
          {t('error.loadFailed')}
        </Alert>
      ) : !secrets.data ? (
        <PageLoader />
      ) : (
        <TelegramSecretsForm tenantId={tenantId} initial={secrets.data} onClose={onClose} />
      )}
    </Modal>
  );
}

function TelegramSecretsForm({ tenantId, initial, onClose }: { tenantId: string; initial: { botToken: string; chatId: string }; onClose: () => void }) {
  const { t } = useI18n();
  const { notify } = useFeedback();
  const [botToken, setBotToken] = useState(initial.botToken);
  const [chatId, setChatId] = useState(initial.chatId);
  const [show, setShow] = useState(false);
  const { busy, run } = useAsyncAction('settings-telegram-secrets');
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await saveTelegramSecrets(tenantId, { botToken, chatId });
          notify('success', t('common.saved'));
          onClose();
        });
      }}
    >
      <TextInput
        label={t('settings.botToken')}
        type={show ? 'text' : 'password'}
        autoComplete="off"
        value={botToken}
        onChange={(e) => setBotToken(e.target.value)}
        hint={t('settings.botTokenHint')}
      />
      <TextInput label={t('settings.chatId')} autoComplete="off" value={chatId} onChange={(e) => setChatId(e.target.value)} />
      <Checkbox label={t('settings.showToken')} checked={show} onChange={(e) => setShow(e.target.checked)} />
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" loading={busy}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}

function ApplicationCard() {
  const { t } = useI18n();
  const { isSuperAdmin } = useSession();
  const { confirm } = useFeedback();
  const navigate = useNavigate();
  const queue = useOfflineQueue();
  const release = useReleaseAssignment();
  return (
    <Card title={t('release.application')}>
      <div className="stack">
        <div className="details-grid">
          <div>
            <span className="muted">{t('release.currentVersion')}</span>
            <strong dir="ltr">{APP_RELEASE_VERSION}</strong>
          </div>
          <div>
            <span className="muted">{t('release.build')}</span>
            <strong dir="ltr">{APP_BUILD_ID}</strong>
          </div>
          <div>
            <span className="muted">{t('release.availableVersion')}</span>
            <strong dir="ltr">{release.available ?? t('release.upToDate')}</strong>
          </div>
        </div>
        {release.notes || release.title ? (
          <div>
            <span className="muted">{t('release.whatsNew')}</span>
            {release.title ? <p><strong>{release.title}</strong></p> : null}
            {release.notes ? <p>{release.notes}</p> : null}
          </div>
        ) : null}
        {release.showOptional || release.force ? (
          <Button
            onClick={() => {
              void (async () => {
                const gate = canActivateUpdate(queue.operations, queue.syncing);
                if (!gate.ok) {
                  const ok = await confirm({ title: t('update.busyTitle'), message: t('update.busyMessage'), confirmLabel: t('update.updateNow') });
                  if (!ok) return;
                }
                if (release.available) activateAssignedVersion(release.available);
              })();
            }}
          >
            {t('release.updateTo', { version: release.available ?? '' })}
          </Button>
        ) : (
          <p className="muted small">{t('release.upToDate')}</p>
        )}
        {isSuperAdmin && (
          <Button variant="secondary" onClick={() => navigate('/admin?tab=releases')}>
            {t('release.title')}
          </Button>
        )}
      </div>
    </Card>
  );
}

function AccountCard() {
  const { t, lang } = useI18n();
  const { profile, subscription, user, isOwner } = useSession();
  const { notify } = useFeedback();
  const [name, setName] = useState(profile?.fullName ?? '');
  const save = useAsyncAction('settings-account');
  const reset = useAsyncAction('settings-reset');
  const resetCooldown = useEmailCooldown('reset', 'browser');
  if (!profile) return null;
  return (
    <Card title={t('settings.account')}>
      <div className="stack">
        <div className="details-grid">
          <div>
            <span className="muted">{t('auth.email')}</span>
            <strong dir="ltr">{profile.email}</strong>
          </div>
          <div>
            <span className="muted">{t('settings.role')}</span>
            <strong>{isOwner ? t('settings.roleOwner') : t('settings.roleSubUser')}</strong>
          </div>
          {isOwner && subscription && (
            <div>
              <span className="muted">{t('settings.subscription')}</span>
              <strong>
                {subscription.lifetime
                  ? t('account.lifetime')
                  : subscription.endsAt
                    ? t('account.activeUntil', { date: formatDate(subscription.endsAt, lang) })
                    : '—'}
              </strong>
            </div>
          )}
        </div>
        {isOwner && (
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              void save.run(async () => {
                await updateOwnName(profile.uid, name);
                notify('success', t('common.saved'));
              });
            }}
          >
            <TextInput label={t('auth.fullName')} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            <Button type="submit" variant="secondary" loading={save.busy}>
              {t('common.save')}
            </Button>
          </form>
        )}
        <div className="row-gap">
          <Button
            variant="secondary"
            icon="lock"
            loading={reset.busy}
            disabled={resetCooldown.seconds > 0}
            onClick={() =>
              void reset.run(async () => {
                const outcome = await sendPasswordReset(user?.email ?? profile.email);
                resetCooldown.sync();
                if (outcome.status === 'failed') throw outcome.error;
                if (outcome.status === 'rateLimited') notify('error', t('auth.emailRateLimited'));
                else if (outcome.status === 'sent') notify('success', t('auth.resetSent'));
              })
            }
          >
            {resetCooldown.seconds > 0 ? t('auth.resendIn', { seconds: resetCooldown.seconds }) : t('settings.changePassword')}
          </Button>
        </div>
        <p className="muted small">
          {APP_NAME} v{APP_RELEASE_VERSION} · {t('account.support')}: <span dir="ltr">{SUPPORT_PHONE}</span>
        </p>
      </div>
    </Card>
  );
}

function DataCard() {
  const { t } = useI18n();
  const { isOwner } = useTenant();
  const [clearing, setClearing] = useState(false);
  return (
    <Card title={t('settings.data')}>
      <div className="stack">
        <p className="muted small">{t('settings.backupHint')}</p>
        <div className="row-gap">
          <Button variant="secondary" icon="download" disabled>
            {t('settings.backup')}
          </Button>
          {isOwner && (
            <Button variant="danger" icon="trash" onClick={() => setClearing(true)}>
              {t('settings.clearData')}
            </Button>
          )}
        </div>
      </div>
      {clearing && <ClearDataModal onClose={() => setClearing(false)} />}
    </Card>
  );
}

const CLEAR_CONFIRM = 'DELETE';

function ClearDataModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { notify } = useFeedback();
  const [text, setText] = useState('');
  const { busy, run } = useAsyncAction('settings-clear');
  return (
    <Modal
      open
      size="sm"
      title={t('settings.clearData')}
      onClose={onClose}
      busy={busy}
      footer={
        <Button
          variant="danger"
          loading={busy}
          disabled={text !== CLEAR_CONFIRM}
          onClick={() =>
            void run(async () => {
              const res = await api.clearTenantData({ confirm: CLEAR_CONFIRM });
              notify('success', t('settings.clearDone', { count: res.deleted }));
              onClose();
            })
          }
        >
          {t('settings.clearData')}
        </Button>
      }
    >
      <div className="stack">
        <Alert tone="error">{t('settings.clearWarning')}</Alert>
        <TextInput label={t('settings.typeToConfirm', { word: CLEAR_CONFIRM })} value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" dir="ltr" />
      </div>
    </Modal>
  );
}
