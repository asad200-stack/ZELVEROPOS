import type { Subscription, UserProfile } from '@/types/models';
import type { Claims, SessionStatus } from './session';
import { canAccessExpiredTenant, subscriptionGrantsWrite } from '@/domain/trial';

export interface SessionStatusInput {
  /** undefined while Firebase Auth has not reported yet. */
  user: { emailVerified: boolean } | null | undefined;
  claims: Claims | null;
  /** undefined while the profile listener has not answered; null when the document does not exist. */
  profile: UserProfile | null | undefined;
  subscription: Subscription | null;
  tenantId: string | null;
  /** Load failure of the CURRENT user only. Errors from a previous sign-in must not reach here. */
  error: unknown;
}

/**
 * A signed-out browser is always `signedOut`, whatever failed before. A load failure only turns into
 * `error` while the data it was loading is still missing; otherwise the session would wait forever.
 */
export function deriveSessionStatus(s: SessionStatusInput, now: number = Date.now()): SessionStatus {
  if (s.user === undefined) return 'loading';
  if (s.user === null) return 'signedOut';
  if (!s.claims) return s.error ? 'error' : 'loading';
  if (s.claims.superAdmin && !s.tenantId) return 'ready';
  if (!s.user.emailVerified) return 'needsVerification';
  if (s.profile === undefined) return s.error ? 'error' : 'loading';
  if (s.profile === null) return 'needsSetup';
  if (!s.profile.isActive) return 'disabled';
  if (!s.subscription) return s.error ? 'error' : 'loading';
  if (!subscriptionGrantsWrite(s.subscription, now) && !canAccessExpiredTenant(s.subscription)) return 'inactive';
  return 'ready';
}
