import type { FormEvent } from 'react';
import { Navigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import { FormGrid, TextInput } from '@/components/ui/Form';
import { PageLoader } from '@/components/ui/Spinner';
import { useSession } from '@/contexts/session';
import { useAsyncAction } from '@/hooks/useAsyncAction';
import { useForm } from '@/hooks/useForm';
import { useI18n } from '@/i18n/i18n';
import { completeSignup, signOut } from '@/services/authService';
import { api } from '@/services/functionsClient';
import { setupSchema } from '@/validation/schemas';

/** Shown when an Auth account exists but its store was never created (e.g. interrupted signup). */
export default function SetupPage() {
  const { t } = useI18n();
  const session = useSession();
  const form = useForm({ fullName: '', storeName: '', subdomain: '', phone: '' });
  const { busy, run } = useAsyncAction('setup');
  const admin = useAsyncAction('bootstrap-admin');

  if (session.status === 'loading') return <PageLoader />;
  if (session.status === 'signedOut') return <Navigate to="/login" replace />;
  if (session.status !== 'needsSetup') return <Navigate to="/" replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const data = form.validate(setupSchema);
    if (!data) return;
    void run(() => completeSignup(data));
  };

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <h1 className="auth__title">{t('auth.setupTitle')}</h1>
      <p className="muted small">{t('auth.setupHint')}</p>
      <FormGrid>
        <TextInput label={t('auth.fullName')} required {...form.bind('fullName')} />
        <TextInput label={t('auth.storeName')} required {...form.bind('storeName')} />
        <TextInput label={t('auth.subdomain')} hint={t('auth.subdomainHint')} required {...form.bind('subdomain')} />
        <TextInput label={t('auth.phone')} type="tel" required {...form.bind('phone')} />
      </FormGrid>
      <Button type="submit" block loading={busy}>
        {t('common.continue')}
      </Button>
      <Button variant="ghost" block icon="logout" onClick={() => void signOut()}>
        {t('auth.signOut')}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        icon="shield"
        loading={admin.busy}
        onClick={() =>
          void admin.run(async () => {
            await api.bootstrapSuperAdmin({});
            await session.refresh();
          })
        }
      >
        {t('auth.platformAdmin')}
      </Button>
    </form>
  );
}
