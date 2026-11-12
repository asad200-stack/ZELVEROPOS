import { describe, expect, it } from 'vitest';
import type { SessionStatus } from '@/contexts/session';
import { publicRouteDecision, superAdminRouteDecision, tenantRouteDecision } from './routeAccess';

const session = (status: SessionStatus, tenantId: string | null, isSuperAdmin: boolean) => ({ status, tenantId, isSuperAdmin });

const pureSuperAdmin = session('ready', null, true);
const superAdminWithDemo = session('ready', 'demo-tenant', true);
const customerOwner = session('ready', 'customer-tenant', false);

describe('route access', () => {
  it('the existing super admin can open /admin', () => {
    expect(superAdminRouteDecision(pureSuperAdmin)).toBe('allow');
    expect(superAdminRouteDecision(superAdminWithDemo)).toBe('allow');
  });

  it('a pure super admin without a tenant stays on /admin', () => {
    expect(tenantRouteDecision(pureSuperAdmin)).toBe('admin');
    expect(publicRouteDecision(pureSuperAdmin, undefined)).toEqual({ kind: 'redirect', to: '/admin' });
  });

  it('a super admin with an approved internal tenant can open POS routes', () => {
    expect(tenantRouteDecision(superAdminWithDemo)).toBe('allow');
    expect(publicRouteDecision(superAdminWithDemo, '/pos')).toEqual({ kind: 'redirect', to: '/pos' });
  });

  it('an inactive demo subscription closes POS but never /admin', () => {
    const inactive = session('inactive', 'demo-tenant', true);
    expect(tenantRouteDecision(inactive)).toBe('status');
    expect(superAdminRouteDecision(inactive)).toBe('allow');
  });

  it('customer owners cannot open /admin', () => {
    expect(superAdminRouteDecision(customerOwner)).toBe('home');
    expect(superAdminRouteDecision(session('inactive', 'customer-tenant', false))).toBe('home');
  });

  it('customer flows are unchanged', () => {
    expect(tenantRouteDecision(customerOwner)).toBe('allow');
    expect(tenantRouteDecision(session('loading', null, false))).toBe('loader');
    expect(tenantRouteDecision(session('signedOut', null, false))).toBe('login');
    expect(tenantRouteDecision(session('needsVerification', null, false))).toBe('verify');
    expect(tenantRouteDecision(session('needsSetup', null, false))).toBe('setup');
    expect(tenantRouteDecision(session('disabled', 'customer-tenant', false))).toBe('status');
    expect(tenantRouteDecision(session('error', null, false))).toBe('status');
    expect(publicRouteDecision(customerOwner, undefined)).toEqual({ kind: 'redirect', to: '/' });
    expect(publicRouteDecision(session('signedOut', null, false), undefined)).toEqual({ kind: 'allow' });
    expect(superAdminRouteDecision(session('signedOut', null, false))).toBe('login');
  });
});
