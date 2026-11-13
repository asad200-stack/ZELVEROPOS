import type { Session } from '@/contexts/session';

type RouteSession = Pick<Session, 'status' | 'tenantId' | 'isSuperAdmin'> & { isMarketingPartner?: boolean };

export type TenantRouteDecision = 'loader' | 'login' | 'verify' | 'setup' | 'status' | 'admin' | 'partner' | 'allow';

/**
 * Tenant (POS) routes need a tenant. A super admin without one belongs on /admin; a marketing
 * partner (also a pure platform account, never a tenant member) belongs on /partner instead —
 * checked first, since the two claims are mutually exclusive but both leave `tenantId` null.
 */
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
      if (s.tenantId) return 'allow';
      return s.isMarketingPartner === true ? 'partner' : 'admin';
  }
}

export type SuperAdminRouteDecision = 'loader' | 'login' | 'home' | 'allow';

/** The super admin claim alone opens /admin; the state of an attached demo tenant never closes it. */
export function superAdminRouteDecision(s: RouteSession): SuperAdminRouteDecision {
  if (s.status === 'loading') return 'loader';
  if (s.status === 'signedOut') return 'login';
  return s.isSuperAdmin ? 'allow' : 'home';
}

export type MarketingPartnerRouteDecision = 'loader' | 'login' | 'home' | 'allow';

/** Mirrors superAdminRouteDecision: the marketingPartner claim alone opens /partner. */
export function marketingPartnerRouteDecision(s: RouteSession): MarketingPartnerRouteDecision {
  if (s.status === 'loading') return 'loader';
  if (s.status === 'signedOut') return 'login';
  return s.isMarketingPartner === true ? 'allow' : 'home';
}

export type PublicRouteDecision = { kind: 'loader' } | { kind: 'redirect'; to: string } | { kind: 'allow' };

export function publicRouteDecision(s: RouteSession, from: string | undefined): PublicRouteDecision {
  if (s.status === 'loading') return { kind: 'loader' };
  if (s.status === 'ready') {
    const home = s.tenantId ? '/' : s.isMarketingPartner === true ? '/partner' : '/admin';
    return { kind: 'redirect', to: from && from !== '/login' ? from : home };
  }
  if (s.status === 'needsVerification') return { kind: 'redirect', to: '/verify-email' };
  if (s.status === 'needsSetup') return { kind: 'redirect', to: '/setup' };
  return { kind: 'allow' };
}
