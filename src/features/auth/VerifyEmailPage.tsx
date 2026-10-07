import { useState } from 'react';
import { Navigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Layout';
import { PageLoader } from '@/components/ui/Spinner';
import { useFeedback } from '@/contexts/feedback';
import { useSession } from '@/contexts/session';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useEmailCooldown } from '@/hooks/useEmailCooldown';
import { useI18n } from '@/i18n/i18n';
import { resendVerification, signOut } from '@/services/authService';
import { isRateLimitError } from '@/services/emailCooldown';

export default function VerifyEmailPage() {
  const { t } = useI18n();
  const session = useSession();
  const { notify } = useFeedback();
  const resend = useAsyncAction('verify-resend');
  const check = useAsyncAction('verify-check');
  const cooldown = useEmailCooldown('verify', session.user?.uid ?? null);
  const [notice, setNotice] = useState<'sent' | 'rateLimited' | null>(null);

  if (session.status === 'loading') return <PageLoader />;
  if (session.status === 'signedOut') return <Navigate to="/login" replace />;
  if (session.status !== 'needsVerification') return <Navigate to="/" replace />;

  const rateLimited = notice === 'rateLimited' || cooldown.rateLimited;

  return (
    <div className="stack">
      <h1 className="auth__title">{t('auth.verifyTitle')}</h1>
      <p>{t('auth.verifyMessage', { email: session.user?.email ?? '' })}</p>
      {rateLimited ? (
        <Alert tone="warning">{t('auth.emailRateLimited')}</Alert>
      ) : (
        notice === 'sent' && <Alert tone="success">{t('auth.verifyResent')}</Alert>
      )}
      <Button
        block
        loading={check.busy}
        onClick={() =>
          void check.run(async () => {
            try {
              const verified = await session.refresh();
              if (!verified) notify('info', t('auth.verifyStillPending'));
            } catch (e) {
              if (!isRateLimitError(e)) throw e;
              notify('error', t('auth.emailRateLimited'));
            }
          })
        }
      >
        {t('auth.verifyDone')}
      </Button>
      <Button
        block
        variant="secondary"
        loading={resend.busy}
        disabled={cooldown.seconds > 0}
        onClick={() =>
          void resend.run(async () => {
            const outcome = await resendVerification();
            cooldown.sync();
            if (outcome.status === 'sent') setNotice('sent');
            else if (outcome.status === 'rateLimited') setNotice('rateLimited');
            else if (outcome.status === 'failed') throw outcome.error;
          })
        }
      >
        {cooldown.seconds > 0 ? t('auth.resendIn', { seconds: cooldown.seconds }) : t('auth.verifyResend')}
      </Button>
      <Button block variant="ghost" icon="logout" onClick={() => void signOut()}>
        {t('auth.signOut')}
      </Button>
    </div>
  );
}
