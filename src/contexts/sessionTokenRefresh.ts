/** True when a refresh started for `startedUid` is no longer for the active Auth user. */
export function isStaleAuthUid(startedUid: string, currentUid: string | null | undefined): boolean {
  return currentUid == null || currentUid !== startedUid;
}

export type ForcedIdTokenRefreshResult =
  | { status: 'ok' }
  | { status: 'stale' }
  | { status: 'error'; error: unknown };

/**
 * Forced ID-token refresh that ignores resolve/reject after sign-out or account switch.
 * Failures while the same UID is still current are returned as `error` (not suppressed).
 */
export async function refreshIdTokenUnlessStale(
  user: { uid: string; getIdToken: (force?: boolean) => Promise<string> },
  getCurrentUid: () => string | null | undefined,
): Promise<ForcedIdTokenRefreshResult> {
  const startedUid = user.uid;
  try {
    await user.getIdToken(true);
    if (isStaleAuthUid(startedUid, getCurrentUid())) return { status: 'stale' };
    return { status: 'ok' };
  } catch (error) {
    if (isStaleAuthUid(startedUid, getCurrentUid())) return { status: 'stale' };
    return { status: 'error', error };
  }
}

export function warnIfTokenRefreshFailed(result: ForcedIdTokenRefreshResult): void {
  if (result.status === 'error') {
    console.warn('[session] token refresh failed', result.error);
  }
}
