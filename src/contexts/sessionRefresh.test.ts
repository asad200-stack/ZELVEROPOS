import { describe, expect, it } from 'vitest';
import { shouldRefreshSessionToken, TOKEN_REFRESH_MIN_MS } from './sessionRefresh';

describe('session token refresh', () => {
  it('does not refresh while offline (keeps queued POS work recoverable)', () => {
    expect(shouldRefreshSessionToken(10_000, 0, { online: false, visible: true, force: true })).toBe(false);
  });

  it('skips hidden tabs unless a disable/permission change forces it', () => {
    expect(shouldRefreshSessionToken(TOKEN_REFRESH_MIN_MS + 1, 0, { online: true, visible: false })).toBe(false);
    expect(shouldRefreshSessionToken(6_000, 0, { online: true, visible: false, force: true })).toBe(true);
  });

  it('throttles visibility refreshes to at least one minute', () => {
    expect(shouldRefreshSessionToken(30_000, 0, { online: true, visible: true })).toBe(false);
    expect(shouldRefreshSessionToken(TOKEN_REFRESH_MIN_MS, 0, { online: true, visible: true })).toBe(true);
  });
});
