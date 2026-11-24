import { lazy, Suspense, useEffect, useRef, type ComponentType, type LazyExoticComponent } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { Button } from '@/components/ui/Button';
import { PageLoader } from '@/components/ui/Spinner';
import { useSession } from '@/contexts/session';
import { adminPreviewDecision, isAdminPreviewBuild } from '@/domain/adminPreview';
import { resetTenantStore } from '@/stores/tenantStore';
import { clearQueryCache } from '@/hooks/queryCache';
import { AppLayout } from '@/layouts/AppLayout';
import { AuthLayout } from '@/layouts/AuthLayout';
import { PartnerLayout } from '@/layouts/PartnerLayout';
import { NAV_ITEMS } from './navigation';
import { PublicOnly, RequireMarketingPartner, RequirePermission, RequireSuperAdmin, RequireTenant } from './guards';
import { UpdateNotice } from './UpdateNotice';
import { PreviewAccess } from './PreviewAccess';
import { signOut } from '@/services/authService';
import { useI18n } from '@/i18n/i18n';

type Loader = () => Promise<{ default: ComponentType }>;
const screenLoaders: Loader[] = [];
const page = (loader: Loader) => lazy(loader);
/** A store screen: also fetched ahead in the background once the user is signed in. */
const screen = (loader: Loader) => {
  screenLoaders.push(loader);
  return lazy(loader);
};

/** Fetches every store screen while the browser is idle, so opening one shows it at once. */
function usePreloadScreens(active: boolean) {
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const idle = (fn: () => void) =>
      'requestIdleCallback' in window ? window.requestIdleCallback(fn, { timeout: 3000 }) : globalThis.setTimeout(fn, 1500);
    const next = (i: number) => {
      if (stopped || i >= screenLoaders.length) return;
      idle(() => {
        void screenLoaders[i]?.().catch(() => undefined);
        next(i + 1);
      });
    };
    next(0);
    return () => {
      stopped = true;
    };
  }, [active]);
}

const LoginPage = page(() => import('@/features/auth/LoginPage'));
const SignupPage = page(() => import('@/features/auth/SignupPage'));
const ForgotPasswordPage = page(() => import('@/features/auth/ForgotPasswordPage'));
const VerifyEmailPage = page(() => import('@/features/auth/VerifyEmailPage'));
const AuthActionPage = page(() => import('@/features/auth/AuthActionPage'));
const SetupPage = page(() => import('@/features/auth/SetupPage'));
const SuperAdminPage = page(() => import('@/features/admin/SuperAdminPage'));
const PartnerDashboardPage = page(() => import('@/features/partners/PartnerDashboardPage'));
const NotFoundPage = page(() => import('@/pages/NotFoundPage'));
const PublicStorePage = page(() => import('@/features/onlineStore/PublicStorePage'));

const SCREENS: Record<string, LazyExoticComponent<ComponentType>> = {
  '/dashboard': screen(() => import('@/features/dashboard/DashboardPage')),
  '/pos': screen(() => import('@/features/pos/PosPage')),
  '/cashbox': screen(() => import('@/features/cashbox/CashboxPage')),
  '/products': screen(() => import('@/features/products/ProductsPage')),
  '/expiry': screen(() => import('@/features/products/ExpiryPage')),
  '/sales': screen(() => import('@/features/sales/SalesPage')),
  '/customers': screen(() => import('@/features/customers/CustomersPage')),
  '/suppliers': screen(() => import('@/features/suppliers/SuppliersPage')),
  '/purchases': screen(() => import('@/features/purchases/PurchasesPage')),
  '/reports': screen(() => import('@/features/reports/ReportsPage')),
  '/users': screen(() => import('@/features/users/UsersPage')),
  '/online-store': screen(() => import('@/features/onlineStore/OnlineStoreSettingsPage')),
  '/online-orders': screen(() => import('@/features/onlineStore/OnlineOrdersPage')),
  '/settings': screen(() => import('@/features/settings/SettingsPage')),
};

/** Stops tenant listeners when the signed-in user or tenant changes. */
function useTenantReset() {
  const { user, tenantId } = useSession();
  const key = `${user?.uid ?? ''}/${tenantId ?? ''}`;
  const previous = useRef(key);
  useEffect(() => {
    if (previous.current !== key) {
      resetTenantStore();
      clearQueryCache();
      previous.current = key;
    }
  }, [key]);
}

function AdminPreviewDenied() {
  const { t } = useI18n();
  return (
    <div className="center-screen">
      <div className="center-card">
        <h1>{t('adminPreview.deniedTitle')}</h1>
        <p className="muted">{t('adminPreview.deniedMessage')}</p>
        <Button onClick={() => void signOut()}>{t('auth.signOut')}</Button>
      </div>
    </div>
  );
}

export function AppRoutes() {
  useTenantReset();
  const session = useSession();
  usePreloadScreens(Boolean(session.tenantId));
  const previewDecision = adminPreviewDecision({
    enabled: isAdminPreviewBuild(import.meta.env),
    status: session.status,
    isSuperAdmin: session.isSuperAdmin,
    isInternalDemo: session.isInternalDemo,
  });
  if (previewDecision === 'loading') return <PageLoader />;
  if (previewDecision === 'denied') return <AdminPreviewDenied />;
  const routes = (
    <>
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route element={<AuthLayout />}>
          <Route element={<PublicOnly />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          </Route>
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/auth/action" element={<AuthActionPage />} />
          <Route path="/setup" element={<SetupPage />} />
        </Route>

        <Route element={<RequireSuperAdmin />}>
          <Route element={<AppLayout adminOnly />}>
            <Route path="/admin" element={<SuperAdminPage />} />
          </Route>
        </Route>

        <Route element={<RequireMarketingPartner />}>
          <Route element={<PartnerLayout />}>
            <Route path="/partner" element={<PartnerDashboardPage />} />
          </Route>
        </Route>

        <Route element={<RequireTenant />}>
          <Route element={<AppLayout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            {NAV_ITEMS.map((item) => {
              const Screen = SCREENS[item.path];
              return (
                <Route
                  key={item.path}
                  path={item.path}
                  element={
                    <RequirePermission permission={item.permission} ownerOnly={item.ownerOnly}>
                      <Screen />
                    </RequirePermission>
                  }
                />
              );
            })}
          </Route>
        </Route>

        {/* Public storefront: guests, no sign-in. */}
        <Route path="/s/:slug" element={<PublicStorePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
    {previewDecision === 'allow' ? <UpdateNotice /> : null}
    </>
  );
  if (isAdminPreviewBuild(import.meta.env) && previewDecision === 'allow') {
    return <PreviewAccess denied={<AdminPreviewDenied />}>{routes}</PreviewAccess>;
  }
  return routes;
}
