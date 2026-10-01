import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { useFeedback } from '@/contexts/feedback';
import { useI18n } from '@/i18n/i18n';
import { summarize, useOfflineQueue } from '@/offline/queue';
import { applyUpdate, hasWorkInProgress, useUpdateReady } from './serviceWorker';

/** "New version available — refresh when ready". Never reloads on its own. */
export function UpdateNotice() {
  const { t } = useI18n();
  const { confirm } = useFeedback();
  const ready = useUpdateReady();
  const queue = useOfflineQueue();
  if (!ready) return null;

  const refresh = async () => {
    if (hasWorkInProgress() || queue.syncing || summarize(queue.operations).pending > 0) {
      const ok = await confirm({ title: t('update.busyTitle'), message: t('update.busyMessage'), confirmLabel: t('update.refreshAnyway') });
      if (!ok) return;
    }
    applyUpdate();
  };

  return (
    <div className="update-notice" role="status" data-testid="update-notice">
      <Icon name="refresh" size={16} />
      <span>{t('update.available')}</span>
      <Button size="sm" onClick={() => void refresh()}>
        {t('update.refresh')}
      </Button>
    </div>
  );
}
