import { createContext, useContext } from 'react';
import type { User } from 'firebase/auth';
import type { PermissionKey, PermissionMap } from '@/constants/permissions';
import type { Actor } from '@/services/db';
import { canAccessExpiredTenant, subscriptionGrantsWrite } from '@/domain/trial';
import type { Role, Subscription, UserProfile } from '@/types/models';

export interface Claims {
  tenantId: string | null;
  role: Role | null;
  superAdmin: boolean;
  active: boolean;
  subUntil: number;
  claimsVersion: number;
}

export type SessionStatus =
  | 'loading'
  | 'signedOut'
  | 'needsVerification'
  | 'needsSetup'
  | 'disabled'
  | 'inactive'
  | 'ready'
  | 'error';

export interface Session {
  status: SessionStatus;
  user: User | null;
  profile: UserProfile | null;
  claims: Claims | null;
  subscription: Subscription | null;
  tenantId: string | null;
  isOwner: boolean;
  isSuperAdmin: boolean;
  /** The current tenant is the platform's internal demo store (server-written subscription marker). */
  isInternalDemo: boolean;
  permissions: PermissionMap;
  actor: Actor | null;
  error: unknown;
  writesEnabled: boolean;
  can: (permission: PermissionKey) => boolean;
  /** Reloads the Auth user and forces a token refresh; resolves to the fresh emailVerified flag. */
  refresh: () => Promise<boolean>;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}

/** For pages rendered behind the tenant guard: tenant id and actor are guaranteed. */
export function useTenant(): { tenantId: string; actor: Actor; can: Session['can']; isOwner: boolean } {
  const s = useSession();
  if (!s.tenantId || !s.actor) throw new Error('useTenant used outside a tenant route');
  return { tenantId: s.tenantId, actor: s.actor, can: s.can, isOwner: s.isOwner };
}

export function isSubscriptionActive(sub: Subscription | null, now: number = Date.now()): boolean {
  return subscriptionGrantsWrite(sub, now);
}

export { canAccessExpiredTenant };
