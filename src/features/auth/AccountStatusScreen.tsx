import { Button } from '@/components/ui/Button';
import { APP_NAME, SUPPORT_PHONE } from '@/constants/app';
import { useSession, type SessionStatus } from '@/contexts/session';
import { OfflineStatus } from '@/features/offline/OfflineStatus';
import { useI18n } from '@/i18n/i18n';
import { signOut } from '@/services/authService';
import { formatDate } from '@/utils/format';

/** Full-screen notice for accounts that are disabled, awaiting activation, or failed to load. */
export function AccountStatusScreen({ status }: { status: Extract<SessionStatus, 'disabled' | 'inactive' | 'error'> }) {
  const { t, lang } = useI18n();
  const session = useSession();
  const sub = session.subscription;
  const expired = status === 'inactive' && !!sub?.activated && !sub.lifetime;
  const whatsapp = SUPPORT_PHONE ? `https://wa.me/${SUPPORT_PHONE.replace(/\D/g, '')}` : '';

  return (
    <div className="center-screen">
      <div className="center-card">
        <h1>{APP_NAME}</h1>
        {status === 'disabled' && (
          <>
            <h2>{t('account.disabledTitle')}</h2>
            <p className="muted">{t('account.disabledMessage')}</p>
          </>
        )}
        {status === 'inactive' && (
          <>
            <h2>{expired ? t('account.expiredTitle') : t('account.inactiveTitle')}</h2>
            <p className="muted">
              {expired ? t('account.expiredMessage', { date: formatDate(sub?.endsAt ?? null, lang) }) : t('account.inactiveMessage')}
            </p>
            {whatsapp && (
              <p>
                <a className="btn btn--success btn--md" href={whatsapp} target="_blank" rel="noopener noreferrer">
                  {t('account.contactSupport')} ({SUPPORT_PHONE})
                </a>
              </p>
            )}
          </>
        )}
        {status === 'error' && (
          <>
            <h2>{t('account.errorTitle')}</h2>
            <p className="muted">{t('account.errorMessage')}</p>
            <Button onClick={() => window.location.reload()}>{t('common.reload')}</Button>
          </>
        )}
        {status !== 'error' && session.tenantId && session.user && (
          // Offline sales captured on this device stay visible (and are still sent, so the server can
          // record the rejection) even when the account or store can no longer sell.
          <div className="row-gap">
            <OfflineStatus tenantId={session.tenantId} uid={session.user.uid} isOwner={session.isOwner} />
          </div>
        )}
        <div className="row-gap">
          {status === 'inactive' && (
            <Button variant="secondary" icon="refresh" onClick={() => void session.refresh()}>
              {t('account.checkAgain')}
            </Button>
          )}
          <Button variant="ghost" icon="logout" onClick={() => void signOut()}>
            {t('auth.signOut')}
          </Button>
        </div>
      </div>
    </div>
  );
}
