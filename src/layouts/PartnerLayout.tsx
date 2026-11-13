import { Suspense } from 'react';
import { Outlet } from 'react-router';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Layout';
import { PageLoader } from '@/components/ui/Spinner';
import { APP_NAME } from '@/constants/app';
import { useTheme } from '@/contexts/ThemeContext';
import { useI18n } from '@/i18n/i18n';
import { signOut } from '@/services/authService';

/**
 * Minimal standalone layout for the Marketing Partner dashboard. A partner is a pure platform
 * account with no tenant — the full AppLayout (POS nav, cashbox chip, AI dock, exchange rate…)
 * assumes a tenant and would break for this session, so this page gets its own small shell instead.
 */
export function PartnerLayout() {
  const { t, lang, setLang } = useI18n();
  const { theme, toggleTheme } = useTheme();
  return (
    <div className="app app--partner">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="sidebar__logo">Z</span>
          <span className="sidebar__title">{APP_NAME} · {t('partner.dashboardTitle')}</span>
        </div>
        <div className="topbar__actions">
          <Button variant="ghost" size="sm" icon="globe" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>
            {lang === 'ar' ? 'English' : 'العربية'}
          </Button>
          <Button variant="ghost" size="sm" icon={theme === 'dark' ? 'sun' : 'moon'} onClick={toggleTheme} aria-label={t('common.toggleTheme')} />
          <Button variant="ghost" size="sm" icon="logout" onClick={() => void signOut()}>
            {t('auth.signOut')}
          </Button>
        </div>
      </header>
      <main className="app__content">
        <ErrorBoundary
          fallback={(_, reset) => (
            <Alert tone="error" onRetry={reset} retryLabel={t('common.retry')}>
              {t('error.pageCrashed')}
            </Alert>
          )}
        >
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}
