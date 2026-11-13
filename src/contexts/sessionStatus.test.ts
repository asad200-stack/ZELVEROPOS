import { describe, expect, it } from 'vitest';
import type { Subscription, UserProfile } from '@/types/models';
import type { Claims } from './session';
import { deriveSessionStatus, type SessionStatusInput } from './sessionStatus';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 30);

const claims = (o: Partial<Claims> = {}): Claims => ({ tenantId: 't1', role: 'owner', superAdmin: false, marketingPartner: false, active: true, subUntil: NOW + DAY, claimsVersion: 1, ...o });
const profile = (o: Partial<UserProfile> = {}): UserProfile => ({
  uid: 'u1',
  email: '',
  fullName: 'Owner',
  role: 'owner',
  tenantId: 't1',
  isActive: true,
  permissions: {} as UserProfile['permissions'],
  storeName: '',
  subdomain: '',
  phone: '',
  claimsVersion: 1,
  createdAt: null,
  ...o,
});
const activeSub: Subscription = { activated: true, lifetime: false, startsAt: NOW - DAY, endsAt: NOW + DAY, updatedAt: null };
const neverActivated: Subscription = { activated: false, lifetime: false, startsAt: null, endsAt: null, updatedAt: null };
const permissionDenied = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });

const input = (o: Partial<SessionStatusInput> = {}): SessionStatusInput => ({
  user: { emailVerified: true },
  claims: claims(),
  profile: profile(),
  subscription: activeSub,
  tenantId: 't1',
  error: null,
  ...o,
});

describe('deriveSessionStatus', () => {
  it('a signed-out browser is signedOut even when the previous session left a listener error', () => {
    expect(deriveSessionStatus(input({ user: null, claims: null, profile: undefined, subscription: null, tenantId: null, error: permissionDenied }), NOW)).toBe('signedOut');
  });

  it('waits for Auth before deciding anything', () => {
    expect(deriveSessionStatus(input({ user: undefined, error: permissionDenied }), NOW)).toBe('loading');
  });

  it('a fresh sign-in with no error is loading until claims arrive, not an error', () => {
    expect(deriveSessionStatus(input({ claims: null, profile: undefined, subscription: null, tenantId: null }), NOW)).toBe('loading');
  });

  it('reports error only for a load failure of the current user while its data is missing', () => {
    expect(deriveSessionStatus(input({ claims: null, error: permissionDenied }), NOW)).toBe('error');
    expect(deriveSessionStatus(input({ profile: undefined, error: permissionDenied }), NOW)).toBe('error');
    expect(deriveSessionStatus(input({ subscription: null, error: permissionDenied }), NOW)).toBe('error');
    expect(deriveSessionStatus(input({ error: permissionDenied }), NOW)).toBe('ready');
  });

  it('a pure super admin (no tenant) is ready without a profile or subscription', () => {
    const s = input({ claims: claims({ superAdmin: true, tenantId: null, role: null }), profile: null, subscription: null, tenantId: null });
    expect(deriveSessionStatus(s, NOW)).toBe('ready');
  });

  it('a pure marketing partner (no tenant) is ready without a profile or subscription', () => {
    const s = input({ claims: claims({ marketingPartner: true, tenantId: null, role: null }), profile: null, subscription: null, tenantId: null });
    expect(deriveSessionStatus(s, NOW)).toBe('ready');
  });

  it('a super admin with a tenant goes through the normal tenant checks', () => {
    const base = { claims: claims({ superAdmin: true }) };
    expect(deriveSessionStatus(input(base), NOW)).toBe('ready');
    expect(deriveSessionStatus(input({ ...base, subscription: neverActivated }), NOW)).toBe('inactive');
    expect(deriveSessionStatus(input({ ...base, profile: profile({ isActive: false }) }), NOW)).toBe('disabled');
  });

  it('keeps the customer flow unchanged', () => {
    expect(deriveSessionStatus(input({ user: { emailVerified: false } }), NOW)).toBe('needsVerification');
    expect(deriveSessionStatus(input({ profile: null }), NOW)).toBe('needsSetup');
    expect(deriveSessionStatus(input({ profile: profile({ isActive: false }) }), NOW)).toBe('disabled');
    expect(deriveSessionStatus(input({ subscription: neverActivated }), NOW)).toBe('inactive');
    // An expired store stays readable (writes are closed by `writesEnabled` and the rules).
    expect(deriveSessionStatus(input({ subscription: { ...activeSub, endsAt: NOW - DAY } }), NOW)).toBe('ready');
    expect(deriveSessionStatus(input({ subscription: { ...activeSub, lifetime: true, endsAt: null } }), NOW)).toBe('ready');
    expect(deriveSessionStatus(input(), NOW)).toBe('ready');
  });
});
