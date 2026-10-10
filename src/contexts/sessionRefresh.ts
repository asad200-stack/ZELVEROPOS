/** Minimum gap between forced ID-token refreshes (visibility / focus). */
export const TOKEN_REFRESH_MIN_MS = 60_000;
/** Periodic refresh while the tab is visible and online. Not a tight poll. */
export const TOKEN_REFRESH_INTERVAL_MS = 5 * 60_000;

export function shouldRefreshSessionToken(
  now: number,
  lastRefreshMs: number,
  opts: { online: boolean; visible: boolean; force?: boolean },
): boolean {
  if (!opts.online) return false;
  if (opts.force) return now - lastRefreshMs >= 5_000;
  if (!opts.visible) return false;
  return now - lastRefreshMs >= TOKEN_REFRESH_MIN_MS;
}
