import type { Session } from '@/contexts/session';

type RouteSession = Pick<Session, 'status' | 'tenantId' | 'isSuperAdmin'>;

export type TenantRouteDecision = 'loader' | 'login' | 'verify' | 'setup' | 'status' | 'admin' | 'allow';

/** Tenant (POS) routes need a tenant. A super admin without one belongs on /admin. */
export function tenantRouteDecision(s: RouteSession): TenantRouteDecision {
  switch (s.status) {
    case 'loading':
      return 'loader';
    case 'signedOut':
      return 'login';
    case 'needsVerification':
      return 'verify';
    case 'needsSetup':
      return 'setup';
    case 'disabled':
    case 'inactive':
    case 'error':
      return 'status';
    case 'ready':
      return s.tenantId ? 'allow' : 'admin';
  }
}

export type SuperAdminRouteDecision = 'loader' | 'login' | 'home' | 'allow';

/** The super admin claim alone opens /admin; the state of an attached demo tenant never closes it. */
export function superAdminRouteDecision(s: RouteSession): SuperAdminRouteDecision {
  if (s.status === 'loading') return 'loader';
  if (s.status === 'signedOut') return 'login';
  return s.isSuperAdmin ? 'allow' : 'home';
}

export type PublicRouteDecision = { kind: 'loader' } | { kind: 'redirect'; to: string } | { kind: 'allow' };

export function publicRouteDecision(s: RouteSession, from: string | undefined): PublicRouteDecision {
  if (s.status === 'loading') return { kind: 'loader' };
  if (s.status === 'ready') {
    return { kind: 'redirect', to: from && from !== '/login' ? from : s.tenantId ? '/' : '/admin' };
  }
  if (s.status === 'needsVerification') return { kind: 'redirect', to: '/verify-email' };
  if (s.status === 'needsSetup') return { kind: 'redirect', to: '/setup' };
  return { kind: 'allow' };
}
