import { lazy, Suspense, useEffect, useState } from 'react';
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
import { TrialChip } from '@/features/account/TrialBanner';
import { UpdateCenter } from '@/features/features/UpdateCenter';
import { useFeatureUpdates } from '@/features/features/useFeatureUpdates';
import { PosCashboxChip } from '@/features/pos/PosCashboxChip';
import { OrderAlertBanner } from '@/features/onlineStore/OrderAlertCenter';
import { useOrderAlerts } from '@/features/onlineStore/useOrderAlerts';
import { aiDockModeAfterPermissionChange, shouldShowAiEntry } from '@/features/ai/aiAccess';
import { useAiServerAccess } from '@/features/ai/aiServerAccess';
import { copilotAccess } from '@/features/ai/copilotTransport';
import {
  aiShellClassNames,
  nextAiDockMode,
  shouldMountAiPanel,
  type AiDockMode,
} from '@/features/ai/aiDock';
import { useResource } from '@/stores/tenantStore';
import { formatNumber } from '@/utils/format';
import { POS_PREVIEW_RELEASE, POS_UI_ID } from '@/features/pos/posUi';
import { isSuperAdminPreviewChannel } from '@/firebase/superadminPreview';
import zelveroMark from '@/assets/zelvero-mark.png';

const askAiAccess = copilotAccess;

