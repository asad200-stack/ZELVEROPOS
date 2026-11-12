import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { PageLoader } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/Layout';
import type { PermissionKey } from '@/constants/permissions';
import { useSession } from '@/contexts/session';
import { useI18n } from '@/i18n/i18n';
import { AccountStatusScreen } from '@/features/auth/AccountStatusScreen';
import { publicRouteDecision, superAdminRouteDecision, tenantRouteDecision } from './routeAccess';

/**
 * Route protection. These guards are UX only; the real enforcement is in Firestore/Storage rules
 * and Cloud Functions (custom claims), so bypassing the UI grants nothing.
 */
export function RequireTenant() {
  const session = useSession();
  const location = useLocation();
  switch (tenantRouteDecision(session)) {
    case 'loader':
      return <PageLoader />;
    case 'login':
      return <Navigate to="/login" replace state={{ from: location.pathname }} />;
    case 'verify':
      return <Navigate to="/verify-email" replace />;
    case 'setup':
      return <Navigate to="/setup" replace />;
    case 'status':
      return <AccountStatusScreen status={session.status as 'disabled' | 'inactive' | 'error'} />;
    case 'admin':
      return <Navigate to="/admin" replace />;
    case 'allow':
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
  switch (superAdminRouteDecision(session)) {
    case 'loader':
      return <PageLoader />;
    case 'login':
      return <Navigate to="/login" replace />;
    case 'home':
      return <Navigate to="/" replace />;
    case 'allow':
      return <Outlet />;
  }
}

/** Public auth pages: signed-in users are sent to the app. */
export function PublicOnly() {
  const session = useSession();
  const location = useLocation();
  const decision = publicRouteDecision(session, (location.state as { from?: string } | null)?.from);
  if (decision.kind === 'loader') return <PageLoader />;
  if (decision.kind === 'redirect') return <Navigate to={decision.to} replace />;
  return <Outlet />;
}
