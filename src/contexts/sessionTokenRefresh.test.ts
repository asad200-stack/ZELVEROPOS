import { describe, expect, it, vi } from 'vitest';
import {
  isStaleAuthUid,
  refreshIdTokenUnlessStale,
  warnIfTokenRefreshFailed,
} from './sessionTokenRefresh';

function mockUser(uid: string, getIdToken: (force?: boolean) => Promise<string>) {
  return { uid, getIdToken };
}

describe('isStaleAuthUid', () => {
  it('is stale when signed out (null/undefined current uid)', () => {
    expect(isStaleAuthUid('user-a', null)).toBe(true);
    expect(isStaleAuthUid('user-a', undefined)).toBe(true);
  });

  it('is stale when another user is current', () => {
    expect(isStaleAuthUid('user-a', 'user-b')).toBe(true);
  });

  it('is not stale when the same uid remains current', () => {
    expect(isStaleAuthUid('user-a', 'user-a')).toBe(false);
  });
});

describe('refreshIdTokenUnlessStale', () => {
  it('returns ok when refresh succeeds and the same uid remains active', async () => {
    const user = mockUser('user-a', vi.fn().mockResolvedValue('token'));
    const result = await refreshIdTokenUnlessStale(user, () => 'user-a');
    expect(result).toEqual({ status: 'ok' });
    expect(user.getIdToken).toHaveBeenCalledWith(true);
  });

  it('preserves a genuine error when the same uid remains active', async () => {
    const err = Object.assign(new Error('network'), { code: 'auth/network-request-failed' });
    const user = mockUser('user-a', vi.fn().mockRejectedValue(err));
    const result = await refreshIdTokenUnlessStale(user, () => 'user-a');
    expect(result).toEqual({ status: 'error', error: err });
  });

  it('ignores success after sign-out while refresh was pending', async () => {
    let current: string | null = 'user-a';
    const user = mockUser(
      'user-a',
      vi.fn().mockImplementation(async () => {
        current = null;
        return 'token';
      }),
    );
    const result = await refreshIdTokenUnlessStale(user, () => current);
    expect(result).toEqual({ status: 'stale' });
  });

  it('ignores error after sign-out while refresh was pending', async () => {
    let current: string | null = 'user-a';
    const user = mockUser(
      'user-a',
      vi.fn().mockImplementation(async () => {
        current = null;
        throw Object.assign(new Error('aborted'), { code: 'auth/network-request-failed' });
      }),
    );
    const result = await refreshIdTokenUnlessStale(user, () => current);
    expect(result).toEqual({ status: 'stale' });
  });

  it("ignores user A's success after switch to user B (cannot affect B)", async () => {
    let current = 'user-a';
    const userA = mockUser(
      'user-a',
      vi.fn().mockImplementation(async () => {
        current = 'user-b';
        return 'token-a';
      }),
    );
    const result = await refreshIdTokenUnlessStale(userA, () => current);
    expect(result).toEqual({ status: 'stale' });
    expect(isStaleAuthUid('user-a', current)).toBe(true);
  });

  it("ignores user A's error after switch to user B", async () => {
    let current = 'user-a';
    const userA = mockUser(
      'user-a',
      vi.fn().mockImplementation(async () => {
        current = 'user-b';
        throw new Error('auth/network-request-failed');
      }),
    );
    const result = await refreshIdTokenUnlessStale(userA, () => current);
    expect(result).toEqual({ status: 'stale' });
  });

  it('blocks applying stale claims: only same-uid results may update session state', () => {
    const startedUid = 'user-a';
    const claimsFromA = { tenantId: 't-a', role: 'owner' as const };
    const claimsFromB = { tenantId: 't-b', role: 'subUser' as const };

    let applied: typeof claimsFromA | typeof claimsFromB | null = claimsFromB;
    const applyIfCurrent = (uid: string, claims: typeof claimsFromA) => {
      if (isStaleAuthUid(uid, 'user-b')) return;
      applied = claims;
    };

    applyIfCurrent(startedUid, claimsFromA);
    expect(applied).toEqual(claimsFromB);
  });
});

describe('warnIfTokenRefreshFailed', () => {
  it('warns only for genuine same-user errors, not stale outcomes', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      warnIfTokenRefreshFailed({ status: 'ok' });
      warnIfTokenRefreshFailed({ status: 'stale' });
      expect(warn).not.toHaveBeenCalled();

      const err = new Error('auth/network-request-failed');
      warnIfTokenRefreshFailed({ status: 'error', error: err });
      expect(warn).toHaveBeenCalledWith('[session] token refresh failed', err);
    } finally {
      warn.mockRestore();
    }
  });
});
