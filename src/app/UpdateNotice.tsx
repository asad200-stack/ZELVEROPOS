import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Spinner } from '@/components/ui/Spinner';
import { useFeedback } from '@/contexts/feedback';
import { activateAssignedVersion, canActivateUpdate } from '@/features/releases/activateRelease';
import { useReleaseAssignment } from '@/features/releases/useReleaseAssignment';
import { useI18n } from '@/i18n/i18n';
import { useOfflineQueue } from '@/offline/queue';
import { applyUpdate } from './serviceWorker';

/**
 * Release-managed update banner only (required or admin-published optional updates).
 * The generic, auto-detected "a new build is on the server" toast was removed: it fired on
 * every hosting deploy regardless of whether the change mattered to this store, which was
 * noisy. Carts and the offline queue stay on this origin. Never reloads on its own.
 */
export function UpdateNotice() {
  const { t } = useI18n();
  const { notify } = useFeedback();
  const queue = useOfflineQueue();
  const release = useReleaseAssignment();
  const [installing, setInstalling] = useState(false);
  const showRelease = release.showOptional || release.force;
  if (!showRelease) return null;

  const run = async (assigned: string | null) => {
    const gate = canActivateUpdate(queue.operations, queue.syncing);
    if (!gate.ok) {
      notify('warning', gate.reason === 'syncing' ? t('update.syncingMessage') : t('update.busyMessage'));
      return;
    }
    setInstalling(true);
    try {
      if (assigned) activateAssignedVersion(assigned);
      else applyUpdate();
    } catch {
      setInstalling(false);
      notify('error', t('update.failed'));
    }
  };

  if (installing) {
    return (
      <div className="update-notice update-notice--installing" role="status" aria-live="polite" data-testid="update-installing">
        <Spinner size={18} />
        <span>{t('update.installing')}</span>
      </div>
    );
  }

  if (release.force) {
    return (
      <div className="update-notice" role="alert" data-testid="update-required">
        <Icon name="refresh" size={16} />
        <span>{release.title ? t('update.releaseAvailableTitled', { title: release.title, version: release.available ?? '' }) : t('update.required', { version: release.available ?? '' })}</span>
        <Button size="sm" onClick={() => void run(release.available)}>
          {t('update.updateNow')}
        </Button>
      </div>
    );
  }

  if (showRelease) {
    return (
      <div className="update-notice" role="status" data-testid="update-notice">
        <Icon name="refresh" size={16} />
        <span>
          {release.title
            ? t('update.releaseAvailableTitled', { title: release.title, version: release.available ?? '' })
            : t('update.releaseAvailable', { version: release.available ?? '' })}
        </span>
        <Button size="sm" onClick={() => void run(release.available)}>
          {t('update.updateNow')}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => release.snooze()}>
          {t('update.later')}
        </Button>
      </div>
    );
  }

  return null;
}
