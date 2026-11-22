import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Checkbox, FormGrid, TextInput } from '@/components/ui/Form';
import { Alert, Card } from '@/components/ui/Layout';
import { PageLoader } from '@/components/ui/Spinner';
import { useFeedback } from '@/contexts/feedback';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useAsyncData } from '@/hooks/useAsyncData';
import { useI18n } from '@/i18n/i18n';
import { api, type WhishPaymentsView } from '@/services/functionsClient';

/**
 * Owner connects the shop's own Whish Business account. The secret is write-only: it is never
 * shown again, and leaving the field empty keeps the saved one.
 */
export function WhishSettingsCard() {
  const { t } = useI18n();
  const data = useAsyncData('online-store-payments', () => api.onlineStoreGetPayments({}));
  return (
    <Card title={t('onlineStore.whish.title')}>
      {data.loading && !data.data ? (
        <PageLoader />
      ) : data.error || !data.data ? (
        <Alert tone="error" onRetry={data.reload} retryLabel={t('common.retry')}>
          {t('onlineStore.whish.loadError')}
        </Alert>
      ) : (
        <WhishForm key={JSON.stringify(data.data)} initial={data.data} />
      )}
    </Card>
  );
}

function WhishForm({ initial }: { initial: WhishPaymentsView }) {
  const { t } = useI18n();
  const { notify } = useFeedback();
  const action = useAsyncAction('onlineStore');
  const [view, setView] = useState(initial.whish);
  const [enabled, setEnabled] = useState(initial.whish.enabled);
  const [sandbox, setSandbox] = useState(initial.whish.sandbox);
  const [channel, setChannel] = useState(initial.whish.channel);
  const [websiteUrl, setWebsiteUrl] = useState(initial.whish.websiteUrl);
  const [secret, setSecret] = useState('');

  const save = async () => {
    const res = await action.run(() => api.onlineStoreSetWhish({ enabled, sandbox, channel: channel.trim(), secret: secret.trim(), websiteUrl: websiteUrl.trim() }));
    if (!res) return;
    setView(res.whish);
    setSecret('');
    notify('success', t(res.whish.enabled ? 'onlineStore.whish.connected' : 'onlineStore.whish.saved'));
  };

  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>
        {t('onlineStore.whish.intro')}
      </p>
      {view.enabled && (
        <Alert tone="success">{t(view.sandbox ? 'onlineStore.whish.onSandbox' : 'onlineStore.whish.onLive')}</Alert>
      )}
      <Checkbox label={t('onlineStore.whish.enable')} checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
      <FormGrid cols={2}>
        <TextInput label="Channel" dir="ltr" autoComplete="off" value={channel} onChange={(e) => setChannel(e.target.value)} />
        <TextInput
          label="Secret"
          dir="ltr"
          type="password"
          autoComplete="new-password"
          placeholder={view.hasSecret ? t('onlineStore.whish.secretKept') : ''}
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
        />
        <TextInput
          label={t('onlineStore.whish.websiteUrl')}
          hint={t('onlineStore.whish.websiteUrlHint')}
          dir="ltr"
          fieldClassName="span-2"
          placeholder="https://"
          value={websiteUrl}
          onChange={(e) => setWebsiteUrl(e.target.value)}
        />
      </FormGrid>
      <Checkbox label={t('onlineStore.whish.sandbox')} checked={sandbox} onChange={(e) => setSandbox(e.target.checked)} />
      <p className="muted" style={{ margin: 0 }}>
        {t('onlineStore.whish.sandboxHint')}
      </p>
      <div className="modal-actions">
        <Button variant="primary" loading={action.busy} onClick={() => void save()}>
          {t(enabled ? 'onlineStore.whish.saveAndTest' : 'onlineStore.whish.save')}
        </Button>
      </div>
    </div>
  );
}
