import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { NAV_ITEMS } from '@/app/navigation';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Alert } from '@/components/ui/Layout';
import { PageLoader } from '@/components/ui/Spinner';
import { APP_NAME, STORAGE_KEYS } from '@/constants/app';
import { useSession } from '@/contexts/session';
import { useTheme } from '@/contexts/ThemeContext';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useI18n } from '@/i18n/i18n';
import { signOut } from '@/services/authService';
import { OfflineStatus } from '@/features/offline/OfflineStatus';
import { PosCashboxChip } from '@/features/pos/PosCashboxChip';
import { useResource } from '@/stores/tenantStore';
import { formatNumber } from '@/utils/format';

function ExchangeRateBadge({ tenantId }: { tenantId: string }) {
  const { t } = useI18n();
  const settings = useResource(tenantId, 'settings').data;
  return (
    <span className="topbar__chip" title={t('settings.exchangeRate')}>
      <Icon name="dollar" size={14} /> {formatNumber(settings.exchangeRate)}
    </span>
  );
}

function StoreName({ tenantId }: { tenantId: string }) {
  const settings = useResource(tenantId, 'settings').data;
  return <>{settings.storeName || APP_NAME}</>;
}

export function AppLayout({ adminOnly = false }: { adminOnly?: boolean }) {
  const { t, lang, setLang } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const session = useSession();
  const online = useOnlineStatus();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.sidebar) === 'collapsed';
    } catch {
      return false;
    }
  });
  const closeMenu = () => setMenuOpen(false);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.sidebar, collapsed ? 'collapsed' : 'expanded');
    } catch {
      /* private mode: the choice still applies until reload */
    }
  }, [collapsed]);

  const items = adminOnly || !session.tenantId
    ? []
    : NAV_ITEMS.filter((i) => (i.ownerOnly ? session.isOwner : i.permission ? session.can(i.permission) : true));

  return (
    <div className={['app', menuOpen ? 'app--menu-open' : '', collapsed ? 'app--sidebar-collapsed' : ''].filter(Boolean).join(' ')}>
      <aside className="sidebar" id="app-sidebar" aria-label={t('nav.menu')}>
        <div className="sidebar__brand">
          <button
            type="button"
            className="sidebar__toggle"
            aria-expanded={!collapsed}
            aria-controls="app-sidebar"
            aria-label={t(collapsed ? 'nav.expandMenu' : 'nav.collapseMenu')}
            onClick={() => setCollapsed((value) => !value)}
          >
            <Icon name="menu" />
          </button>
          <span className="sidebar__logo">Z</span>
          <span className="sidebar__title">{APP_NAME}</span>
        </div>
        <nav className="sidebar__nav">
          {items.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              title={t(item.label)}
              onClick={closeMenu}
              className={({ isActive }) => (isActive ? 'nav-link nav-link--active' : 'nav-link')}
            >
              <Icon name={item.icon} />
              <span>{t(item.label)}</span>
            </NavLink>
          ))}
          {session.isSuperAdmin && (
            <NavLink to="/admin" title={t('nav.admin')} onClick={closeMenu} className={({ isActive }) => (isActive ? 'nav-link nav-link--active' : 'nav-link')}>
              <Icon name="shield" />
              <span>{t('nav.admin')}</span>
            </NavLink>
          )}
        </nav>
        <div className="sidebar__footer">
          <div className="sidebar__user" title={session.user?.email ?? ''}>
            <Icon name="user" size={16} />
            <span>{session.profile?.fullName || session.user?.email}</span>
          </div>
          <button type="button" className="nav-link" title={t('auth.signOut')} onClick={() => void signOut()}>
            <Icon name="logout" />
            <span>{t('auth.signOut')}</span>
          </button>
        </div>
      </aside>
      <div className="sidebar-backdrop" onClick={closeMenu} />

      <div className="main">
        <header className="topbar">
          <div className="topbar__start">
            <button
              type="button"
              className="topbar__menu"
              onClick={() => setMenuOpen(true)}
              aria-expanded={menuOpen}
              aria-controls="app-sidebar"
              aria-label={t('nav.menu')}
            >
              <Icon name="menu" />
            </button>
            <div className="topbar__title">{session.tenantId ? <StoreName tenantId={session.tenantId} /> : t('nav.admin')}</div>
          </div>
          {!adminOnly && location.pathname === '/pos' && session.tenantId ? <PosCashboxChip /> : null}
          <div className="topbar__actions">
            {session.tenantId && session.user ? (
              <OfflineStatus tenantId={session.tenantId} uid={session.user.uid} isOwner={session.isOwner} />
            ) : (
              !online && (
                <span className="topbar__chip topbar__chip--warning">
                  <Icon name="wifiOff" size={14} /> {t('common.offline')}
                </span>
              )
            )}
            {session.tenantId && <ExchangeRateBadge tenantId={session.tenantId} />}
            <Button variant="ghost" size="sm" icon="globe" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')} title={t('common.language')}>
              {lang === 'ar' ? 'EN' : 'ع'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={theme === 'dark' ? 'sun' : 'moon'}
              onClick={toggleTheme}
              aria-label={t('common.toggleTheme')}
            />
          </div>
        </header>
        <main className="content">
          <ErrorBoundary
            key={location.pathname}
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
    </div>
  );
}
