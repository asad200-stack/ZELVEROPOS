import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Form';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useForm } from '@/hooks/useForm';
import { useI18n } from '@/i18n/i18n';
import { signIn } from '@/services/authService';
import { loginSchema } from '@/validation/schemas';

export default function LoginPage() {
  const { t } = useI18n();
  const form = useForm({ email: '', password: '' });
  const { busy, run } = useAsyncAction('login');
  const [showPassword, setShowPassword] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const data = form.validate(loginSchema);
    if (!data) return;
    void run(() => signIn(data.email, data.password));
  };

  return (
    <form onSubmit={submit} className="stack" noValidate>
      <h1 className="auth__title">{t('auth.loginTitle')}</h1>
      <TextInput label={t('auth.email')} type="email" autoComplete="email" autoFocus required {...form.bind('email')} />
      <div className="password-field">
        <TextInput
          label={t('auth.password')}
          type={showPassword ? 'text' : 'password'}
          autoComplete="current-password"
          required
          {...form.bind('password')}
        />
        <Button
          variant="ghost"
          size="sm"
          icon={showPassword ? 'eyeOff' : 'eye'}
          className="password-field__toggle"
          onClick={() => setShowPassword((s) => !s)}
          aria-label={t('auth.togglePassword')}
        />
      </div>
      <Button type="submit" block loading={busy}>
        {t('auth.signIn')}
      </Button>
      <div className="auth__links">
        <Link to="/forgot-password">{t('auth.forgotPassword')}</Link>
        <Link to="/signup">{t('auth.createAccount')}</Link>
      </div>
    </form>
  );
}
