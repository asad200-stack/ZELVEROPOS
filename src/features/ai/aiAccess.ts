/**
 * Zelvero AI assistant access gate.
 * This only controls the AI panel — every AI action still re-checks the user's POS permissions.
 */

import type { PermissionKey } from '@/constants/permissions';

export const AI_ACCESS_PERMISSION = 'canUseZelveroAI' as const satisfies PermissionKey;

export type AiAccessContext = {
  isOwner: boolean;
  can: (permission: PermissionKey) => boolean;
};

/** True when the signed-in principal may open and use the Zelvero AI assistant. */
export function canAccessZelveroAi(ctx: AiAccessContext): boolean {
  // Owners receive ALL_PERMISSIONS in session; sub-users need the explicit grant.
  return ctx.can(AI_ACCESS_PERMISSION);
}

export function aiAccessDeniedText(lang: 'ar' | 'en'): string {
  return lang === 'ar'
    ? 'ما عندك صلاحية استخدام Zelvero AI. اطلب من المالك تفعيلها.'
    : 'You do not have permission to use Zelvero AI. Ask the store owner to enable it.';
}

/**
 * Opening / submitting without AI access must fail closed.
 * Does not grant any POS capability by itself.
 */
export function assertCanAccessZelveroAi(ctx: AiAccessContext): { ok: true } | { ok: false; reason: 'denied' } {
  if (!canAccessZelveroAi(ctx)) return { ok: false, reason: 'denied' };
  return { ok: true };
}

/** Shell visibility: entry point + dock mount. Admin-only shells stay closed. */
export function shouldShowAiEntry(ctx: AiAccessContext & { adminOnly?: boolean }): boolean {
  if (ctx.adminOnly) return false;
  return canAccessZelveroAi(ctx);
}

/**
 * When access is revoked while the dock is open/minimized, force closed.
 * Returns the next dock mode (closed if denied).
 */
export function aiDockModeAfterPermissionChange(
  mayUseAi: boolean,
  current: 'closed' | 'open' | 'minimized',
): 'closed' | 'open' | 'minimized' {
  if (!mayUseAi) return 'closed';
  return current;
}
