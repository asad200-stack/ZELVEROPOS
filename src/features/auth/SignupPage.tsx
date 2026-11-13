import type { FormEvent } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/Button';
import { FormGrid, TextInput } from '@/components/ui/Form';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useForm } from '@/hooks/useForm';
import { useI18n } from '@/i18n/i18n';
import { register } from '@/services/authService';
import { peekReferralCode } from '@/services/referralCapture';
import { signupSchema } from '@/validation/schemas';

export default function SignupPage() {
  const { t } = useI18n();
  const form = useForm({
    fullName: '',
    storeName: '',
    subdomain: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
  });
  const { busy, run } = useAsyncAction('signup');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const data = form.validate(signupSchema);
    if (!data) return;
    void run(() => register({ ...data, referralCode: peekReferralCode() }));
  };

  return (
    <form onSubmit={submit} className="stack" noValidate>
      <h1 className="auth__title">{t('auth.signupTitle')}</h1>
      <p className="muted small">{t('auth.signupHint')}</p>
      <FormGrid>
        <TextInput label={t('auth.fullName')} autoComplete="name" required {...form.bind('fullName')} />
        <TextInput label={t('auth.storeName')} required {...form.bind('storeName')} />
        <TextInput label={t('auth.subdomain')} hint={t('auth.subdomainHint')} required {...form.bind('subdomain')} />
        <TextInput label={t('auth.phone')} type="tel" autoComplete="tel" required {...form.bind('phone')} />
      </FormGrid>
      <TextInput label={t('auth.email')} type="email" autoComplete="email" required {...form.bind('email')} />
      <FormGrid>
        <TextInput label={t('auth.password')} type="password" autoComplete="new-password" required {...form.bind('password')} />
        <TextInput label={t('auth.confirmPassword')} type="password" autoComplete="new-password" required {...form.bind('confirmPassword')} />
      </FormGrid>
      <Button type="submit" block loading={busy}>
        {t('auth.createAccount')}
      </Button>
      <div className="auth__links">
        <Link to="/login">{t('auth.haveAccount')}</Link>
      </div>
    </form>
  );
}