const AiPanel = lazy(() => import('@/features/ai/AiPanel').then((mod) => ({ default: mod.AiPanel })));

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
  const [updateToken, setUpdateToken] = useState(0);
  const featureUpdates = useFeatureUpdates(updateToken);
  const [aiDock, setAiDock] = useState<AiDockMode>('closed');
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.sidebar) === 'collapsed';
    } catch {
      return false;
    }
  });
  const closeMenu = () => setMenuOpen(false);
  // Internal demo (the platform super admin's own test tenant) always sees the AI entry, since it
  // has no Feature Center entitlement doc of its own. A real customer is gated by the
  // canUseZelveroAI permission (owners have it implicitly; sub-users need the explicit grant) AND
  // by this tenant's own Feature Center entitlement being active (published to this tenant
  // specifically, and the customer has pressed Update). The server (aiCopilotAccess / aiCopilotRead)
  // independently re-checks the permission on every call, so this is UX only.
  const aiEntitlementActive = featureUpdates.some(
    (update) => update.featureId === 'zelvero_ai' && update.status === 'active',
  );
  const aiCandidate =
    shouldShowAiEntry({ ...session, adminOnly }) &&
    (session.isInternalDemo || aiEntitlementActive);
  const aiServer = useAiServerAccess(session.user?.uid ?? null, aiCandidate, askAiAccess);
  const mayUseAi = aiCandidate && aiServer === 'allowed';
  const [dockPermission, setDockPermission] = useState(mayUseAi);
  if (dockPermission !== mayUseAi) {
    setDockPermission(mayUseAi);
    setAiDock((current) => aiDockModeAfterPermissionChange(mayUseAi, current));
  }
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.sidebar, collapsed ? 'collapsed' : 'expanded');
    } catch {
      /* private mode: the choice still applies until reload */
    }
  }, [collapsed]);

  // Online store link: UX gate only. Every online-store callable re-checks the entitlement server-side.
  const onlineStoreActive = session.isInternalDemo || featureUpdates.some(
    (update) => update.featureId === 'online_store' && update.status === 'active',
  );
  const orderAlerts = useOrderAlerts(
    !adminOnly && !!session.tenantId && session.isOwner && onlineStoreActive,
    location.pathname === '/online-orders',
  );
  const items = adminOnly || !session.tenantId
    ? []
    : NAV_ITEMS.filter((i) => ((i.path === '/online-store' || i.path === '/online-orders') && !onlineStoreActive
      ? false
      : i.ownerOnly ? session.isOwner : i.permission ? session.can(i.permission) : true));

  const onlinePreview = isSuperAdminPreviewChannel(import.meta.env.VITE_APP_CHANNEL);
  const previewChannel = import.meta.env.VITE_APP_CHANNEL === 'preview' || onlinePreview;
  const previewLocked = onlinePreview && session.status === 'ready' && !session.isSuperAdmin;
  return (
    <div
      className={[
        'app',
        menuOpen ? 'app--menu-open' : '',
        collapsed ? 'app--sidebar-collapsed' : '',
        ...aiShellClassNames(aiDock),
      ]
        .filter(Boolean)
        .join(' ')}
    >
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
          <span className="sidebar__logo">
            <img src={zelveroMark} alt="" width={32} height={32} />
          </span>
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
              {item.path === '/online-orders' && !!orderAlerts.pending && (
                <span className="nav-badge" aria-label={t('onlineOrders.alert.pending', { n: orderAlerts.pending })}>
                  {orderAlerts.pending}
                </span>
              )}
            </NavLink>
          ))}
          {featureUpdates
            .filter((update) => update.status === 'active' && update.navPath && !NAV_ITEMS.some((item) => item.path === update.navPath))
            .map((update) => (
              <NavLink
                key={update.featureId}
                to={update.navPath!}
                title={update.navLabel}
                onClick={closeMenu}
                className={({ isActive }) => (isActive ? 'nav-link nav-link--active' : 'nav-link')}
              >
                <Icon name="box" />
                <span>{update.navLabel}</span>
              </NavLink>
            ))}
          {adminOnly && session.tenantId && (
            <NavLink to="/dashboard" title={t('demo.open')} onClick={closeMenu} className="nav-link">
              <Icon name="cart" />
              <span>{t('demo.open')}</span>
            </NavLink>
          )}
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
        {previewChannel && (
          <div className="preview-banner" data-testid="preview-banner" data-pos-ui={POS_UI_ID}>
            <strong>{t('preview.banner')}</strong>
            <span>{t('preview.build', { id: `${POS_UI_ID} · ${POS_PREVIEW_RELEASE} · ${import.meta.env.MODE}` })}</span>
          </div>
        )}
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
            {!adminOnly && session.isInternalDemo && (
              <span className="topbar__chip topbar__chip--warning" title={t('demo.banner')}>
                <Icon name="info" size={14} /> {t('demo.badge')}
              </span>
            )}
            {session.tenantId && session.user ? (
              <OfflineStatus tenantId={session.tenantId} uid={session.user.uid} isOwner={session.isOwner} />
            ) : (
              !online && (
                <span className="topbar__chip topbar__chip--warning">
                  <Icon name="wifiOff" size={14} /> {t('common.offline')}
                </span>
              )
            )}
            {session.tenantId && <TrialChip />}
            {session.tenantId && <ExchangeRateBadge tenantId={session.tenantId} />}
            {mayUseAi && (
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={aiDock === 'open'}
                aria-haspopup="dialog"
                onClick={() => setAiDock((mode) => nextAiDockMode(mode, 'open'))}
              >
                {t('ai.open')}
              </Button>
            )}
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
          <OrderAlertBanner alerts={orderAlerts} />
          {!adminOnly && session.isInternalDemo && <Alert tone="warning">{t('demo.banner')}</Alert>}
          {!adminOnly ? <UpdateCenter updates={featureUpdates} onChanged={() => setUpdateToken((value) => value + 1)} /> : null}
          <ErrorBoundary
            resetKey={location.pathname}
            fallback={(_, reset) => (
              <Alert tone="error" onRetry={reset} retryLabel={t('common.retry')}>
                {t('error.pageCrashed')}
              </Alert>
            )}
          >
            <Suspense fallback={<PageLoader />}>
              {previewLocked ? <Alert tone="warning">{t('preview.superAdminOnly')}</Alert> : <Outlet />}
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
      {mayUseAi && shouldMountAiPanel(aiDock) && (
        <Suspense fallback={null}>
          <AiPanel
            route={location.pathname}
            minimized={aiDock === 'minimized'}
            onRestore={() => setAiDock((mode) => nextAiDockMode(mode, 'restore'))}
            onClose={() => setAiDock((mode) => nextAiDockMode(mode, 'close'))}
          />
        </Suspense>
      )}
    </div>
  );
}
