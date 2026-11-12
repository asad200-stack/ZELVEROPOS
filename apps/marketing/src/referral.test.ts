import { afterEach, describe, expect, it } from 'vitest';
import { STORAGE } from './constants';
import { parseRef, persistReferral, readReferral } from './referral';

const mem: Record<string, string> = {};
if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => (k in mem ? mem[k] : null),
      setItem: (k: string, v: string) => {
        mem[k] = String(v);
      },
      removeItem: (k: string) => {
        delete mem[k];
      },
    },
  });
}

describe('referral', () => {
  afterEach(() => {
    try {
      localStorage.removeItem(STORAGE.ref);
    } catch {
      /* node */
    }
  });

  it('accepts partner codes and rejects junk', () => {
    expect(parseRef('?ref=AGENT_01')).toBe('AGENT_01');
    expect(parseRef('?ref=bad code')).toBeNull();
    expect(parseRef('')).toBeNull();
  });

  it('persists a valid ref and survives a later empty search', () => {
    if (typeof localStorage === 'undefined') return;
    persistReferral('?ref=PARTNER9');
    expect(readReferral()).toBe('PARTNER9');
    persistReferral('');
    expect(readReferral()).toBe('PARTNER9');
  });
});
