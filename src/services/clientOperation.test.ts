import { describe, expect, it } from 'vitest';
import { isTransportFailure } from '@/offline/classify';
import { newClientOperationId, retryOnTransport } from './clientOperation';

describe('clientOperationId', () => {
  it('is a stable retry key that matches the server id field', () => {
    const id = newClientOperationId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(newClientOperationId()).not.toBe(id);
  });

  it('retries only transport failures and keeps calling the same function', async () => {
    let n = 0;
    const out = await retryOnTransport(async () => {
      n += 1;
      if (n < 3) {
        const err = Object.assign(new Error('unavailable'), { code: 'functions/unavailable' });
        expect(isTransportFailure(err)).toBe(true);
        throw err;
      }
      return 'ok';
    });
    expect(out).toBe('ok');
    expect(n).toBe(3);
  });
});
