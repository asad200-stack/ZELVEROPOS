import { Suspense, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
import { Button } from '@/components/ui/Button';
import { PageLoader } from '@/components/ui/Spinner';
import { APP_NAME } from '@/constants/app';
import { useTheme } from '@/contexts/ThemeContext';
import { useI18n } from '@/i18n/i18n';
import { captureReferralCode } from '@/services/referralCapture';

export function AuthLayout() {
  const { t, lang, setLang } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  // A Marketing Partner's signup link (?ref=CODE) may land on any auth page, not only /signup.
  useEffect(() => captureReferralCode(location.search), [location.search]);
  return (
    <div className="auth">
      <div className="auth__tools">
        <Button variant="ghost" size="sm" icon="globe" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>
          {lang === 'ar' ? 'English' : 'العربية'}
        </Button>
        <Button variant="ghost" size="sm" icon={theme === 'dark' ? 'sun' : 'moon'} onClick={toggleTheme} aria-label={t('common.toggleTheme')} />
      </div>
      <div className="auth__card">
        <div className="auth__brand">
          <span className="sidebar__logo">Z</span>
          <div>
            <div className="auth__name">{APP_NAME}</div>
            <div className="muted small">{t('auth.tagline')}</div>
          </div>
        </div>
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
      </div>
    </div>
  );
}
