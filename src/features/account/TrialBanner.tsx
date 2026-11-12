import { Link } from 'react-router';
import { Alert } from '@/components/ui/Layout';
import { useSession } from '@/contexts/session';
import { trialChipKind, trialChipTone, trialDaysLeft } from '@/domain/trial';
import { useI18n } from '@/i18n/i18n';

export function TrialChip() {
  const { t } = useI18n();
  const { subscription } = useSession();
  const kind = trialChipKind(subscription);
  if (kind === 'hidden') return null;
  if (kind === 'ended') {
    return (
      <span className="topbar__chip topbar__chip--danger">
        {t('trial.endedChip')}
      </span>
    );
  }
  if (!subscription) return null;
  const days = trialDaysLeft(subscription.endsAt);
  const tone = trialChipTone(days);
  return (
    <span className={`topbar__chip topbar__chip--${tone === 'info' ? 'success' : tone}`}>
      {t('trial.chip', { days })}
    </span>
  );
}

export function TrialReadOnlyBanner() {
  const { t } = useI18n();
  const { subscription, writesEnabled, isOwner } = useSession();
  if (writesEnabled || !subscription) return null;
  return (
    <Alert tone="warning">
      {t('trial.expiredBanner')}
      {isOwner ? (
        <>
          {' '}
          <Link to="/settings">{t('trial.requestSubscription')}</Link>
        </>
      ) : null}
    </Alert>
  );
}
