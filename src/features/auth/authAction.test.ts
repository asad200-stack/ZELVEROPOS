import { describe, expect, it, vi } from 'vitest';
import { isDeadLinkError, parseActionParams, runOnce } from './authAction';

const ORIGIN = 'https://zelvoropos.web.app';
const CODE = 'AbC-123_xyzAbC-123_xyz';

describe('parseActionParams', () => {
  it.each(['verifyEmail', 'resetPassword', 'recoverEmail'])('accepts mode %s', (mode) => {
    expect(parseActionParams(`?mode=${mode}&oobCode=${CODE}&apiKey=k&lang=en`, ORIGIN)).toEqual({ mode, oobCode: CODE, continuePath: '/' });
  });

  it('rejects unsupported modes and malformed codes', () => {
    expect(parseActionParams(`?mode=signIn&oobCode=${CODE}`, ORIGIN)).toBeNull();
    expect(parseActionParams(`?mode=verifyEmail`, ORIGIN)).toBeNull();
    expect(parseActionParams(`?mode=verifyEmail&oobCode=<script>`, ORIGIN)).toBeNull();
  });

  it('only continues to same-origin paths (no open redirect)', () => {
    const cont = (u: string) => parseActionParams(`?mode=verifyEmail&oobCode=${CODE}&continueUrl=${encodeURIComponent(u)}`, ORIGIN)?.continuePath;
    expect(cont(`${ORIGIN}/dashboard?x=1`)).toBe('/dashboard?x=1');
    expect(cont('/pos')).toBe('/pos');
    expect(cont('https://evil.example/phish')).toBe('/');
    expect(cont('//evil.example/phish')).toBe('/');
    expect(cont('javascript:alert(1)')).toBe('/');
    expect(cont(`${ORIGIN}/auth/action?mode=verifyEmail`)).toBe('/');
  });
});

describe('action helpers', () => {
  it('classifies dead links separately from technical errors', () => {
    expect(isDeadLinkError({ code: 'auth/expired-action-code' })).toBe(true);
    expect(isDeadLinkError({ code: 'auth/invalid-action-code' })).toBe(true);
    expect(isDeadLinkError({ code: 'auth/network-request-failed' })).toBe(false);
  });

  it('uses a single-use code at most once even if the screen mounts twice', async () => {
    const apply = vi.fn().mockResolvedValue('ok');
    await Promise.all([runOnce('verify:abc', apply), runOnce('verify:abc', apply)]);
    await runOnce('verify:abc', apply);
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
