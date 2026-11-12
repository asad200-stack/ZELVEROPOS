/** Production preview tree. Customer routes stay on the root bundle. */
export function isAdminPreviewBuild(env: { VITE_ADMIN_PREVIEW?: string }): boolean {
  return String(env.VITE_ADMIN_PREVIEW || '').toLowerCase() === 'true';
}

export type AdminPreviewDecision = 'allow' | 'loading' | 'login' | 'denied';

/**
 * The versioned preview opens only for a verified Super Admin on the internal demo store.
 * Every other signed-in session is refused before tenant screens mount.
 */
export function adminPreviewDecision(input: {
  enabled: boolean;
  status: string;
  isSuperAdmin: boolean;
  isInternalDemo: boolean;
}): AdminPreviewDecision {
  if (!input.enabled) return 'allow';
  if (input.status === 'loading') return 'loading';
  if (input.status === 'signedOut') return 'login';
  if (input.status === 'ready' && input.isSuperAdmin && input.isInternalDemo) return 'allow';
  return 'denied';
}
