import { describe, expect, it, vi } from 'vitest';
import { refreshVerification } from './authRefresh';
import { EmailCooldown, RATE_LIMIT_BACKOFF_MS, RESEND_COOLDOWN_MS, type CooldownStore } from './emailCooldown';

function memoryStore(): CooldownStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}
const rateLimitError = Object.assign(new Error('Firebase: Error (auth/too-many-requests).'), { code: 'auth/too-many-requests' });

describe('EmailCooldown', () => {
  it('repeated clicks send at most one e-mail per cooldown (sequential and concurrent)', async () => {
    const c = clock();
    const cd = new EmailCooldown(memoryStore(), c.now);
    const send = vi.fn().mockResolvedValue(undefined);
    const concurrent = await Promise.all(Array.from({ length: 10 }, () => cd.send('verify', 'u1', send)));
    expect(send).toHaveBeenCalledTimes(1);
    expect(concurrent.every((o) => o.status === 'sent')).toBe(true);
    for (let i = 0; i < 11; i++) {
      c.advance(5_000);
      expect((await cd.send('verify', 'u1', send)).status).toBe('cooldown');
    }
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('a page reload (new instance, same storage) does not reset the cooldown', async () => {
    const c = clock();
    const store = memoryStore();
    const send = vi.fn().mockResolvedValue(undefined);
    await new EmailCooldown(store, c.now).send('verify', 'u1', send);
    c.advance(30_000);
    const afterReload = new EmailCooldown(store, c.now);
    expect(afterReload.status('verify', 'u1').remainingMs).toBe(30_000);
    expect((await afterReload.send('verify', 'u1', send)).status).toBe('cooldown');
    expect(send).toHaveBeenCalledTimes(1);
    c.advance(30_000);
    expect((await afterReload.send('verify', 'u1', send)).status).toBe('sent');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('the automatic signup e-mail starts the cooldown for the verify page', async () => {
    const c = clock();
    const store = memoryStore();
    const send = vi.fn().mockResolvedValue(undefined);
    await new EmailCooldown(store, c.now).send('verify', 'new-user', send);
    const verifyPage = new EmailCooldown(store, c.now);
    expect(verifyPage.status('verify', 'new-user')).toEqual({ remainingMs: RESEND_COOLDOWN_MS, rateLimited: false });
  });

  it('a rate-limit answer backs off for 10 minutes and stops further calls to Firebase', async () => {
    const c = clock();
    const store = memoryStore();
    const cd = new EmailCooldown(store, c.now);
    const send = vi.fn().mockRejectedValue(rateLimitError);
    const first = await cd.send('verify', 'u1', send);
    expect(first.status).toBe('rateLimited');
    expect(first.retryAt - c.now()).toBe(RATE_LIMIT_BACKOFF_MS);
    for (let i = 0; i < 9; i++) {
      c.advance(60_000);
      expect((await new EmailCooldown(store, c.now).send('verify', 'u1', send)).status).toBe('rateLimited');
    }
    expect(send).toHaveBeenCalledTimes(1);
    c.advance(60_000);
    send.mockResolvedValueOnce(undefined);
    expect((await cd.send('verify', 'u1', send)).status).toBe('sent');
  });

  it('recognises the REST error text as a rate limit too', async () => {
    const cd = new EmailCooldown(memoryStore(), clock().now);
    const outcome = await cd.send('reset', 'browser', () => Promise.reject(new Error('TOO_MANY_ATTEMPTS_TRY_LATER : Too many requests')));
    expect(outcome.status).toBe('rateLimited');
  });

  it('other failures are returned (not thrown) and still start the normal cooldown', async () => {
    const c = clock();
    const cd = new EmailCooldown(memoryStore(), c.now);
    const err = Object.assign(new Error('unavailable'), { code: 'auth/network-request-failed' });
    const outcome = await cd.send('verify', 'u1', () => Promise.reject(err));
    expect(outcome).toEqual({ status: 'failed', retryAt: c.now() + RESEND_COOLDOWN_MS, error: err });
    expect(cd.status('verify', 'u1').remainingMs).toBe(RESEND_COOLDOWN_MS);
  });

  it('keeps accounts and e-mail kinds independent', async () => {
    const cd = new EmailCooldown(memoryStore(), clock().now);
    const send = vi.fn().mockResolvedValue(undefined);
    await cd.send('verify', 'u1', send);
    await cd.send('verify', 'u2', send);
    await cd.send('reset', 'browser', send);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('blocked storage still de-duplicates concurrent clicks and never throws', async () => {
    const broken: CooldownStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const cd = new EmailCooldown(broken, clock().now);
    const send = vi.fn().mockResolvedValue(undefined);
    await Promise.all([cd.send('verify', 'u1', send), cd.send('verify', 'u1', send)]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('stores no e-mail address', async () => {
    const store = memoryStore();
    await new EmailCooldown(store, clock().now).send('reset', 'browser', () => Promise.resolve());
    expect([...store.data.keys(), ...store.data.values()].join(' ')).not.toMatch(/@/);
  });
});

describe('refreshVerification', () => {
  it('reloads once, forces one token refresh, and reports the fresh flag', async () => {
    const user = {
      emailVerified: false,
      reload: vi.fn(async () => {
        user.emailVerified = true;
      }),
      getIdToken: vi.fn(async () => 'token'),
    };
    await expect(refreshVerification(user)).resolves.toBe(true);
    expect(user.reload).toHaveBeenCalledTimes(1);
    expect(user.getIdToken).toHaveBeenCalledTimes(1);
    expect(user.getIdToken).toHaveBeenCalledWith(true);
    expect(user.reload.mock.invocationCallOrder[0]).toBeLessThan(user.getIdToken.mock.invocationCallOrder[0]);
  });

  it('reports still-unverified without retrying', async () => {
    const user = { emailVerified: false, reload: vi.fn(async () => undefined), getIdToken: vi.fn(async () => 't') };
    await expect(refreshVerification(user)).resolves.toBe(false);
    expect(user.reload).toHaveBeenCalledTimes(1);
  });

  it('propagates a rate-limit error from the reload instead of looping', async () => {
    const user = { emailVerified: false, reload: vi.fn(() => Promise.reject(rateLimitError)), getIdToken: vi.fn(async () => 't') };
    await expect(refreshVerification(user)).rejects.toBe(rateLimitError);
    expect(user.reload).toHaveBeenCalledTimes(1);
    expect(user.getIdToken).not.toHaveBeenCalled();
  });
});
