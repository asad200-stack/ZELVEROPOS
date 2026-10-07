import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { applyActionCode, checkActionCode, confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Form';
import { Alert } from '@/components/ui/Layout';
import { PageLoader } from '@/components/ui/Spinner';
import { useSession } from '@/contexts/session';
import { firebase } from '@/firebase/app';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useForm } from '@/hooks/useForm';
import { useI18n } from '@/i18n/i18n';
import { sendPasswordReset } from '@/services/authService';
import { newPasswordSchema } from '@/validation/schemas';
import { isDeadLinkError, parseActionParams, runOnce, type ActionParams } from './authAction';

type View =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'error' }
  | { kind: 'verified' }
  | { kind: 'resetForm'; email: string }
  | { kind: 'resetDone' }
  | { kind: 'recovered'; email: string };

/**
 * ZELVERO handler for Firebase e-mail action links (verify e-mail, reset password, recover e-mail).
 * The one-time code is read once and then removed from the address bar, history and any referrer.
 */
export default function AuthActionPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const session = useSession();
  const [params] = useState<ActionParams | null>(() => parseActionParams(window.location.search, window.location.origin));
  const [view, setView] = useState<View>(() => (params ? { kind: 'loading' } : { kind: 'invalid' }));
  const form = useForm({ password: '', confirmPassword: '' });
  const submit = useAsyncAction('auth-action-reset');
  const resend = useAsyncAction('auth-action-recover-reset');
  const [resetRequested, setResetRequested] = useState(false);

  useEffect(() => {
    if (window.location.search) window.history.replaceState(window.history.state, '', window.location.pathname);
  }, []);

  useEffect(() => {
    if (!params) return;
    const { mode, oobCode } = params;
    const fail = (e: unknown) => setView(isDeadLinkError(e) ? { kind: 'invalid' } : { kind: 'error' });
    if (mode === 'verifyEmail') {
      runOnce(`verify:${oobCode}`, () => applyActionCode(firebase.auth, oobCode))
        .then(() => setView({ kind: 'verified' }))
        .catch(fail);
    } else if (mode === 'resetPassword') {
      runOnce(`check:${oobCode}`, () => verifyPasswordResetCode(firebase.auth, oobCode))
        .then((email) => setView({ kind: 'resetForm', email }))
        .catch(fail);
    } else {
      runOnce(`recover:${oobCode}`, async () => {
        const info = await checkActionCode(firebase.auth, oobCode);
        await applyActionCode(firebase.auth, oobCode);
        return info.data.email ?? '';
      })
        .then((email) => setView({ kind: 'recovered', email }))
        .catch(fail);
    }
  }, [params]);

  // A signed-in user who just verified picks up the new email_verified claim once (no polling).
  useEffect(() => {
    if (view.kind === 'verified' && session.user && !session.user.emailVerified) void session.refresh().catch(() => undefined);
  }, [view.kind, session]);

  const onReset = (e: FormEvent) => {
    e.preventDefault();
    const data = form.validate(newPasswordSchema);
    if (!data || !params) return;
    void submit.run(async () => {
      try {
        await confirmPasswordReset(firebase.auth, params.oobCode, data.password);
        setView({ kind: 'resetDone' });
      } catch (err) {
        if (isDeadLinkError(err)) setView({ kind: 'invalid' });
        else throw err;
      }
    });
  };

  if (view.kind === 'loading') return <PageLoader />;

  return (
    <div className="stack">
      {view.kind === 'verified' && (
        <>
          <h1 className="auth__title">{t('action.verifiedTitle')}</h1>
          <Alert tone="success">{t('action.verifiedBody')}</Alert>
          <Button block onClick={() => navigate(params?.continuePath ?? '/', { replace: true })}>
            {t('action.continue')}
          </Button>
        </>
      )}

      {view.kind === 'resetForm' && (
        <form onSubmit={onReset} className="stack" noValidate>
          <h1 className="auth__title">{t('action.resetTitle')}</h1>
          <p className="muted small">{t('action.resetFor', { email: view.email })}</p>
          <TextInput label={t('action.newPassword')} type="password" autoComplete="new-password" autoFocus required {...form.bind('password')} />
          <TextInput label={t('auth.confirmPassword')} type="password" autoComplete="new-password" required {...form.bind('confirmPassword')} />
          <Button type="submit" block loading={submit.busy}>
            {t('action.savePassword')}
          </Button>
        </form>
      )}

      {view.kind === 'resetDone' && (
        <>
          <h1 className="auth__title">{t('action.resetDoneTitle')}</h1>
          <Alert tone="success">{t('action.resetDoneBody')}</Alert>
          <Button block onClick={() => navigate('/login', { replace: true })}>
            {t('action.toLogin')}
          </Button>
        </>
      )}

      {view.kind === 'recovered' && (
        <>
          <h1 className="auth__title">{t('action.recoveredTitle')}</h1>
          <Alert tone="warning">{t('action.recoveredBody', { email: view.email })}</Alert>
          {resetRequested ? (
            <Alert tone="success">{t('auth.resetSent')}</Alert>
          ) : (
            <Button
              block
              loading={resend.busy}
              onClick={() =>
                void resend.run(async () => {
                  const outcome = await sendPasswordReset(view.email);
                  if (outcome.status === 'failed') throw outcome.error;
                  setResetRequested(true);
                })
              }
            >
              {t('action.recoverReset')}
            </Button>
          )}
          <Button block variant="secondary" onClick={() => navigate('/login', { replace: true })}>
            {t('action.toLogin')}
          </Button>
        </>
      )}

      {(view.kind === 'invalid' || view.kind === 'error') && (
        <>
          <h1 className="auth__title">{t(view.kind === 'invalid' ? 'action.invalidTitle' : 'action.errorTitle')}</h1>
          <Alert tone="warning">{t(view.kind === 'invalid' ? 'action.invalidBody' : 'action.errorBody')}</Alert>
          <div className="auth__links">
            <Link to="/login">{t('auth.backToLogin')}</Link>
            <Link to="/forgot-password">{t('auth.forgotPassword')}</Link>
          </div>
        </>
      )}
    </div>
  );
}
