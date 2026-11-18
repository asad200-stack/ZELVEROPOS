import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useI18n } from '@/i18n/i18n';
import { startOfflineQueue, summarize, useOfflineQueue } from '@/offline/queue';
import { OfflineQueuePanel } from './OfflineQueuePanel';

/**
 * Global connection + offline-queue indicator. Counts come from the durable IndexedDB queue, so
 * pending sales stay visible after a reload. Clicking opens the queue / recovery panel.
 */
export function OfflineStatus({ tenantId, uid, isOwner }: { tenantId: string; uid: string; isOwner: boolean }) {
  const { t } = useI18n();
  const online = useOnlineStatus();
  const queue = useOfflineQueue();
  const [open, setOpen] = useState(false);
  const summary = summarize(queue.operations);

  useEffect(() => startOfflineQueue({ tenantId, uid }), [tenantId, uid]);

  const chips = [];
  chips.push(
    online ? (
      <span key="net" className="topbar__chip topbar__chip--success" data-testid="net-status">
        <Icon name="wifi" size={14} /> {t('offline.header.online')}
      </span>
    ) : (
      <span key="net" className="topbar__chip topbar__chip--warning" data-testid="net-status">
        <Icon name="wifiOff" size={14} /> {t('offline.header.offline')}
      </span>
    ),
  );
  if (summary.actionRequired > 0) {
    chips.push(
      <button key="act" type="button" className="topbar__chip topbar__chip--danger" onClick={() => setOpen(true)} title={t('offline.header.hint')} data-testid="queue-action">
        <Icon name="alert" size={14} /> {t('offline.header.action', { count: summary.actionRequired })}
      </button>,
    );
  }
  if (queue.syncing && summary.pending > 0) {
    chips.push(
      <button key="sync" type="button" className="topbar__chip" onClick={() => setOpen(true)} title={t('offline.header.hint')} data-testid="queue-syncing">
        <Icon name="refresh" size={14} /> {t('offline.header.syncing')}
      </button>,
    );
  } else if (summary.pending > 0) {
    chips.push(
      <button key="pend" type="button" className="topbar__chip topbar__chip--warning" onClick={() => setOpen(true)} title={t('offline.header.hint')} data-testid="queue-pending">
        <Icon name="clock" size={14} /> {t('offline.header.pending', { count: summary.pending })}
      </button>,
    );
  }
  // Nothing waiting and nothing to fix: no chip. Sales queued offline sync on their own when the
  // connection returns, and the pending / action chips above appear only while there is work.

  return (
    <>
      {chips}
      {open && <OfflineQueuePanel uid={uid} isOwner={isOwner} onClose={() => setOpen(false)} />}
    </>
  );
}
