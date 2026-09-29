import { Navigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import { PageLoader } from '@/components/ui/Spinner';
import { useFeedback } from '@/contexts/feedback';
import { useSession } from '@/contexts/session';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useI18n } from '@/i18n/i18n';
import { resendVerification, signOut } from '@/services/authService';

export default function VerifyEmailPage() {
  const { t } = useI18n();
  const session = useSession();
  const { notify } = useFeedback();
  const resend = useAsyncAction('verify-resend');
  const check = useAsyncAction('verify-check');

  if (session.status === 'loading') return <PageLoader />;
  if (session.status === 'signedOut') return <Navigate to="/login" replace />;
  if (session.status !== 'needsVerification') return <Navigate to="/" replace />;

  return (
    <div className="stack">
      <h1 className="auth__title">{t('auth.verifyTitle')}</h1>
      <p>{t('auth.verifyMessage', { email: session.user?.email ?? '' })}</p>
      <Button
        block
        loading={check.busy}
        onClick={() =>
          void check.run(async () => {
            await session.refresh();
            if (!session.user?.emailVerified) notify('info', t('auth.verifyStillPending'));
          })
        }
      >
        {t('auth.verifyDone')}
      </Button>
      <Button
        block
        variant="secondary"
        loading={resend.busy}
        onClick={() =>
          void resend.run(async () => {
            await resendVerification();
            notify('success', t('auth.verifyResent'));
          })
        }
      >
        {t('auth.verifyResend')}
      </Button>
      <Button block variant="ghost" icon="logout" onClick={() => void signOut()}>
        {t('auth.signOut')}
      </Button>
    </div>
  );
}
