import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import { TextArea, TextInput } from '@/components/ui/Form';
import { Alert, Card } from '@/components/ui/Layout';
import { APP_BUILD_ID, APP_RELEASE_VERSION } from '@/constants/app';
import { useFeedback } from '@/contexts/feedback';
import { useSession } from '@/contexts/session';
import { draftReleaseRecord } from '@/domain/previewCenter';
import { POS_PREVIEW_RELEASE, POS_UI_ID } from '@/features/pos/posUi';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useI18n } from '@/i18n/i18n';
import { reloadUser } from '@/services/authService';
import { api } from '@/services/functionsClient';

/** Super Admin only. Exercises this build on the synthetic demo store and does not publish it. */
export function PreviewTestingPanel() {
  const { t } = useI18n();
  const session = useSession();
  const navigate = useNavigate();
  const { notify, confirm } = useFeedback();
  const { busy, run } = useAsyncAction('preview-center');
  const [version, setVersion] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const createDemo = async () => {
    const ok = await confirm({ title: t('demo.createTitle'), message: t('demo.createMessage') });
    if (!ok) return;
    await run(async () => {
      await api.adminProvisionInternalDemo({});
      await reloadUser();
      navigate('/pos');
    });
  };

  const saveDraft = async () => {
    const draft = draftReleaseRecord({ version, title, description, buildId: APP_BUILD_ID });
    if (!draft.version || !draft.title || !draft.buildId) return;
    await run(async () => {
      await api.createRelease({
        version: draft.version,
        title: draft.title,
        notes: draft.notes,
        releaseType: 'patch',
        buildId: draft.buildId,
      });
      notify('success', t('previewCenter.draftSaved'));
      setVersion('');
      setTitle('');
      setDescription('');
    });
  };

  return (
    <div className="stack">
      <Alert tone="info">{t('previewCenter.isolation')}</Alert>
      <div className="stats">
        <Card title={t('previewCenter.ui')}>
          <strong dir="ltr">{POS_UI_ID}</strong>
          <div className="muted small" dir="ltr">
            {POS_PREVIEW_RELEASE}
          </div>
        </Card>
        <Card title={t('previewCenter.running')}>
          <strong dir="ltr">{APP_RELEASE_VERSION}</strong>
          <div className="muted small" dir="ltr">
            {APP_BUILD_ID}
          </div>
        </Card>
      </div>

      <Card title={t('previewCenter.testStore')}>
        <p className="muted">{t('previewCenter.testStoreHint')}</p>
        {session.isInternalDemo ? (
          <Button icon="cart" onClick={() => navigate('/pos')}>
            {t('previewCenter.openPos')}
          </Button>
        ) : session.tenantId ? (
          <Alert tone="warning">{t('previewCenter.customerStoreBlocked')}</Alert>
        ) : (
          <Button variant="secondary" loading={busy} onClick={() => void createDemo()}>
            {t('demo.create')}
          </Button>
        )}
        <p className="muted small">{t('previewCenter.ai')}</p>
      </Card>

      <Card title={t('previewCenter.record')}>
        <p className="muted">{t('previewCenter.recordHint')}</p>
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void saveDraft();
          }}
        >
          <TextInput label={t('release.version')} value={version} onChange={(event) => setVersion(event.target.value)} dir="ltr" />
          <TextInput label={t('release.titleField')} value={title} onChange={(event) => setTitle(event.target.value)} />
          <TextArea label={t('previewCenter.description')} value={description} onChange={(event) => setDescription(event.target.value)} />
          <TextInput label={t('release.build')} value={APP_BUILD_ID} readOnly dir="ltr" />
          <Button type="submit" loading={busy} disabled={!version.trim() || !title.trim()}>
            {t('previewCenter.saveDraft')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
