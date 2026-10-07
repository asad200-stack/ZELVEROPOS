import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Form';
import { Alert } from '@/components/ui/Layout';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useEmailCooldown } from '@/hooks/useEmailCooldown';
import { useForm } from '@/hooks/useForm';
import { useI18n } from '@/i18n/i18n';
import { sendPasswordReset } from '@/services/authService';
import { loginSchema } from '@/validation/schemas';

const schema = z.object({ email: loginSchema.shape.email });

export default function ForgotPasswordPage() {
  const { t } = useI18n();
  const form = useForm({ email: '' });
  const { busy, run } = useAsyncAction('forgot-password');
  const [sent, setSent] = useState(false);
  const [notice, setNotice] = useState<'rateLimited' | null>(null);
  const cooldown = useEmailCooldown('reset', 'browser');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const data = form.validate(schema);
    if (!data) return;
    void run(async () => {
      const outcome = await sendPasswordReset(data.email);
      cooldown.sync();
      // Do not reveal whether the account exists.
      if (outcome.status === 'failed' && (outcome.error as { code?: string }).code !== 'auth/user-not-found') throw outcome.error;
      if (outcome.status === 'rateLimited') setNotice('rateLimited');
      else if (outcome.status !== 'cooldown') setSent(true);
    });
  };

  return (
    <form onSubmit={submit} className="stack" noValidate>
      <h1 className="auth__title">{t('auth.resetTitle')}</h1>
      {sent ? (
        <Alert tone="success">{t('auth.resetSent')}</Alert>
      ) : (
        <>
          <p className="muted small">{t('auth.resetHint')}</p>
          {(notice === 'rateLimited' || cooldown.rateLimited) && <Alert tone="warning">{t('auth.emailRateLimited')}</Alert>}
          <TextInput label={t('auth.email')} type="email" autoComplete="email" autoFocus required {...form.bind('email')} />
          <Button type="submit" block loading={busy} disabled={cooldown.seconds > 0}>
            {cooldown.seconds > 0 ? t('auth.resendIn', { seconds: cooldown.seconds }) : t('auth.sendResetLink')}
          </Button>
        </>
      )}
      <div className="auth__links">
        <Link to="/login">{t('auth.backToLogin')}</Link>
      </div>
    </form>
  );
}
