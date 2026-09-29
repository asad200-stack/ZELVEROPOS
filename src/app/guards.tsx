import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { PageLoader } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/Layout';
import type { PermissionKey } from '@/constants/permissions';
import { useSession } from '@/contexts/session';
import { useI18n } from '@/i18n/i18n';
import { AccountStatusScreen } from '@/features/auth/AccountStatusScreen';

/**
 * Route protection. These guards are UX only; the real enforcement is in Firestore/Storage rules
 * and Cloud Functions (custom claims), so bypassing the UI grants nothing.
 */
export function RequireTenant() {
  const session = useSession();
  const location = useLocation();
  switch (session.status) {
    case 'loading':
      return <PageLoader />;
    case 'signedOut':
      return <Navigate to="/login" replace state={{ from: location.pathname }} />;
    case 'needsVerification':
      return <Navigate to="/verify-email" replace />;
    case 'needsSetup':
      return <Navigate to="/setup" replace />;
    case 'disabled':
    case 'inactive':
    case 'error':
      return <AccountStatusScreen status={session.status} />;
    case 'ready':
      if (!session.tenantId) return <Navigate to="/admin" replace />;
      return <Outlet />;
  }
}

export function RequirePermission({ permission, ownerOnly, children }: { permission?: PermissionKey; ownerOnly?: boolean; children: ReactNode }) {
  const { can, isOwner } = useSession();
  const { t } = useI18n();
  const allowed = ownerOnly ? isOwner : permission ? can(permission) : true;
  if (!allowed) return <EmptyState icon="lock" title={t('common.noAccessTitle')} message={t('common.noAccessMessage')} />;
  return <>{children}</>;
}

export function RequireSuperAdmin() {
  const session = useSession();
  if (session.status === 'loading') return <PageLoader />;
  if (session.status === 'signedOut') return <Navigate to="/login" replace />;
  if (!session.isSuperAdmin) return <Navigate to="/" replace />;
  return <Outlet />;
}

/** Public auth pages: signed-in users are sent to the app. */
export function PublicOnly() {
  const session = useSession();
  const location = useLocation();
  if (session.status === 'loading') return <PageLoader />;
  if (session.status === 'ready') {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== '/login' ? from : session.tenantId ? '/' : '/admin'} replace />;
  }
  if (session.status === 'needsVerification') return <Navigate to="/verify-email" replace />;
  if (session.status === 'needsSetup') return <Navigate to="/setup" replace />;
  return <Outlet />;
}
