import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MISSING_CLIENT_IP, forwardedAddresses, platformClientIp } from '../../functions/src/requestIp';

describe('platform client IP', () => {
  it('uses the last X-Forwarded-For hop and ignores a forged prefix', () => {
    expect(platformClientIp({ forwardedFor: '1.2.3.4, 203.0.113.8' })).toBe('203.0.113.8');
    expect(platformClientIp({ forwardedFor: '8.8.8.8, 198.51.100.10, 203.0.113.9' })).toBe('203.0.113.9');
    expect(platformClientIp({ forwardedFor: ['1.1.1.1', '203.0.113.7'] })).toBe('203.0.113.7');
  });

  it('accepts one platform-supplied address', () => {
    expect(platformClientIp({ forwardedFor: '203.0.113.5' })).toBe('203.0.113.5');
    expect(platformClientIp({ forwardedFor: ' 2001:DB8::5 ' })).toBe('2001:db8::5');
  });

  it('shares one key when the header and socket are missing or malformed', () => {
    expect(platformClientIp({})).toBe(MISSING_CLIENT_IP);
    expect(platformClientIp({ forwardedFor: 'not-an-ip, also bad' })).toBe(MISSING_CLIENT_IP);
    expect(platformClientIp({ forwardedFor: '', socketAddress: 'nope' })).toBe(MISSING_CLIENT_IP);
    expect(platformClientIp({ forwardedFor: '999.1.1.1', socketAddress: '' })).toBe(MISSING_CLIENT_IP);
    const first = platformClientIp({ forwardedFor: 'spoofed-host' });
    const second = platformClientIp({ forwardedFor: '1.2.3' });
    expect(first).toBe(second);
    expect(first).toBe(MISSING_CLIENT_IP);
  });

  it('uses a valid socket address only when no forwarded hop is valid', () => {
    expect(platformClientIp({ forwardedFor: 'garbage', socketAddress: '203.0.113.20' })).toBe('203.0.113.20');
    expect(platformClientIp({ forwardedFor: '198.51.100.1', socketAddress: '10.0.0.1' })).toBe('198.51.100.1');
  });

  it('drops invalid hops before choosing the last valid address', () => {
    expect(forwardedAddresses('nope, 203.0.113.4, still-nope')).toEqual(['203.0.113.4']);
    expect(platformClientIp({ forwardedFor: 'attacker, 203.0.113.4, not-an-ip' })).toBe('203.0.113.4');
  });

  it('is what the sales functions use for the rate-limit key', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../functions/src/sales.ts'), 'utf8');
    expect(source).toContain('platformClientIp');
    expect(source).not.toContain("split(',')[0]");
    expect(source).toContain('rateLimit(\'lead\'');
    expect(source).toContain('rateLimit(\'trial\'');
  });
});
